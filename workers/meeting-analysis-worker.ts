/**
 * Consome `meeting.analysis_requested`: analisa a transcrição da reunião
 * (coaching SPIN/Pits via Claude no AI Gateway), carimba `was_followed` nas
 * sugestões do copiloto e emite a atividade `reuniao_analisada` na timeline.
 *
 * Retry/backoff são do drain (`lib/event-log/drain.ts`), não daqui — este
 * handler devolve `status:"error"` e, na última tentativa, escreve o motivo
 * legível em `analysis_error`. Mesmo contrato do call-analysis/media-derive.
 *
 * Service-role caveat (CLAUDE.md §multi-tenancy): o admin client bypassa RLS,
 * então TODA query filtra `organization_id` com o valor da linha do event_log.
 *
 * ⚠️ LACUNA CONHECIDA (mesma do worker de ligações): o custo não entra em
 * `ai_invocations` (`agent_id` é NOT NULL lá e esta análise não pertence a
 * agente nenhum). O gateway fatia o gasto por org via header; o orçamento de
 * IA do CRM não enxerga. Fechar exige schema — fica de fora em vez de meio.
 */
import { generateText } from "ai";

import {
  DEFAULT_BOT_MODEL,
  gatewayHeaders,
  isAiGatewayConfigured,
  resolveModel,
} from "@/lib/ai/gateway";
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import {
  ANALYSIS_RETRY_DE_FORMATO,
  buildMeetingAnalysisPrompt,
} from "@/lib/sala-reunioes/analysis-prompt";
import {
  parseMeetingAnalysis,
  type MeetingAnalysis,
} from "@/lib/sala-reunioes/analysis-schema";
import {
  MEETING_TYPE_LABELS,
  type MeetingTurn,
  type MeetingType,
} from "@/lib/sala-reunioes/vocabulary";
import { createAdminClient } from "@/lib/supabase/admin";

export const MEETING_ANALYSIS_CONSUMER_KEY = "meeting_analysis_v1";

/** Espelho de MAX_ATTEMPTS de lib/event-log/drain.ts (não exportado de lá). */
const DRAIN_MAX_ATTEMPTS = 5;

interface MeetingRow {
  id: string;
  organization_id: string;
  lead_id: string | null;
  contact_id: string | null;
  meeting_type: string;
  status: string;
  transcript: unknown;
}

