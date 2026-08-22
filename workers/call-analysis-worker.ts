/**
 * Consome `call.transcribe_requested`: baixa o áudio da ligação, transcreve
 * (Groq Whisper) e analisa contra a rubrica de coaching (o modelo de
 * `AI_ANALYSIS_MODEL`, padrão `DEFAULT_BOT_MODEL`).
 *
 * Retry/backoff são do drain (`lib/event-log/drain.ts`), não daqui — este
 * handler só devolve `status:"error"` e, na última tentativa que o drain ainda
 * permite, escreve o motivo legível em `error_detail` para o SDR ver na tela.
 * Mesmo contrato do media-persist/media-derive.
 *
 * Service-role caveat (CLAUDE.md §multi-tenancy): o admin client bypassa RLS,
 * então TODA query aqui filtra `organization_id` com o valor da linha do
 * `event_log` (fonte confiável), nunca de input de usuário.
 *
 * ⚠️ LACUNA CONHECIDA (fase 2): o custo desta análise não entra em
 * `ai_invocations`, então não conta no orçamento de IA da org (`ai_budgets`). O
 * gateway recebe `X-AI-Gateway-Tenant-Id` e fatia o gasto por org no painel
 * dele, mas o alarme de orçamento do CRM não enxerga. Fechar isso exige
 * `ai_invocations.agent_id` aceitar nulo (a análise não pertence a agente
 * nenhum) ou um `invocation_kind` novo — schema, e por isso ficou de fora desta
 * entrega em vez de entrar meia.
 */
import { generateText } from "ai";

import {
  analysisModel,
  gatewayConfig,
  gatewayHeaders,
  isModelConfigured,
  resolveModel,
  type ModelId,
} from "@/lib/ai/gateway";
import { buildCallAnalysisPrompt } from "@/lib/calls/analysis-prompt";
import { CallAnalysisSchema, type CallAnalysis } from "@/lib/calls/analysis-schema";
import { LIVE_CHUNK_SECONDS, parseLiveState } from "@/lib/calls/live-schema";
import { CALL_BUCKET } from "@/lib/calls/storage";
import { groqTranscriptionProvider } from "@/lib/calls/transcribe";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const CALL_ANALYSIS_CONSUMER_KEY = "call_analysis_v1";

/** Espelho de MAX_ATTEMPTS de lib/event-log/drain.ts (não exportado de lá). */
const DRAIN_MAX_ATTEMPTS = 5;

interface CallRow {
  id: string;
  organization_id: string;
  contact_id: string;
  lead_id: string | null;
  status: string;
  storage_path: string | null;
  mime_type: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  sdr_notes: string | null;
  live_state: unknown;
}

