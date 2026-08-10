/**
 * GET  /api/v1/meetings — lista das reuniões da Sala de Reuniões (sem transcript:
 *      a lista mostra dezenas de linhas e a transcrição passa de 100KB cada).
 * POST /api/v1/meetings — a extensão clicou "Iniciar R1/R2" no overlay do Meet
 *      (ou a aba criou uma reunião de teste). Nasce `ao_vivo`, sem vínculo
 *      obrigatório com negócio — vincular depois é PATCH.
 *
 * Auth DUAL (lib/sala-reunioes/authz.ts): cookie da aba OU Bearer da extensão.
 * A rota está em PUBLIC_PATHS (o proxy não exige cookie), então o gate daqui é
 * o ÚNICO — nenhum acesso ao banco antes dele. Todas as queries usam o admin
 * client com filtro explícito de `organization_id` (service-role caveat).
 *
 * CORS: só estas rotas respondem a origem de extensão (lib/api/cors.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import { createMeetingSchema, listMeetingsQuerySchema } from "@/lib/schemas/sala-reunioes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

const LIST_COLUMNS =
  "id, lead_id, contact_id, meeting_type, status, started_at, ended_at, meet_code, turn_count, summary, outcome, score, created_at, updated_at";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const parsed = listMeetingsQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Parâmetros inválidos.", 422, {
        requestId,
        details: { issues: parsed.error.issues },
      }),
      req,
    );
  }
  const q = parsed.data;

  const admin = createAdminClient();
  let query = admin
    .from("crm_meetings")
    .select(LIST_COLUMNS)
    .eq("organization_id", authz.orgId)
    .order("started_at", { ascending: false })
    .limit(q.limit);

  if (q.status) query = query.eq("status", q.status);
  if (q.meeting_type) query = query.eq("meeting_type", q.meeting_type);
  if (q.lead_id) query = query.eq("lead_id", q.lead_id);
  if (q.meet_code) query = query.eq("meet_code", q.meet_code);

  const { data, error } = await query;
  if (error) {
    return withCorsHeaders(
      fail("internal_error", "Falha ao listar as reuniões.", 500, { requestId }),
      req,
    );
  }

  return withCorsHeaders(ok({ meetings: data ?? [] }, { requestId }), req);
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const body = await req.json().catch(() => null);
  const parsed = createMeetingSchema.safeParse(body ?? {});
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

  // O lead do BODY só entra depois de provar que é da org do caller — a org
  // nunca vem do body, e um uuid de outra org receberia um 404 honesto.
  if (input.lead_id) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id")
      .eq("id", input.lead_id)
      .eq("organization_id", authz.orgId)
      .maybeSingle();
    if (!lead) {
      return withCorsHeaders(
        fail("not_found", "Negócio não encontrado.", 404, { requestId }),
        req,
      );
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
      return withCorsHeaders(
        fail("not_found", "Contato não encontrado.", 404, { requestId }),
        req,
      );
    }
  }

  // Dedupe de reconexão: se a extensão recarregou no meio da reunião e clicou
  // "Iniciar" de novo na MESMA sala, devolve a reunião viva em vez de abrir uma
  // segunda linha para a mesma conversa.
  if (input.meet_code) {
    const { data: viva } = await admin
      .from("crm_meetings")
      .select(LIST_COLUMNS)
      .eq("organization_id", authz.orgId)
      .eq("meet_code", input.meet_code)
      .eq("status", "ao_vivo")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (viva) {
      return withCorsHeaders(ok({ meeting: viva, resumed: true }, { requestId }), req);
    }
  }

  const { data: meeting, error } = await admin
    .from("crm_meetings")
    .insert({
      organization_id: authz.orgId,
      lead_id: input.lead_id ?? null,
      contact_id: input.contact_id ?? null,
      meeting_type: input.meeting_type,
      meet_code: input.meet_code ?? null,
      created_by_user_id: authz.userId,
    })
    .select(LIST_COLUMNS)
    .single();
  if (error) {
    return withCorsHeaders(fail("internal_error", error.message, 500, { requestId }), req);
  }

  void audit({
    action: "meeting.started",
    actorUserId: authz.userId,
    organizationId: authz.orgId,
    resourceType: "crm_meetings",
    resourceId: meeting.id,
    requestId,
    metadata: {
      meeting_type: input.meeting_type,
      via_token: authz.viaToken,
      lead_id: input.lead_id ?? null,
    },
  });

  return withCorsHeaders(ok({ meeting, resumed: false }, { status: 201, requestId }), req);
}