export async function analyzeMeeting(row: EventRow): Promise<HandlerResult> {
  const consumer_key = MEETING_ANALYSIS_CONSUMER_KEY;
  const meetingId = (row.payload.meeting_id as string | undefined) ?? row.entity_id;
  if (!meetingId) return { consumer_key, status: "skipped", detail: "no meeting_id" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_meetings")
    .select("id, organization_id, lead_id, contact_id, meeting_type, status, transcript")
    .eq("id", meetingId)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) return { consumer_key, status: "error", detail: error.message };

  const meeting = data as MeetingRow | null;
  if (!meeting) return { consumer_key, status: "skipped", detail: "meeting not found" };
  if (meeting.status === "concluida" || meeting.status === "concluida_sem_formato") {
    return { consumer_key, status: "skipped", detail: "already analyzed" };
  }

  const turns = (Array.isArray(meeting.transcript) ? meeting.transcript : []) as MeetingTurn[];
  if (turns.length === 0) {
    // Encerrada sem fala nenhuma — desfecho legítimo, não erro.
    await admin
      .from("crm_meetings")
      .update({ status: "encerrada" })
      .eq("id", meeting.id)
      .eq("organization_id", meeting.organization_id);
    return { consumer_key, status: "skipped", detail: "empty transcript" };
  }

  const isLastAttempt = row.attempts >= DRAIN_MAX_ATTEMPTS - 1;

  /** Falha visível na tela em vez de "Analisando…" eterno. */
  const markFailed = async (detail: string) => {
    await admin
      .from("crm_meetings")
      .update({ status: "falhou", analysis_error: detail })
      .eq("id", meeting.id)
      .eq("organization_id", meeting.organization_id);
  };

  // Configuração ausente não é falha transitória: cinco tentativas seriam
  // cinco vezes o mesmo erro. Marca já e devolve skipped (drain não reagenda).
  if (!isAiGatewayConfigured()) {
    await markFailed(
      "Análise indisponível: falta configurar AI_GATEWAY_API_KEY (ou ANTHROPIC_API_KEY) no servidor.",
    );
    return { consumer_key, status: "skipped", detail: "ai_gateway_key_missing" };
  }

  try {
    const { data: sugRows, error: sugErr } = await admin
      .from("crm_meeting_suggestions")
      .select("id, at_seconds, suggestion")
      .eq("organization_id", meeting.organization_id)
      .eq("meeting_id", meeting.id)
      .order("at_seconds", { ascending: true });
    if (sugErr) throw new Error(`suggestions_load_failed: ${sugErr.message}`);
    const suggestions = sugRows ?? [];

    const { analysis, raw } = await runAnalysis({
      meetingType: meeting.meeting_type as MeetingType,
      turns,
      suggestions: suggestions.map((s) => ({
        at_seconds: Number(s.at_seconds),
        suggestion: s.suggestion,
      })),
      organizationId: meeting.organization_id,
    });

    if (!analysis) {
      // Nem o retry produziu JSON. Guarda a prosa — o coaching ainda vale a
      // leitura, em vez de perder a análise (e o dinheiro dela) por formatação.
      await admin
        .from("crm_meetings")
        .update({
          status: "concluida_sem_formato",
          coaching: { raw },
          analysis_error: "O modelo não devolveu JSON válido; a avaliação está em texto.",
        })
        .eq("id", meeting.id)
        .eq("organization_id", meeting.organization_id);
      await emitAnalyzedActivity(admin, meeting, null);
      return { consumer_key, status: "ok", detail: "concluida_sem_formato" };
    }

    // fases[] → objeto keyed por fase (o formato que a UI itera).
    const spinScores: Record<string, { nota: number; comentario: string }> = {};
    for (const f of analysis.fases) {
      spinScores[f.fase] = { nota: f.nota, comentario: f.comentario };
    }

    await admin
      .from("crm_meetings")
      .update({
        status: "concluida",
        summary: analysis.resumo,
        outcome: analysis.resultado,
        score: analysis.nota_geral,
        spin_scores: spinScores,
        coaching: analysis.coaching,
        analysis_error: null,
      })
      .eq("id", meeting.id)
      .eq("organization_id", meeting.organization_id);

    // was_followed pelo número 1-based da lista apresentada ao modelo — a
    // MESMA ordenação (at_seconds asc) usada no prompt.
    for (const veredito of analysis.sugestoes) {
      const alvo = suggestions[veredito.n - 1];
      if (!alvo) continue;
      await admin
        .from("crm_meeting_suggestions")
        .update({ was_followed: veredito.seguiu })
        .eq("id", alvo.id)
        .eq("organization_id", meeting.organization_id);
    }

    await emitAnalyzedActivity(admin, meeting, analysis);
    return { consumer_key, status: "ok" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (isLastAttempt) {
      logger.error("[meeting-analysis] falhou definitivamente", {
        meeting_id: meeting.id,
        detail,
      });
      await markFailed(`Falha ao analisar a reunião: ${detail}`);
    }
    return { consumer_key, status: "error", detail };
  }
}

/**
 * Uma chamada ao modelo e, se o JSON não colar, EXATAMENTE mais uma com a
 * instrução de formato — repetir o mesmo prompt esperando resultado diferente
 * é gastar o dobro pela mesma resposta.
 */
async function runAnalysis(opts: {
  meetingType: MeetingType;
  turns: MeetingTurn[];
  suggestions: Array<{ at_seconds: number; suggestion: string }>;
  organizationId: string;
}): Promise<{ analysis: MeetingAnalysis | null; raw: string }> {
  const prompt = buildMeetingAnalysisPrompt(opts);
  const headers = gatewayHeaders({ organizationId: opts.organizationId });

  const tentativas = [prompt, prompt + ANALYSIS_RETRY_DE_FORMATO];
  let ultimoTexto = "";
  for (const p of tentativas) {
    const res = await generateText({
      model: resolveModel(DEFAULT_BOT_MODEL),
      messages: [{ role: "user", content: p }],
      headers,
    });
    ultimoTexto = res.text ?? "";
    const parsed = parseMeetingAnalysis(ultimoTexto);
    if (parsed) return { analysis: parsed, raw: ultimoTexto };
  }
  return { analysis: null, raw: ultimoTexto };
}

/**
 * A linha na timeline do negócio — UMA, quando a análise conclui (a tabela de
 * reuniões fica fora do realtime de propósito; este é o único pulso).
 *
 * A `reason` é PII-free: nota + primeiro ponto de melhoria (coaching sobre o
 * VENDEDOR, nunca citação do lead — `acertos` cita a fala do cliente e por
 * isso não entra aqui; a análise completa vive no card, sob controle de
 * acesso, e some na anonimização).
 *
 * Ator `webhook_source` → `actor_kind='system'`: o produto agiu. Não é `ai`
 * porque `ai` exige lastro (run_ids) pela constraint da 0071 e esta análise
 * não passa pelo motor de agentes.
 */
async function emitAnalyzedActivity(
  admin: ReturnType<typeof createAdminClient>,
  meeting: MeetingRow,
  analysis: MeetingAnalysis | null,
): Promise<void> {
  if (!meeting.lead_id) return; // reunião sem negócio vinculado: nada a pendurar

  const label = MEETING_TYPE_LABELS[meeting.meeting_type as MeetingType] ?? "Reunião";
  const reason = analysis
    ? `${label} analisada — nota ${formatNota(analysis.nota_geral)}/10. A melhorar: ${primeiroPonto(analysis)}`
    : `${label} analisada — o modelo não devolveu a avaliação no formato esperado; o texto está no card da reunião.`;

  const r = await emitLeadActivity(admin, {
    organizationId: meeting.organization_id,
    leadId: meeting.lead_id,
    contactId: meeting.contact_id,
    type: "reuniao_analisada",
    sourceModule: "meetings",
    sourceId: meeting.id,
    actor: { type: "webhook_source", id: "meetings" },
    reason,
    payload: {
      meeting_id: meeting.id,
      meeting_type: meeting.meeting_type,
      ...(analysis
        ? { resultado: analysis.resultado, nota_geral: analysis.nota_geral }
        : { unformatted: true }),
    },
  });
  if (!r.ok) {
    logger.warn("[meeting-analysis] atividade reuniao_analisada não gravada", {
      meeting_id: meeting.id,
      detail: r.error,
    });
  }
}

/** `8` e não `8.0`; `7.5` vira `7,5` para quem lê em português. */
function formatNota(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace(".", ",");
}

/** O primeiro ponto de melhoria, encurtado para caber numa linha da timeline. */
function primeiroPonto(analysis: MeetingAnalysis): string {
  const p = analysis.coaching.melhorias[0]?.trim() ?? "";
  if (!p) return "sem apontamentos";
  return p.length > 160 ? `${p.slice(0, 157)}…` : p;
}
