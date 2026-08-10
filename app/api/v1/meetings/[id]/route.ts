/**
 * GET   /api/v1/meetings/[id] — o dossiê completo da reunião: transcrição,
 *       resumo, notas, análise e as sugestões que o copiloto exibiu.
 * PATCH /api/v1/meetings/[id] — vincular negócio/contato depois do fato,
 *       editar notas, corrigir o tipo (R1 marcada como R2 por engano).
 *
 * Mesmo contrato de auth/CORS da rota-mãe (ver app/api/v1/meetings/route.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import { patchMeetingSchema } from "@/lib/schemas/sala-reunioes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const admin = createAdminClient();
  const { data: meeting, error } = await admin
    .from("crm_meetings")
    .select("*")
    .eq("id", id)
    .eq("organization_id", authz.orgId)
    .maybeSingle();
  if (error) {
    return withCorsHeaders(fail("internal_error", error.message, 500, { requestId }), req);
  }
  if (!meeting) {
    // 404 honesto: reunião de outra org e reunião inexistente são a mesma
    // resposta — não vazar existência cross-org.
    return withCorsHeaders(fail("not_found", "Reunião não encontrada.", 404, { requestId }), req);
  }

  const { data: suggestions, error: sugErr } = await admin
    .from("crm_meeting_suggestions")
    .select("id, at_seconds, phase_detected, suggestion, alert, was_followed, created_at")
    .eq("organization_id", authz.orgId)
    .eq("meeting_id", id)
    .order("at_seconds", { ascending: true });
  if (sugErr) {
    return withCorsHeaders(fail("internal_error", sugErr.message, 500, { requestId }), req);
  }

  return withCorsHeaders(
    ok({ meeting, suggestions: suggestions ?? [] }, { requestId }),
    req,
  );
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const body = await req.json().catch(() => null);
  const parsed = patchMeetingSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Corpo inválido.", 422, {
        requestId,
        details: { issues: parsed.error.issues },
      }),
      req,
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("crm_meetings")
    .select("id")
    .eq("id", id)
    .eq("organization_id", authz.orgId)
    .maybeSingle();
  if (!existing) {
    return withCorsHeaders(fail("not_found", "Reunião não encontrada.", 404, { requestId }), req);
  }

  // Vínculo novo só depois de provar posse — mesma regra do POST.
  if (input.lead_id) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id")
      .eq("id", input.lead_id)
      .eq("organization_id", authz.orgId)
      .maybeSingle();
    if (!lead) {
      return withCorsHeaders(fail("not_found", "Negócio não encontrado.", 404, { requestId }), req);
    }
  }
  if (input.contact_id) {
    const { data: contact } = await admin
      .from("contacts")
      .select("id")
      .eq("id", input.contact_id)
      .eq("organization_id", authz.orgId)
      .maybeSingle();
    if (!contact) {
      return withCorsHeaders(fail("not_found", "Contato não encontrado.", 404, { requestId }), req);
    }
  }

  const patch: Record<string, unknown> = {};
  if ("lead_id" in input) patch.lead_id = input.lead_id ?? null;
  if ("contact_id" in input) patch.contact_id = input.contact_id ?? null;
  if ("notes" in input) patch.notes = input.notes ?? null;
  if (input.meeting_type) patch.meeting_type = input.meeting_type;

  const { data: meeting, error } = await admin
    .from("crm_meetings")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", authz.orgId)
    .select(
      "id, lead_id, contact_id, meeting_type, status, started_at, ended_at, meet_code, turn_count, summary, notes, outcome, score, created_at, updated_at",
    )
    .single();
  if (error) {
    return withCorsHeaders(fail("internal_error", error.message, 500, { requestId }), req);
  }

  return withCorsHeaders(ok({ meeting }, { requestId }), req);
}
