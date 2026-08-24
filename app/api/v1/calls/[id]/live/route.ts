/**
 * POST /api/v1/calls/[id]/live — o copiloto ao vivo da ligação.
 *
 * O popup manda um bloco de áudio de ~5 s (um arquivo COMPLETO, não um pedaço
 * de stream: o gravador é reiniciado a cada bloco justamente para que cada um
 * seja decodificável sozinho). Aqui o bloco é transcrito pelo Groq Whisper e
 * APENSADO em `crm_call_recordings.transcript`.
 *
 * BLOCO ≠ CHAMADA AO MODELO. O texto sobe a cada bloco (é o que faz a tela
 * andar), mas o Haiku só é acordado quando junta fala suficiente — ver
 * `MIN_CHARS_PARA_SUGERIR`. Ele devolve a próxima frase para o SDR falar, em
 * que degrau da dor a conversa está, e o checklist do roteiro.
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
import { fecharAConta, type ContaDaDor, type NumerosDaDor } from "@/lib/calls/conta-da-dor";
import {
  JANELA_MAX_CHARS,
  RETRY_DE_FORMATO_LIGACAO,
  liveCallSystemPrompt,
  liveCallUserPrompt,
  recortarJanela,
} from "@/lib/calls/live-prompt";
import {
  COBERTURA_VAZIA,
  degrauDaCobertura,
  faseDaCobertura,
  parseLiveCallSuggestion,
  parseLiveState,
  type CallPhase,
  type Cobertura,
  type CoberturaKey,
  type DegrauDaDor,
  type LiveCallSuggestion,
  type Numeros,
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
 * 8 MB. Um bloco de 5 s em Opus 32 kbps tem ~20 KB — o teto existe para
 * recusar um upload errado (a ligação inteira, um vídeo) antes de ele virar
 * chamada ao Whisper, não para apertar o caso normal.
 */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Quanta fala NOVA precisa juntar antes de acordar o modelo.
 *
 * O bloco encolheu de 15 s para 5 s para a transcrição chegar rápido na tela,
 * mas um pedaço de 5 s quase nunca é uma fala inteira — pedir sugestão em cima
 * de meia frase gasta dinheiro para trocar, na tela, uma sugestão boa por uma
 * genérica. Então o bloco e a chamada ao modelo deixaram de ser a mesma coisa:
 * o texto é apensado sempre, e o que ainda não foi mostrado ao modelo se
 * acumula em `live_state.pendente` até dar ~uma fala (45 caracteres, uns 8
 * segundos de conversa contínua). Silêncio não acumula nada e não custa nada.
 *
 * Efeito na conta: mesmo com 3x mais blocos, o número de chamadas ao modelo
 * fica na mesma ordem de antes — o que aumenta é só o Groq, que é centavos.
 */
const MIN_CHARS_PARA_SUGERIR = 45;

/**
 * Teto de saída do modelo. O JSON do copiloto tem quatro campos curtos; sem
 * teto o Haiku às vezes escreve um parágrafo de justificativa antes do objeto,
 * e cada token a mais é tempo com o SDR esperando na tela.
 */
