/**
 * POST /api/v1/meetings/[id]/finish — o Mario clicou "Encerrar" no overlay.
 *
 * Grava `ended_at`, zera o `live_state` (memória efêmera do copiloto) e decide
 * o destino: transcrição vazia → `encerrada` (não há o que analisar); com
 * turnos → `analisando` + evento `meeting.analysis_requested` no event_log,
 * que o worker de análise consome (padrão exato do upload de ligações: prender
 * o caller num request enquanto o Sonnet mastiga a reunião inteira é como o
 * encerrar passa a falhar por timeout).
 *
 * IDEMPOTENTE: encerrar uma reunião já encerrada devolve a linha como está —
 * a extensão re-tenta em rede ruim e não pode duplicar o evento de análise.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const RETURN_COLUMNS =
  "id, lead_id, contact_id, meeting_type, status, started_at, ended_at, turn_count, summary, outcome, score";

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const admin = createAdminClient();
  const { data: meeting, error: loadErr } = await admin
    .from("crm_meetings")
    .select("id, status, turn_count, meeting_type")
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
    // Já encerrada (retry da extensão) — devolve como está, sem segundo evento.
    const { data: asIs } = await admin
      .from("crm_meetings")
      .select(RETURN_COLUMNS)
      .eq("id", id)
      .eq("organization_id", authz.orgId)
      .single();
    return withCorsHeaders(ok({ meeting: asIs, already_finished: true }, { requestId }), req);
  }

  const hasTranscript = (meeting.turn_count ?? 0) > 0;
  const nextStatus = hasTranscript ? "analisando" : "encerrada";

  // Update condicionado a `ao_vivo`: dois "Encerrar" simultâneos → um vence,
  // o outro cai no ramo already_finished acima no retry.
  const { data: updated, error: updErr } = await admin
    .from("crm_meetings")
    .update({ status: nextStatus, ended_at: new Date().toISOString(), live_state: {} })
    .eq("id", id)
    .eq("organization_id", authz.orgId)
    .eq("status", "ao_vivo")
    .select(RETURN_COLUMNS)
    .maybeSingle();
  if (updErr) {
    return withCorsHeaders(fail("internal_error", updErr.message, 500, { requestId }), req);
  }
  if (!updated) {
    const { data: asIs } = await admin
      .from("crm_meetings")
      .select(RETURN_COLUMNS)
      .eq("id", id)
      .eq("organization_id", authz.orgId)
      .single();
    return withCorsHeaders(ok({ meeting: asIs, already_finished: true }, { requestId }), req);
  }

  if (hasTranscript) {
    const { error: emitErr } = await admin.rpc("emit_event", {
      p_event_type: "meeting.analysis_requested",
      p_entity_kind: "meeting",
      p_entity_id: id,
      p_payload: { meeting_id: id },
      p_metadata: { source: "meetings_finish" },
      p_organization_id: authz.orgId,
    });
    if (emitErr) {
      // A reunião JÁ está `analisando`. Sem o evento, o worker nunca começa e a
      // tela ficaria em "Analisando…" para sempre — o estado que mais parece
      // "funcionando, só demora" (mesma lição da rota de upload de ligações).
      // VOLTA para `ao_vivo` (mantendo ended_at, que o CHECK permite): assim o
      // retry do "Encerrar" da extensão cai de novo neste caminho e re-tenta o
      // enfileiramento — `falhou` aqui seria beco sem saída, porque o retry
      // pararia no ramo already_finished.
      logger.error("[meetings.finish] emit_event falhou", {
        meeting_id: id,
        detail: emitErr.message,
        requestId,
      });
      await admin
        .from("crm_meetings")
        .update({
          status: "ao_vivo",
          analysis_error: "Não foi possível enfileirar a análise. Encerre de novo para tentar outra vez.",
        })
        .eq("id", id)
        .eq("organization_id", authz.orgId);
      return withCorsHeaders(
        fail("internal_error", "Falha ao enfileirar a análise — tente encerrar de novo.", 500, {
          requestId,
        }),
        req,
      );
    }
  }

  void audit({
    action: "meeting.finished",
    actorUserId: authz.userId,
    organizationId: authz.orgId,
    resourceType: "crm_meetings",
    resourceId: id,
    requestId,
    metadata: {
      via_token: authz.viaToken,
      turn_count: meeting.turn_count ?? 0,
      next_status: nextStatus,
    },
  });

  return withCorsHeaders(ok({ meeting: updated, already_finished: false }, { requestId }), req);
}
