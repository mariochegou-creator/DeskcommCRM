/**
 * GET /api/v1/plan/tasks — as tarefas pontuais do plano de 60 dias.
 *
 * Client USER-SCOPED (cookie session): a RLS de plan_tasks já escopa a org do
 * caller — mesma postura da rota de métricas de prospecção. O payload estático
 * do plano (fases, metas, checkpoints) NÃO passa por aqui: o client importa
 * lib/plan/sixty-day-plan.ts direto — rota para dado vivo, módulo para
 * constante. Read-only ⇒ sem audit.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { SIXTY_DAY_PLAN } from "@/lib/plan/sixty-day-plan";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "plan_tasks" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  // A RLS enxerga TODAS as orgs do usuário; o Painel é da org ATIVA. Sem este
  // filtro, quem participa de duas orgs veria as tarefas de uma dentro da outra.
  const { data, error } = await supabase
    .from("plan_tasks")
    .select(
      "id, slug, title, description, phase, owner, due_date, position, status, resolved_at",
    )
    .eq("organization_id", authz.org.orgId)
    .eq("plan_key", SIXTY_DAY_PLAN.key)
    .order("phase", { ascending: true })
    .order("position", { ascending: true })
    .order("slug", { ascending: true });

  if (error) {
    return fail("internal_error", "Falha ao listar as tarefas do plano.", 500, { requestId });
  }

  return ok({ tasks: data ?? [] }, { requestId });
}
