/**
 * DELETE /api/v1/leads/[id]/contatos/[linkId] — tira um contato do negócio.
 *
 * APAGA O VÍNCULO, NUNCA O CONTATO. A pessoa continua no CRM com o histórico
 * dela — o que deixa de ser verdade é "ela é o financeiro DESTE negócio", que
 * é a única coisa que a linha afirmava. Apagar o contato junto seria destruir
 * conversa e ligações por causa de um clique de correção.
 *
 * O contato de ORIGEM não passa por aqui: ele não tem `link_id`, então a tela
 * não oferece o botão e a rota não encontra a linha (404). Tirar de onde o
 * negócio nasceu é outra operação.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; linkId: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId, linkId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_lead_links" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const supabase = await createClient();

  // Lê ANTES de apagar, e com os três filtros (org, lead, kind): é a leitura
  // que prova que este vínculo é deste negócio nesta organização. Sem ela, um
  // `linkId` de outro negócio viraria um delete que a RLS até barra, mas que
  // responderia 200 — sucesso sobre coisa nenhuma.
  const { data: link, error: erroLeitura } = await supabase
    .from("crm_lead_links")
    .select("id, target_id, link_kind")
    .eq("id", linkId)
    .eq("organization_id", org.orgId)
    .eq("lead_id", leadId)
    .eq("target_kind", "contact")
    .maybeSingle();
  if (erroLeitura) {
    return fail("internal_error", "Falha ao ler o vínculo.", 500, { requestId });
  }
  if (!link) return fail("not_found", "Vínculo não encontrado neste negócio.", 404, { requestId });

  const { error: erroDelete } = await supabase
    .from("crm_lead_links")
    .delete()
    .eq("id", linkId)
    .eq("organization_id", org.orgId);
  if (erroDelete) {
    return fail("internal_error", "Falha ao remover o contato do negócio.", 500, { requestId });
  }

  // Fire-and-forget, como a entrada: a timeline descreve a operação, não a
  // sustenta. Sem PII na `reason` (mesma regra do POST).
  const r = await emitLeadActivity(supabase, {
    organizationId: org.orgId,
    leadId,
    contactId: link.target_id as string,
    type: "contato_desvinculado",
    sourceModule: "contatos_do_negocio",
    // O vínculo não existe mais — o ponteiro fica no payload, e `source_id`
    // apontaria para uma linha apagada.
    actor: { type: "user", id: user.id, role: org.role },
    reason: "Contato removido do negócio",
    payload: { papel: link.link_kind, link_id: linkId },
  });
  if (!r.ok) {
    logger.warn("[contatos-do-negocio] atividade contato_desvinculado não gravada", {
      lead_id: leadId,
      detail: r.error,
      requestId,
    });
  }

  return ok({ removido: true }, { requestId });
}
