/**
 * POST /api/v1/meetings/[id]/live-suggest — o cérebro do copiloto ao vivo.
 *
 * A extensão manda a janela recente de turnos; o Haiku classifica a fase,
 * gera a próxima pergunta (5-12 palavras) e aponta desvio de roteiro. A
 * sugestão é PERSISTIDA em `crm_meeting_suggestions` (sem isso o coaching não
 * mede "seguiu?"), e a `cobertura` volta para `live_state` — a memória entre
 * chamadas, para não reenviar a transcrição inteira.
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
import { logger } from "@/lib/logger";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import { parseLiveSuggestion, type LiveSuggestion } from "@/lib/sala-reunioes/live-schema";
import { liveSystemPrompt, liveUserPrompt, RETRY_DE_FORMATO } from "@/lib/sala-reunioes/live-prompt";
import {
  MEETING_PHASE_LABELS,
  MEETING_TYPE_LABELS,
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
    .select("id, status, meeting_type, live_state")
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
  const liveState =
    meeting.live_state && typeof meeting.live_state === "object"
      ? (meeting.live_state as Record<string, unknown>)
      : {};

  const suggestion = await runLiveModel({
    meetingType,
    turns,
    liveState,
    organizationId: authz.orgId,
  });

  if (!suggestion) {
    // Nem o retry produziu JSON válido. O overlay mantém a sugestão anterior —
    // devolver 200 "sem sugestão" evita o client tratar isso como pane.
    return withCorsHeaders(ok({ suggestion: null }, { requestId }), req);
  }

  const atSeconds = turns[turns.length - 1]!.t;

  // Persistência ANTES da resposta: a linha é o que torna "seguiu o roteiro?"
  // mensurável — se falhar, avisa mas não engole a sugestão (o Mario está no
  // meio de uma call; a fila do coaching não pode calar o overlay).
  const { error: insErr } = await admin.from("crm_meeting_suggestions").insert({
    organization_id: authz.orgId,
    meeting_id: id,
    at_seconds: atSeconds,
    phase_detected: suggestion.fase,
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

  const { error: stateErr } = await admin
    .from("crm_meetings")
    .update({ live_state: { fase: suggestion.fase, cobertura: suggestion.cobertura } })
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
          fase: suggestion.fase,
          fase_label: `${MEETING_TYPE_LABELS[meetingType].slice(0, 2)} · ${MEETING_PHASE_LABELS[suggestion.fase]}`,
          sugestao: suggestion.sugestao,
          alerta: suggestion.alerta,
        },
      },
      { requestId },
    ),
    req,
  );
}

/**
 * Uma chamada e, se o JSON não colar, EXATAMENTE mais uma com a instrução de
 * formato — o mesmo contrato do worker de ligações: repetir o mesmo prompt
 * esperando outra coisa é pagar o dobro pela mesma resposta.
 */
async function runLiveModel(opts: {
  meetingType: MeetingType;
  turns: MeetingTurn[];
  liveState: Record<string, unknown>;
  organizationId: string;
}): Promise<LiveSuggestion | null> {
  const system = liveSystemPrompt(opts.meetingType);
  const user = liveUserPrompt({ turns: opts.turns, liveState: opts.liveState });
  const headers = gatewayHeaders({ organizationId: opts.organizationId });

  const tentativas = [user, user + RETRY_DE_FORMATO];
  for (const prompt of tentativas) {
    try {
      const res = await generateText({
        model: resolveModel(DEFAULT_CLASSIFIER_MODEL),
        system,
        messages: [{ role: "user", content: prompt }],
        headers,
      });
      const parsed = parseLiveSuggestion(res.text ?? "");
      if (parsed) return parsed;
    } catch (err) {
      logger.warn("[live-suggest] chamada ao modelo falhou", {
        detail: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  return null;
}
