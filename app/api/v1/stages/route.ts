/**
 * GET /api/v1/stages — as etapas ativas de TODOS os funis da org, na ordem do
 * quadro (funil, depois coluna).
 *
 * Existe para o filtro de etapa do inbox. A alternativa seria baixar
 * `/pipelines/[id]/board`, que traz os negócios inteiros com score e próxima
 * ação — muito peso para preencher um select com nomes de coluna, e por funil,
 * quando a org tem mais de um.
 *
 * `viewer` basta: nome de coluna não revela negócio nenhum (a RLS de
 * `crm_stages` é org-scoped; quem recorta por atendente é a de `crm_leads`).
 *
 * Server route (não supabase-js do browser): o cookie de sessão é HttpOnly —
 * mesmo motivo do board e do vocabulário de tags.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { OrgStage } from "@/lib/kanban/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface StageRow {
  id: string;
  name: string;
  position: number;
  pipeline_id: string;
  crm_pipelines: { name: string; position: number } | null;
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "pipelines" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_stages")
    .select("id, name, position, pipeline_id, crm_pipelines!inner (name, position, is_archived)")
    .eq("organization_id", authz.org.orgId)
    .eq("is_archived", false)
    .eq("crm_pipelines.is_archived", false);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  // Ordenar aqui e não no banco: o `.order()` do PostgREST não alcança coluna de
  // tabela embutida, e sem o funil como primeira chave as colunas de dois funis
  // saem intercaladas por `position` — "Pago" existe em mais de um.
  const rows = ((data ?? []) as unknown as StageRow[]).slice().sort((a, b) => {
    const pa = a.crm_pipelines?.position ?? 0;
    const pb = b.crm_pipelines?.position ?? 0;
    if (pa !== pb) return pa - pb;
    const na = a.crm_pipelines?.name ?? "";
    const nb = b.crm_pipelines?.name ?? "";
    if (na !== nb) return na.localeCompare(nb, "pt-BR");
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const stages: OrgStage[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    pipeline_id: s.pipeline_id,
    pipeline_name: s.crm_pipelines?.name ?? "Funil",
  }));

  return ok(stages, { requestId });
}