export async function analyzeCallRecording(row: EventRow): Promise<HandlerResult> {
  const consumer_key = CALL_ANALYSIS_CONSUMER_KEY;
  const callId = (row.payload.call_id as string | undefined) ?? row.entity_id;
  if (!callId) return { consumer_key, status: "skipped", detail: "no call_id" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_call_recordings")
    .select("id, organization_id, contact_id, lead_id, status, storage_path, mime_type, transcript, duration_seconds, sdr_notes, live_state")
    .eq("id", callId)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) return { consumer_key, status: "error", detail: error.message };

  const call = data as CallRow | null;
  if (!call) return { consumer_key, status: "skipped", detail: "call not found" };
  if (!call.storage_path) return { consumer_key, status: "skipped", detail: "no audio" };
  if (call.status === "done" || call.status === "done_unformatted") {
    return { consumer_key, status: "skipped", detail: "already analyzed" };
  }

  const isLastAttempt = row.attempts >= DRAIN_MAX_ATTEMPTS - 1;

  /** Falha visível na tela em vez de silêncio. */
  const markFailed = async (detail: string) => {
    await admin
      .from("crm_call_recordings")
      .update({ status: "failed", error_detail: detail })
      .eq("id", call.id)
      .eq("organization_id", call.organization_id);
  };

  // ---- configuração ausente não é falha transitória ----
  // Sem chave, tentar cinco vezes só gasta cinco vezes o mesmo erro. Marca já e
  // devolve `skipped`, que o drain não reagenda.
  const transcriber = groqTranscriptionProvider();
  if (!transcriber) {
    await markFailed(
      "Transcrição indisponível: falta configurar GROQ_API_KEY no servidor.",
    );
    return { consumer_key, status: "skipped", detail: "groq_key_missing" };
  }
  const modelo = analysisModel();
  if (!isModelConfigured(modelo)) {
    await markFailed(
      `Análise indisponível: falta configurar no servidor a chave do provedor de "${modelo}".`,
    );
    return { consumer_key, status: "skipped", detail: "analysis_model_key_missing" };
  }

  try {
    // ---- 1. transcrição ----
    // Reaproveita a transcrição de uma tentativa anterior: o áudio não mudou, e
    // repetir o Whisper depois de a análise ter falhado paga duas vezes pela
    // mesma coisa.
    let transcript = call.transcript?.trim() ?? "";

    // Transcrição ao vivo PELA METADE é pior que nenhuma: a análise sairia
    // confiante em cima de meia ligação, e ninguém veria o que faltou. Se o
    // copiloto rodou (chunks > 0) mas cobriu menos de 70% da duração — internet
    // caiu, o Groq recusou blocos, a aba dormiu —, o texto parcial é descartado
    // e o áudio íntegro vai para o Whisper, que é o caminho que sempre cobriu
    // tudo. Ligação sem copiloto (chunks = 0) não entra nesta conta: ali o
    // `transcript` só existe se veio do Whisper numa tentativa anterior.
    const aoVivo = parseLiveState(call.live_state);
    const blocosAoVivo = aoVivo.chunks ?? 0;
    const blocosEsperados = Math.floor((call.duration_seconds ?? 0) / LIVE_CHUNK_SECONDS);
    if (transcript && blocosAoVivo > 0 && blocosEsperados > 1 && blocosAoVivo < blocosEsperados * 0.7) {
      logger.warn("[call-analysis] transcrição ao vivo incompleta, refazendo pelo áudio", {
        call_id: call.id,
        blocos: blocosAoVivo,
        esperados: blocosEsperados,
      });
      transcript = "";
    }

    if (!transcript) {
      const dl = await admin.storage.from(CALL_BUCKET).download(call.storage_path);
      if (dl.error || !dl.data) {
        throw new Error(`storage_download_failed: ${dl.error?.message ?? "no_data"}`);
      }
      const buffer = Buffer.from(await dl.data.arrayBuffer());
      transcript = (
        await transcriber.transcribe(buffer, call.mime_type ?? "audio/webm")
      ).trim();

      if (!transcript) {
        // Áudio mudo é desfecho legítimo, não erro: o SDR gravou com o microfone
        // errado, ou ninguém falou. Reprocessar não conserta.
        await admin
          .from("crm_call_recordings")
          .update({
            status: "failed",
            transcript: "",
            error_detail:
              "A transcrição saiu vazia — o microfone pode não ter captado a chamada. Confira se a ligação estava no viva-voz perto do computador.",
          })
          .eq("id", call.id)
          .eq("organization_id", call.organization_id);
        return { consumer_key, status: "skipped", detail: "empty_transcript" };
      }

      await admin
        .from("crm_call_recordings")
        .update({ transcript, status: "analyzing" })
        .eq("id", call.id)
        .eq("organization_id", call.organization_id);
    } else {
      await admin
        .from("crm_call_recordings")
        .update({ status: "analyzing" })
        .eq("id", call.id)
        .eq("organization_id", call.organization_id);
    }

    // ---- 2. análise ----
    const { analysis, raw } = await runAnalysis(transcript, call.organization_id, modelo, {
      notas: call.sdr_notes,
      cobertura: aoVivo.cobertura ?? null,
    });

    if (!analysis) {
      // Nem o retry produziu JSON. Guarda a prosa: o coach lê e o SDR aproveita
      // a ligação, em vez de perder a análise inteira (e o dinheiro dela) por um
      // problema de formatação.
      await admin
        .from("crm_call_recordings")
        .update({
          status: "done_unformatted",
          analysis: { raw },
          error_detail: "O modelo não devolveu JSON válido; a avaliação está em texto.",
        })
        .eq("id", call.id)
        .eq("organization_id", call.organization_id);
      await emitAnalyzedActivity(admin, call, null);
      return { consumer_key, status: "ok", detail: "done_unformatted" };
    }

    await admin
      .from("crm_call_recordings")
      .update({
        status: "done",
        analysis,
        outcome: analysis.resultado,
        score: analysis.nota_geral,
        error_detail: null,
      })
      .eq("id", call.id)
      .eq("organization_id", call.organization_id);

    await emitAnalyzedActivity(admin, call, analysis);
    return { consumer_key, status: "ok" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (isLastAttempt) {
      logger.error("[call-analysis] falhou definitivamente", { call_id: call.id, detail });
      await markFailed(`Falha ao processar a ligação: ${detail}`);
    }
    return { consumer_key, status: "error", detail };
  }
}

/**
 * Uma chamada ao modelo e, se o JSON não colar, EXATAMENTE mais uma.
 *
 * A segunda não repete a primeira: acrescenta a instrução de formato ao final.
 * Repetir o mesmo prompt esperando resultado diferente é gastar o dobro pela
 * mesma resposta — o que muda o desfecho é dizer ao modelo o que deu errado.
 */
async function runAnalysis(
  transcript: string,
  organizationId: string,
  modelo: ModelId,
  extras: { notas: string | null; cobertura: Record<string, boolean> | null } = {
    notas: null,
    cobertura: null,
  },
): Promise<{ analysis: CallAnalysis | null; raw: string }> {
  const cfg = gatewayConfig();
  const headers = cfg ? gatewayHeaders({ organizationId }) : undefined;
  const prompt = buildCallAnalysisPrompt(transcript, extras);

  const tentativas = [
    prompt,
    `${prompt}\n\nATENÇÃO: sua resposta anterior não era JSON válido. Responda APENAS com o objeto JSON, começando em { e terminando em }, sem markdown, sem cercas de código e sem nenhum texto antes ou depois.`,
  ];

  let ultimoTexto = "";
  for (const p of tentativas) {
    const res = await generateText({
      // `resolveModel` e não a string crua: sem `AI_GATEWAY_API_KEY` no
      // servidor, `"anthropic/..."` morre com "Unauthenticated request to AI
      // Gateway" mesmo havendo `ANTHROPIC_API_KEY` — foi o que engoliu as
      // primeiras análises reais em 11/08/2026 (transcrição pronta, avaliação
      // nunca). O worker de reuniões já passa por aqui; este ficou de fora.
      model: resolveModel(modelo),
      messages: [{ role: "user", content: p }],
      headers,
    });
    ultimoTexto = res.text ?? "";
    const parsed = parseAnalysis(ultimoTexto);
    if (parsed) return { analysis: parsed, raw: ultimoTexto };
  }

  return { analysis: null, raw: ultimoTexto };
}

/**
 * O JSON de dentro da resposta.
 *
 * O prompt pede JSON puro, mas cerca de código (```json) é o desvio mais comum e
 * mais barato de tolerar — recusar por causa das crases queimaria uma tentativa
 * inteira por três caracteres. O que NÃO é tolerado é conteúdo fora do formato:
 * o Zod valida faixa de nota e vocabulário de resultado, e o que não passar cai
 * no caminho `done_unformatted` em vez de virar `NaN` numa média.
 */
export function parseAnalysis(texto: string): CallAnalysis | null {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) return null;

  let cru: unknown;
  try {
    cru = JSON.parse(limpo.slice(inicio, fim + 1));
  } catch {
    return null;
  }

  const parsed = CallAnalysisSchema.safeParse(cru);
  return parsed.success ? parsed.data : null;
}

