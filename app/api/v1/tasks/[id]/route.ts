/**
 * PATCH /api/v1/tasks/[id] — resolver, adiar, repassar ou reescrever a tarefa.
 *
 * Uma rota só para as quatro coisas porque são a MESMA escrita na mesma linha,
 * e separá-las multiplicaria por quatro a checagem de org e o audit. O corpo é
 * `strictObject` com refine de "algo para mudar" (lib/schemas/tarefas.ts).
 *
 * O carimbo de resolução é decidido AQUI, junto do status, nunca em duas
 * escritas: a constraint `crm_tasks_resolucao_datada` exige a coerência nos dois
 * sentidos (feita/cancelada ⇒ tem `resolved_at`; reaberta ⇒ não tem). Mesma
 * postura da rota do plano (0094).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { atualizarTarefaSchema } from "@/lib/schemas/tarefas";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUNAS =
  "id, title, kind, notes, due_at, status, assigned_to_user_id, created_by_user_id, conversation_id, contact_id, lead_id, resolved_at, resolved_by_user_id, created_at, updated_at";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = atualizarTarefaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const entrada = parsed.data;

  // Repassar exige membro vivo da org — mesma regra (e mesmo motivo) do POST.
  if (entrada.assigned_to_user_id && entrada.assigned_to_user_id !== user.id) {
    const membros = isServiceRoleConfigured() ? createAdminClient() : await createClient();
    const { data: membro, error: erroMembro } = await membros
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", org.orgId)
      .eq("user_id", entrada.assigned_to_user_id)
      .is("revoked_at", null)
      .maybeSingle();
    if (erroMembro) {
      return fail("internal_error", "Falha ao validar o responsável.", 500, { requestId });
    }
    if (!membro) {
      return fail("invalid_request", "Responsável não é membro desta organização.", 422, {
        requestId,
      });
    }
  }

  const patch: Record<string, unknown> = {};
  if (entrada.title !== undefined) patch.title = entrada.title;
  if (entrada.notes !== undefined) {
    patch.notes = entrada.notes && entrada.notes.length > 0 ? entrada.notes : null;
  }
  if (entrada.due_at !== undefined) patch.due_at = new Date(entrada.due_at).toISOString();
  if (entrada.assigned_to_user_id !== undefined) {
    patch.assigned_to_user_id = entrada.assigned_to_user_id;
  }
  if (entrada.status !== undefined) {
    const pendente = entrada.status === "pending";
    patch.status = entrada.status;
    patch.resolved_at = pendente ? null : new Date().toISOString();
    patch.resolved_by_user_id = pendente ? null : user.id;
  }

  // Escrita user-scoped: quem não enxerga a linha pela RLS não a atualiza. O
  // filtro de org vai junto pela razão de sempre (usuário em duas orgs).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_tasks")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(COLUNAS)
    .maybeSingle();

  if (error) {
    return fail("internal_error", "Falha ao atualizar a tarefa.", 500, { requestId });
  }
  if (!data) {
    return fail("not_found", "Tarefa não encontrada nesta organização.", 404, { requestId });
  }

  await audit({
    action: "task.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "crm_tasks",
    resourceId: id,
    metadata: { campos: Object.keys(patch), status: data.status },
    requestId,
  });

  return ok({ task: data }, { requestId });
}
