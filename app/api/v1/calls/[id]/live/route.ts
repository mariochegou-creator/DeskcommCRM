/**
 * POST /api/v1/calls/[id]/live — o copiloto ao vivo da ligação.
 *
 * O popup manda um bloco de áudio de ~15 s (um arquivo COMPLETO, não um pedaço
 * de stream: o gravador é reiniciado a cada bloco justamente para que cada um
 * seja decodificável sozinho). Aqui o bloco é transcrito pelo Groq Whisper,
 * APENSADO em `crm_call_recordings.transcript` e mandado ao Haiku, que devolve
 * a próxima frase para o SDR falar e o checklist do roteiro.
 *
 * O ÁUDIO DO BLOCO NÃO É GUARDADO. Ele vive no buffer desta requisição e morre
 * com ela — a gravação que fica é a íntegra, enviada uma vez só em
 * `/audio` quando a ligação encerra. Guardar os dois seria pagar storage duas
 * vezes pela mesma voz e dobrar a superfície da redação LGPD.
 *
 * POR QUE ESCREVE NA MESMA COLUNA `transcript` (e não numa coluna "ao vivo"):
 * o `call-analysis-worker` já pula o Whisper quando encontra `transcript`
 * preenchido. Com o copiloto ligado, a ligação chega ao fim já transcrita e a
 * análise final sai em segundos, sem mandar o áudio inteiro para o Whisper uma
 * segunda vez. Ver o cabeçalho da migration 0106.
 *
 * TENANCY: a linha vem pela RLS do caller (é ela que prova a org); o admin
 * client entra só para escrever, sempre filtrando `organization_id` à mão.
 */
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import {
  DEFAULT_CLASSIFIER_MODEL,
  gatewayConfig,
  gatewayHeaders,
  isModelConfigured,
  resolveModel,
} from "@/lib/ai/gateway";
import { requireRole } from "@/lib/auth/require-role";
import {
  JANELA_MAX_CHARS,
  RETRY_DE_FORMATO_LIGACAO,
  liveCallSystemPrompt,
  liveCallUserPrompt,
  recortarJanela,
} from "@/lib/calls/live-prompt";
import {
  COBERTURA_VAZIA,
  parseLiveCallSuggestion,
  parseLiveState,
  type LiveCallSuggestion,
} from "@/lib/calls/live-schema";
import { isAllowedCallMime, normalizeMime } from "@/lib/calls/storage";
import { groqTranscriptionProvider } from "@/lib/calls/transcribe";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * 8 MB. Um bloco de 15 s em Opus 32 kbps tem ~60 KB — o teto existe para
 * recusar um upload errado (a ligação inteira, um vídeo) antes de ele virar
 * chamada ao Whisper, não para apertar o caso normal.
 */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Abaixo disto o bloco não vira chamada ao modelo. Quinze segundos de silêncio
 * transcrevem para "…" ou uma interjeição solta, e pedir uma sugestão em cima
 * disso gasta dinheiro para produzir uma frase genérica que ainda por cima
 * substitui na tela uma sugestão boa que estava lá.
 */