const MAX_OUTPUT_TOKENS = 220;

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
  // O que ainda não foi mostrado ao modelo. Bloco de 5 s raramente é uma fala
  // inteira: acumular aqui é o que separa "transcrição rápida na tela" de
  // "chamada ao modelo", que antes eram a mesma coisa por acidente.
  //
  // O recorte não é zelo: quando o modelo está fora do ar (conta sem crédito é
  // o caso real), nada nunca zera o pendente e ele viraria a ligação inteira
  // dentro do `live_state` — e, na hora que o modelo voltasse, a primeira
  // chamada levaria dez minutos de conversa de uma vez. Cortado pelo fim, é a
  // fala recente que sobrevive, que é a única que ainda serve de sugestão.
  const pendente = recortarJanela([estado.pendente ?? "", trechoUtil].filter(Boolean).join(" "));

  let sugestao: LiveCallSuggestion | null = null;
  const podeSugerir =
    pendente.length >= MIN_CHARS_PARA_SUGERIR && isModelConfigured(DEFAULT_CLASSIFIER_MODEL);

  // O que o CRM sabe do lead não muda no meio da ligação: uma consulta por
  // ligação, guardada no estado. Antes era uma ida ao banco em TODO bloco,
  // sempre devolvendo a mesma linha, e ela ficava na frente do modelo no
  // caminho crítico — tempo puro com o SDR olhando a tela parada.
  let contexto = estado.contexto;
  if (podeSugerir && contexto === undefined) {
    contexto = await contextoDoLead(admin, call.organization_id, call.lead_id);
  }

  // A ETAPA NÃO É PERGUNTADA AO MODELO — é deduzida do checklist e entregue a
  // ele pronta. Ver `faseDaCobertura` em `live-schema.ts` para o porquê (a fase
  // andava para trás, e podia dizer "agendamento" com a dor por declarar).
  const coberturaAtual = estado.cobertura ?? COBERTURA_VAZIA;

  if (podeSugerir) {
    sugestao = await sugerir({
      janela: recortarJanela(transcricao),
      ultimoTrecho: pendente,
      estado: { cobertura: coberturaAtual },
      fase: faseDaCobertura(coberturaAtual),
      degrau: degrauDaCobertura(coberturaAtual),
      segundos,
      contexto: contexto ?? null,
      eixo: estado.eixo ?? null,
      // A conta é fechada em CÓDIGO, com os números que o dono já deu, e chega
      // ao modelo como frase pronta. Ver `conta-da-dor.ts`: modelo pequeno
      // errando multiplicação na frente do dono é o pior defeito desta tela.
      conta: fecharAConta(numerosDoEstado(estado.numeros)),
      desviosDoNumero: estado.desviou_do_numero ?? 0,
      organizationId: call.organization_id,
    });
  }

  // O checklist NUNCA desmarca: o modelo enxerga só a janela recente, e sem
  // esta trava um item marcado no minuto 1 apagaria no minuto 4 — o SDR veria o
  // roteiro "desandar" sozinho e perderia a confiança na única parte da tela que
  // ele consulta de relance. Como a fase sai daqui, a trava agora também é o que
  // garante que a ETAPA só anda para frente.
  const coberturaNova = sugestao
    ? mesclarCobertura(coberturaAtual, sugestao.cobertura)
    : coberturaAtual;
  const faseNova = faseDaCobertura(coberturaNova);
  const degrauNovo = degrauDaCobertura(coberturaNova);

  // O EIXO TRAVA NA PRIMEIRA ESCOLHA. Ele é o galho da ligação: escolhido
  // quando a dor aparece, ele guia espelho, aprofunda, número e ponte. Deixar o
  // modelo reescolher a cada chamada devolveria o defeito que o eixo existe
  // para resolver — a janela desliza, a dor original sai dela, e o copiloto
  // volta ao genérico no minuto 5. Trocar é decisão do roteiro (dor claramente
  // outra e maior), não consequência de a conversa ter dado uma volta, e o
  // modelo não tem como provar isso olhando três frases.
  const eixoNovo = estado.eixo ?? sugestao?.eixo ?? null;

  // Os números do dono se acumulam: ele dá a quantidade num momento e o valor
  // no seguinte. Sem juntar, a conta nunca fecharia — cada chamada veria metade.
  const numerosNovos = mesclarNumeros(estado.numeros ?? null, sugestao?.numeros ?? null);

  // O contador zera quando ele finalmente dá o número. Só sobe em esquiva
  // seguida — quem responde e depois desconversa outra vez não está fugindo, e
  // desistir dele cedo demais perde a parte que faz a R1 valer.
  const desvios = coberturaNova.numero_dele
    ? 0
    : sugestao?.desviou_do_numero
      ? (estado.desviou_do_numero ?? 0) + 1
      : (estado.desviou_do_numero ?? 0);

  const novoEstado = {
    ...estado,
    chunks,
    ...(contexto === undefined ? {} : { contexto }),
    // Zera só quando o modelo de fato viu o texto. Se a chamada falhou, o
    // pendente continua acumulando e entra na tentativa seguinte — perder um
    // bloco de fala é o que faria a sugestão citar algo que ninguém disse.
    pendente: sugestao ? "" : pendente,
    ...(sugestao
      ? {
          fase: faseNova,
          degrau: degrauNovo,
          sugestao: sugestao.sugestao,
          tipo: sugestao.tipo,
          alerta: sugestao.alerta,
          cobertura: coberturaNova,
          eixo: eixoNovo,
          numeros: numerosNovos,
          desviou_do_numero: desvios,
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
            fase: faseNova,
            degrau: degrauNovo,
            sugestao: sugestao.sugestao,
            tipo: sugestao.tipo,
            alerta: sugestao.alerta,
            eixo: eixoNovo,
            objecao: sugestao.objecao,
            cobertura: coberturaNova,
          }
        : null,
    },
    { requestId },
  );
}

