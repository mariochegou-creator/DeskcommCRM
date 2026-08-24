/**
 * POST /api/v1/meetings/[id]/live-suggest — o cérebro do copiloto ao vivo.
 *
 * A extensão manda a janela recente de turnos; o Haiku marca o checklist e
 * escreve a próxima frase. A FASE NÃO É PERGUNTADA AO MODELO — é calculada do
 * checklist (`faseDaCobertura`) e entregue pronta, então nunca anda para trás
 * nem contradiz o que já aconteceu. É o motor do copiloto da ligação
 * (`app/api/v1/calls/[id]/live/route.ts`) portado para a reunião:
 *
 * - checklist com merge só-liga (`true` vence; resposta ruim não apaga memória);
 * - palavra-eixo travada na primeira escolha;
 * - conta da dor fechada em CÓDIGO (`conta-da-dor.ts`), nunca pelo modelo;
 * - contador de esquivas do número, com regra de desistir;
 * - contexto do lead buscado UMA vez por reunião, guardado no estado;
 * - system fixo por tipo marcado como prefixo cacheável (TTL 5 min);
 * - teto de tokens de saída (o JSON tem campos curtos).
 *
 * A sugestão é PERSISTIDA em `crm_meeting_suggestions` (sem isso o coaching não
 * mede "seguiu?"), e o estado volta para `crm_meetings.live_state` — agora
 * MESCLADO, nunca sobrescrito.
 *
 * O modelo é o CLASSIFIER (Haiku): 2-4 chamadas/min a centavos. A chave nunca
 * sai do servidor; o custo é fatiado por org pelo header do gateway.
 *
 * ⚠️ LACUNA CONHECIDA (mesma do worker de ligações): o custo não entra em
 * `ai_invocations` — `agent_id` é NOT NULL lá e esta chamada não pertence a
 * agente nenhum. Fechar exige schema; fica de fora em vez de entrar meio.
 */
import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import {
  DEFAULT_CLASSIFIER_MODEL,
  gatewayHeaders,
  isAiGatewayConfigured,
  resolveModel,
} from "@/lib/ai/gateway";
import { fecharAConta, type NumerosDaDor } from "@/lib/calls/conta-da-dor";
import { rotuloDoEixo } from "@/lib/calls/palavras-eixo";
import { logger } from "@/lib/logger";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import {
  faseDaCobertura,
  mesclarCobertura,
  parseLiveMeetingState,
  parseLiveSuggestion,
  OBJECAO_REUNIAO_LABELS,
  type LiveSuggestion,
  type Numeros,
} from "@/lib/sala-reunioes/live-schema";
import {
  CONTEXTO_MAX_CHARS,
  liveSystemPrompt,
  liveUserPrompt,
  RETRY_DE_FORMATO,
} from "@/lib/sala-reunioes/live-prompt";
import {
  MEETING_PHASE_LABELS,
  MEETING_TYPE_LABELS,
  type MeetingPhase,
  type MeetingTurn,
  type MeetingType,
} from "@/lib/sala-reunioes/vocabulary";
import { meetingTurnSchema } from "@/lib/schemas/sala-reunioes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * Teto de saída do modelo. O JSON do copiloto tem campos curtos; sem teto o
 * Haiku às vezes escreve um parágrafo de justificativa antes do objeto, e cada
 * token a mais é tempo com o vendedor esperando na tela. 300 (e não os 220 da
 * ligação) porque os scripts de objeção da R2 são os mais longos do contrato.
 */
const MAX_OUTPUT_TOKENS = 300;