const MIN_CHARS_PARA_SUGERIR = 25;

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: callId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_call_recordings" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data: call, error: callErr } = await supabase
    .from("crm_call_recordings")
    .select("id, organization_id, contact_id, lead_id, status, transcript, live_state")
    .eq("id", callId)
    .maybeSingle();
  if (callErr) return fail("internal_error", callErr.message, 500, { requestId });
  if (!call) return fail("not_found", "Ligação não encontrada.", 404, { requestId });

  // Depois que o áudio final subiu, o pipeline é dono da linha: continuar
  // apensando aqui competiria com o worker pela mesma coluna.
  if (call.status !== "pending") {
    return fail("call_not_live", "Esta ligação já foi encerrada.", 409, { requestId });
  }

  const transcriber = groqTranscriptionProvider();
  if (!transcriber) {
    return fail(
      "transcription_not_configured",
      "Transcrição ao vivo indisponível: falta GROQ_API_KEY no servidor.",
      503,
      { requestId },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("validation_failed", "Envie o bloco como multipart/form-data.", 422, { requestId });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return fail("validation_failed", "Campo `file` ausente.", 422, { requestId });
  }
  const mime = normalizeMime(file.type);
  if (!isAllowedCallMime(mime)) {
    return fail("unsupported_media_type", `Formato não suportado (${mime || "?"}).`, 415, {
      requestId,
    });
  }
  if (file.size === 0) {
    return fail("validation_failed", "Bloco de áudio vazio.", 422, { requestId });
  }
  if (file.size > MAX_CHUNK_BYTES) {
    return fail("payload_too_large", "Bloco de áudio grande demais.", 413, { requestId });
  }

  const atRaw = form.get("at_seconds");
  const segundos =
    typeof atRaw === "string" && /^\d{1,6}$/.test(atRaw) ? Number.parseInt(atRaw, 10) : 0;

  // ---- 1. transcrever o bloco ----
  let trecho = "";
  try {
    trecho = (await transcriber.transcribe(Buffer.from(await file.arrayBuffer()), mime)).trim();
  } catch (err) {
    // Falha de transcrição de UM bloco não é falha da ligação: o SDR continua
    // falando, o gravador da íntegra continua rodando, e o bloco seguinte tenta
    // de novo. Devolver 200 com o motivo evita o popup tratar isso como pane.
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn("[calls/live] transcrição do bloco falhou", { call_id: callId, detail, requestId });
    return ok({ texto: "", sugestao: null, transcription_error: true }, { requestId });
  }

  const admin = createAdminClient();
  const estado = parseLiveState(call.live_state);
  const chunks = (estado.chunks ?? 0) + 1;

  // Whisper devolve marcação de silêncio como pontuação solta; guardar isso
  // suja a transcrição que vai virar a análise final.
  const trechoUtil = /[a-zà-ú0-9]/i.test(trecho) ? trecho : "";
  const transcricao = [call.transcript?.trim() ?? "", trechoUtil].filter(Boolean).join(" ");

  if (!trechoUtil) {
    await admin
      .from("crm_call_recordings")
      .update({ live_state: { ...estado, chunks } })
      .eq("id", call.id)
      .eq("organization_id", call.organization_id);
    return ok({ texto: "", sugestao: null }, { requestId });
  }

  // ---- 2. a sugestão ----
  let sugestao: LiveCallSuggestion | null = null;
  const podeSugerir =
    trechoUtil.length >= MIN_CHARS_PARA_SUGERIR && isModelConfigured(DEFAULT_CLASSIFIER_MODEL);

  if (podeSugerir) {
    sugestao = await sugerir({
      janela: recortarJanela(transcricao),
      ultimoTrecho: trechoUtil,
      estado: {
        fase: estado.fase,
        cobertura: estado.cobertura ?? COBERTURA_VAZIA,
      },
      segundos,
      contexto: await contextoDoLead(admin, call.organization_id, call.lead_id),
      organizationId: call.organization_id,
    });
  }

  const novoEstado = {
    ...estado,
    chunks,
    ...(sugestao
      ? {
          fase: sugestao.fase,
          sugestao: sugestao.sugestao,
          alerta: sugestao.alerta,
          // O checklist NUNCA desmarca: o modelo enxerga só a janela recente, e
          // sem esta trava um item marcado no minuto 1 apagaria no minuto 4 —
          // o SDR veria o roteiro "desandar" sozinho e perderia a confiança na
          // única parte da tela que ele consulta de relance.
          cobertura: mesclarCobertura(estado.cobertura, sugestao.cobertura),
        }
      : {}),
  };

  const { error: updErr } = await admin
    .from("crm_call_recordings")
    .update({ transcript: transcricao, live_state: novoEstado })
    .eq("id", call.id)
    .eq("organization_id", call.organization_id);
  if (updErr) {
    logger.warn("[calls/live] não gravou o bloco", {
      call_id: call.id,
      detail: updErr.message,
      requestId,
    });
  }

  return ok(
    {
      texto: trechoUtil,
      sugestao: sugestao
        ? {
            fase: sugestao.fase,
            sugestao: sugestao.sugestao,
            alerta: sugestao.alerta,
            cobertura: novoEstado.cobertura ?? COBERTURA_VAZIA,
          }
        : null,
    },
    { requestId },
  );
}

/** `true` vence sempre — ver o comentário no ponto de uso. */
function mesclarCobertura(
  anterior: Record<string, boolean> | undefined,
  nova: Record<string, boolean>,
): Record<string, boolean> {
  const base = anterior ?? COBERTURA_VAZIA;
  const saida: Record<string, boolean> = { ...base };
  for (const [k, v] of Object.entries(nova)) saida[k] = Boolean(saida[k]) || Boolean(v);
  return saida;
}

/**
 * Uma chamada e, se o JSON não colar, EXATAMENTE mais uma com a instrução de
 * formato — o mesmo contrato do worker de análise e do copiloto de reuniões.
 * Repetir o mesmo prompt esperando resposta diferente é pagar o dobro pela
 * mesma resposta.
 */
async function sugerir(opts: {
  janela: string;
  ultimoTrecho: string;
  estado: Record<string, unknown>;
  segundos: number;
  contexto: string | null;
  organizationId: string;
}): Promise<LiveCallSuggestion | null> {
  const cfg = gatewayConfig();
  const headers = cfg ? gatewayHeaders({ organizationId: opts.organizationId }) : undefined;
  const user = liveCallUserPrompt({
    janela: opts.janela,
    ultimoTrecho: opts.ultimoTrecho,
    estado: opts.estado,
    segundos: opts.segundos,
    contexto: opts.contexto,
  });

  for (const prompt of [user, user + RETRY_DE_FORMATO_LIGACAO]) {
    try {
      const res = await generateText({
        model: resolveModel(DEFAULT_CLASSIFIER_MODEL),
        system: liveCallSystemPrompt(),
        messages: [{ role: "user", content: prompt }],
        headers,
      });
      const parsed = parseLiveCallSuggestion(res.text ?? "");
      if (parsed) return parsed;
    } catch (err) {
      // Uma sugestão perdida custa nada; insistir custa o tempo do SDR.
      logger.warn("[calls/live] modelo falhou", {
        detail: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  return null;
}

/**
 * O que o CRM já sabe do lead, em duas linhas.
 *
 * Sem isto a sugestão é boa mas genérica; com isto ela cita o negócio pelo nome
 * e o gancho pelo qual o lead foi abordado — que é a diferença entre um
 * copiloto e um teleprompter. Query separada e tolerante a falha: se não vier,
 * o copiloto trabalha sem.
 */
async function contextoDoLead(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string | null,
): Promise<string | null> {
  if (!leadId) return null;
  const { data } = await admin
    .from("crm_leads")
    .select("title, description")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  const linhas = [data.title, data.description].filter(Boolean).join(" — ");
  return linhas ? linhas.slice(0, JANELA_MAX_CHARS / 4) : null;
}