/**
 * O `numeros` do estado, já no formato que `fecharAConta` entende.
 *
 * O zod do estado usa `valor_unitario` (snake_case, é o que o modelo devolve) e
 * a conta usa `valorUnitario` — a tradução mora aqui, num lugar só, em vez de
 * espalhada pelos dois pontos de uso.
 */
function numerosDoEstado(n: Numeros | null | undefined): NumerosDaDor | null {
  if (!n) return null;
  return { quantidade: n.quantidade, periodo: n.periodo, valorUnitario: n.valor_unitario };
}

/**
 * Junta o que o dono já tinha dito com o que ele acabou de dizer.
 *
 * A quantidade e o valor quase nunca vêm na mesma fala: ele diz "umas duas por
 * semana" e só duas perguntas depois diz "uns 800 reais". Campo novo sobrescreve
 * o antigo (ele corrigiu), campo ausente preserva (ele não falou disso agora).
 */
function mesclarNumeros(anterior: Numeros | null, novo: Numeros | null): Numeros | null {
  if (!novo) return anterior;
  if (!anterior) return novo;
  return {
    quantidade: novo.quantidade,
    periodo: novo.periodo,
    valor_unitario: novo.valor_unitario ?? anterior.valor_unitario,
  };
}

/** `true` vence sempre — ver o comentário no ponto de uso. */
function mesclarCobertura(anterior: Partial<Cobertura> | undefined, nova: Partial<Cobertura>): Cobertura {
  const saida: Cobertura = { ...COBERTURA_VAZIA, ...(anterior ?? {}) };
  for (const [k, v] of Object.entries(nova)) {
    const chave = k as CoberturaKey;
    saida[chave] = Boolean(saida[chave]) || Boolean(v);
  }
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
  fase: CallPhase;
  degrau: DegrauDaDor | null;
  eixo: string | null;
  conta: ContaDaDor | null;
  desviosDoNumero: number;
}): Promise<LiveCallSuggestion | null> {
  const cfg = gatewayConfig();
  const headers = cfg ? gatewayHeaders({ organizationId: opts.organizationId }) : undefined;
  const user = liveCallUserPrompt({
    janela: opts.janela,
    ultimoTrecho: opts.ultimoTrecho,
    estado: opts.estado,
    segundos: opts.segundos,
    contexto: opts.contexto,
    fase: opts.fase,
    degrau: opts.degrau,
    eixo: opts.eixo,
    conta: opts.conta,
    desviosDoNumero: opts.desviosDoNumero,
  });

  // O roteiro inteiro (~1.500 tokens) é IGUAL em toda chamada da ligação e
  // entre ligações. Marcado como prefixo cacheável, o provedor para de reler
  // esse bloco a cada bloco de áudio: a resposta chega mais cedo e o pedaço
  // cacheado custa uma fração. É o mesmo padrão do agent-engine
  // (`lib/agent-engine/edge/llm/stable-prefix.ts`), aqui em miniatura porque
  // não há tools nem playbook por org — só o system.
  //
  // TTL de 5 min de propósito: o cache precisa sobreviver ao intervalo entre
  // um bloco e o seguinte (segundos), não ao dia. Nada volátil pode entrar
  // neste texto, ou o cache nunca acerta — por isso tempo, lead e transcrição
  // vivem na mensagem do usuário, DEPOIS do breakpoint.
  const system = {
    role: "system" as const,
    content: liveCallSystemPrompt(),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } } },
  };

  for (const prompt of [user, user + RETRY_DE_FORMATO_LIGACAO]) {
    try {
      const res = await generateText({
        model: resolveModel(DEFAULT_CLASSIFIER_MODEL),
        system,
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
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