const Body = z.object({
  /** A janela recente — a extensão manda os últimos ~30 turnos. */
  turns: z.array(meetingTurnSchema).min(1).max(60),
});

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body ?? {});
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Corpo inválido.", 422, {
        requestId,
        details: { issues: parsed.error.issues },
      }),
      req,
    );
  }

  const admin = createAdminClient();
  const { data: meeting, error: loadErr } = await admin
    .from("crm_meetings")
    .select("id, status, meeting_type, live_state, lead_id")
    .eq("id", id)
    .eq("organization_id", authz.orgId)
    .maybeSingle();
  if (loadErr) {
    return withCorsHeaders(fail("internal_error", loadErr.message, 500, { requestId }), req);
  }
  if (!meeting) {
    return withCorsHeaders(fail("not_found", "Reunião não encontrada.", 404, { requestId }), req);
  }
  if (meeting.status !== "ao_vivo") {
    return withCorsHeaders(
      fail("meeting_not_live", "A reunião já foi encerrada.", 409, { requestId }),
      req,
    );
  }
  if (!isAiGatewayConfigured()) {
    return withCorsHeaders(
      fail(
        "ai_not_configured",
        "IA indisponível: falta AI_GATEWAY_API_KEY (ou ANTHROPIC_API_KEY) no servidor.",
        503,
        { requestId },
      ),
      req,
    );
  }

  const turns = parsed.data.turns.sort((a, b) => a.i - b.i) as MeetingTurn[];
  const meetingType = meeting.meeting_type as MeetingType;
  const estado = parseLiveMeetingState(meeting.live_state);

  // A ETAPA NÃO É PERGUNTADA AO MODELO — deduzida do checklist, entregue pronta.
  const coberturaAtual = mesclarCobertura(meetingType, estado.cobertura, undefined);
  const fase = faseDaCobertura(meetingType, coberturaAtual);

  // O que o CRM sabe do lead não muda no meio da reunião: uma consulta por
  // reunião, guardada no estado — não uma por chamada, na frente do modelo.
  let contexto = estado.contexto;
  if (contexto === undefined) {
    contexto = await contextoDoLead(admin, authz.orgId, meeting.lead_id);
  }

  const suggestion = await runLiveModel({
    meetingType,
    turns,
    estado: { cobertura: coberturaAtual },
    fase,
    contexto: contexto ?? null,
    eixo: estado.eixo ?? null,
    // A conta é fechada em CÓDIGO, com os números que o cliente já deu, e chega
    // ao modelo como frase pronta — modelo pequeno errando multiplicação na
    // frente do cliente é o pior defeito possível desta tela.
    conta: fecharAConta(numerosDoEstado(estado.numeros)),
    desviosDoNumero: estado.desviou_do_numero ?? 0,
    organizationId: authz.orgId,
  });

  if (!suggestion) {
    // Nem o retry produziu JSON válido. O overlay mantém a sugestão anterior —
    // devolver 200 "sem sugestão" evita o client tratar isso como pane. O
    // contexto recém-buscado fica guardado para a próxima chamada não repetir
    // a consulta.
    if (contexto !== estado.contexto) {
      await admin
        .from("crm_meetings")
        .update({ live_state: { ...estado, contexto } })
        .eq("id", id)
        .eq("organization_id", authz.orgId);
    }
    return withCorsHeaders(ok({ suggestion: null }, { requestId }), req);
  }

  // O checklist NUNCA desmarca (`true` vence, chave estranha é descartada) — e
  // como a fase sai dele, a trava também é o que garante que a etapa só anda
  // para frente.
  const coberturaNova = mesclarCobertura(meetingType, coberturaAtual, suggestion.cobertura);
  const faseNova = faseDaCobertura(meetingType, coberturaNova);

  // O EIXO TRAVA NA PRIMEIRA ESCOLHA — a dor prioritária é o galho da reunião.
  // Deixar o modelo reescolher a cada chamada devolveria o defeito que o eixo
  // resolve: a janela desliza, a dor original sai dela, e o copiloto volta ao
  // genérico no minuto 15.
  const eixoNovo = estado.eixo ?? suggestion.eixo ?? null;

  // Os números do cliente se acumulam: quantidade num momento, valor no outro.
  const numerosNovos = mesclarNumeros(estado.numeros ?? null, suggestion.numeros);

  // R2: a nota do Pit 1 e o investimento revelado ficam no estado — são o que a
  // apresentação amarra e o que a análise final confere.
  const notaPit1 = estado.nota_pit1 ?? suggestion.nota_pit1 ?? null;
  const investimento = suggestion.investimento ?? estado.investimento ?? null;

  // O contador zera quando ele finalmente dá o número. Só sobe em esquiva
  // seguida — desistir cedo demais perde a parte que faz a proposta valer.
  const numeroSaiu =
    meetingType === "r1" ? coberturaNova.implicacao_em_reais : coberturaNova.investimento_extraido;
  const desvios = numeroSaiu
    ? 0
    : suggestion.desviou_do_numero
      ? (estado.desviou_do_numero ?? 0) + 1
      : (estado.desviou_do_numero ?? 0);

  const atSeconds = turns[turns.length - 1]!.t;

  // Persistência ANTES da resposta: a linha é o que torna "seguiu o roteiro?"
  // mensurável — se falhar, avisa mas não engole a sugestão (o vendedor está no
  // meio de uma call; a fila do coaching não pode calar o overlay).
  const { error: insErr } = await admin.from("crm_meeting_suggestions").insert({
    organization_id: authz.orgId,
    meeting_id: id,
    at_seconds: atSeconds,
    phase_detected: faseNova,
    suggestion: suggestion.sugestao,
    alert: suggestion.alerta,
  });
  if (insErr) {
    logger.warn("[live-suggest] sugestão não persistida", {
      meeting_id: id,
      detail: insErr.message,
      requestId,
    });
  }

  // MESCLADO, nunca sobrescrito — sobrescrever era o que deixava uma resposta
  // ruim do modelo apagar a memória da reunião inteira.
  const { error: stateErr } = await admin
    .from("crm_meetings")
    .update({
      live_state: {
        ...estado,
        contexto,
        fase: faseNova,
        sugestao: suggestion.sugestao,
        tipo: suggestion.tipo,
        alerta: suggestion.alerta,
        cobertura: coberturaNova,
        eixo: eixoNovo,
        numeros: numerosNovos,
        nota_pit1: notaPit1,
        investimento,
        desviou_do_numero: desvios,
      },
    })
    .eq("id", id)
    .eq("organization_id", authz.orgId);
  if (stateErr) {
    logger.warn("[live-suggest] live_state não atualizado", {
      meeting_id: id,
      detail: stateErr.message,
      requestId,
    });
  }

  return withCorsHeaders(
    ok(
      {
        suggestion: {
          fase: faseNova,
          fase_label: faseLabel(meetingType, faseNova, eixoNovo),
          sugestao: suggestion.sugestao,
          tipo: suggestion.tipo,
          alerta: suggestion.alerta,
          eixo: rotuloDoEixo(eixoNovo),
          objecao: suggestion.objecao ? OBJECAO_REUNIAO_LABELS[suggestion.objecao] : null,
        },
      },
      { requestId },
    ),
    req,
  );
}

