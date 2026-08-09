/**
 * PATCH /api/v1/plan/tasks/[id] — transição de status de uma tarefa do plano.
 * { status: 'pending' | 'done' | 'skipped' } — org-scoped, auditado.
 *
 * Reabrir (→'pending') é permitido e LIMPA o carimbo: a constraint
 * plan_tasks_resolucao_datada exige resolved_at nos dois sentidos, então o
 * carimbo é decidido aqui, junto do status, nunca em duas escritas.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.object({ status: z.enum(["pending", "done", "skipped"]) }).strict();

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("agent", { requestId, resource: "plan_tasks" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const pending = parsed.data.status === "pending";
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("plan_tasks")
    .update({
      status: parsed.data.status,
      resolved_at: pending ? null : new Date().toISOString(),
      resolved_by_user_id: pending ? null : authUser.id,
    })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id, slug, title, description, phase, owner, due_date, position, status, resolved_at")
    .maybeSingle();
  if (error) {
    return fail("internal_error", "Falha ao atualizar a tarefa.", 500, { requestId });
  }
  if (!data) {
    return fail("not_found", "Tarefa não encontrada nesta organização.", 404, { requestId });
  }

  await audit({
    action: "plan.task_status_changed",
    actorUserId: authUser.id,
    organizationId: org.orgId,
    resourceType: "plan_tasks",
    resourceId: id,
    metadata: { status: parsed.data.status, slug: data.slug },
  });

  return ok({ task: data }, { requestId });
}