/**
 * A linha na timeline do negócio.
 *
 * A `reason` é a "nota resumida no negócio" que o módulo pede: nota geral + o
 * principal ponto de melhoria. Ela é PII-FREE de propósito — aparece na tela e
 * sai no export LGPD, e o campo `acertos` da análise pede explicitamente
 * "trechos curtos da transcrição", ou seja, cita a fala do lead. Por isso o que
 * vai para a `reason` é o ponto de melhoria (coaching sobre o SDR) e nunca um
 * acerto (citação do lead). A análise inteira continua acessível pelo card, sob
 * controle de acesso, e some na anonimização.
 *
 * Ator `webhook_source` → `actor_kind = 'system'`: o produto agiu. Não é `ai`
 * porque `ai` exige lastro (`run_ids`/`llm_call_ids`) pela constraint da 0071, e
 * esta análise não passa pelo motor de agentes — não há run para apontar.
 * Afirmar autoria da IA sem prova é exatamente o que aquela regra impede.
 */
async function emitAnalyzedActivity(
  admin: ReturnType<typeof createAdminClient>,
  call: CallRow,
  analysis: CallAnalysis | null,
): Promise<void> {
  if (!call.lead_id) return; // ligação sem negócio roteado: nada a que pendurar

  const reason = analysis
    ? `Ligação analisada — nota ${formatNota(analysis.nota_geral)}/10. A melhorar: ${primeiroPonto(analysis)}`
    : "Ligação analisada — o modelo não devolveu a avaliação no formato esperado; o texto está na atividade.";

  const r = await emitLeadActivity(admin, {
    organizationId: call.organization_id,
    leadId: call.lead_id,
    contactId: call.contact_id,
    type: "call_analyzed",
    sourceModule: "calls",
    sourceId: call.id,
    actor: { type: "webhook_source", id: "calls" },
    reason,
    payload: {
      call_id: call.id,
      ...(analysis
        ? { resultado: analysis.resultado, nota_geral: analysis.nota_geral }
        : { unformatted: true }),
    },
  });
  if (!r.ok) {
    logger.warn("[call-analysis] atividade call_analyzed não gravada", {
      call_id: call.id,
      detail: r.error,
    });
  }
}

/** `8` e não `8.0`; `7.5` continua `7,5` para quem lê em português. */
function formatNota(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace(".", ",");
}

/** O primeiro ponto de melhoria, encurtado para caber numa linha da timeline. */
function primeiroPonto(analysis: CallAnalysis): string {
  const p = analysis.pontos_de_melhoria[0]?.trim() ?? "";
  if (!p) return "sem apontamentos";
  return p.length > 160 ? `${p.slice(0, 157)}…` : p;
}