/** "R1 · Implicação · Espera" — o chip único que o overlay desenha. */
function faseLabel(tipo: MeetingType, fase: MeetingPhase, eixo: string | null): string {
  const partes = [MEETING_TYPE_LABELS[tipo].slice(0, 2), MEETING_PHASE_LABELS[fase]];
  const rotulo = rotuloDoEixo(eixo);
  if (rotulo) partes.push(rotulo);
  return partes.join(" · ");
}

/**
 * O `numeros` do estado, já no formato que `fecharAConta` entende — a tradução
 * snake_case (modelo) → camelCase (conta) mora aqui, num lugar só.
 */
function numerosDoEstado(n: Numeros | null | undefined): NumerosDaDor | null {
  if (!n) return null;
  return { quantidade: n.quantidade, periodo: n.periodo, valorUnitario: n.valor_unitario };
}

/**
 * Junta o que o cliente já tinha dito com o que acabou de dizer. Campo novo
 * sobrescreve (ele corrigiu), campo ausente preserva (não falou disso agora).
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

/**
 * Uma chamada e, se o JSON não colar, EXATAMENTE mais uma com a instrução de
 * formato — repetir o mesmo prompt esperando outra coisa é pagar o dobro pela
 * mesma resposta.
 */
async function runLiveModel(opts: {
  meetingType: MeetingType;
  turns: MeetingTurn[];
  estado: Record<string, unknown>;
  fase: MeetingPhase;
  contexto: string | null;
  eixo: string | null;
  conta: ReturnType<typeof fecharAConta>;
  desviosDoNumero: number;
  organizationId: string;
}): Promise<LiveSuggestion | null> {
  const headers = gatewayHeaders({ organizationId: opts.organizationId });
  const user = liveUserPrompt({
    turns: opts.turns,
    estado: opts.estado,
    fase: opts.fase,
    contexto: opts.contexto,
    eixo: opts.eixo,
    conta: opts.conta,
    desviosDoNumero: opts.desviosDoNumero,
    meetingType: opts.meetingType,
  });

  // O roteiro inteiro é IGUAL em toda chamada da reunião e entre reuniões do
  // mesmo tipo. Marcado como prefixo cacheável, o provedor para de reler esse
  // bloco a cada janela de turnos — mesma decisão do copiloto da ligação. TTL
  // de 5 min: precisa sobreviver ao intervalo entre chamadas, não ao dia. Nada
  // volátil entra neste texto — tempo, lead, estado e janela vivem na mensagem
  // do usuário, DEPOIS do breakpoint.
  const system = {
    role: "system" as const,
    content: liveSystemPrompt(opts.meetingType),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } } },
  };

  for (const prompt of [user, user + RETRY_DE_FORMATO]) {
    try {
      const res = await generateText({
        model: resolveModel(DEFAULT_CLASSIFIER_MODEL),
        system,
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        headers,
      });
      const parsed = parseLiveSuggestion(res.text ?? "");
      if (parsed) return parsed;
    } catch (err) {
      // Uma sugestão perdida custa nada; insistir custa o tempo do vendedor.
      logger.warn("[live-suggest] chamada ao modelo falhou", {
        detail: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  return null;
}

/**
 * O que o CRM já sabe do lead, em duas linhas — a diferença entre um copiloto
 * e um teleprompter. Query tolerante a falha: se não vier, trabalha sem.
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
  return linhas ? linhas.slice(0, CONTEXTO_MAX_CHARS) : null;
}
