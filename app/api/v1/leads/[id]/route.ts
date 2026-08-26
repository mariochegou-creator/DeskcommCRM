/**
 * PATCH  /api/v1/leads/[id] — update lead (handler em ../_handler.ts).
 * DELETE /api/v1/leads/[id] — apaga o negócio.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { contatoPorTelefone } from "@/lib/contacts/contato-por-telefone";
import { telefoneE164 } from "@/lib/contacts/telefone";
import { whatsappLink } from "@/lib/contacts/whatsapp";
import { updateLeadSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { updateLeadHandler } from "../_handler";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const activeOrg = authz.org;

  let input;
  try {
    input = await validateRequest(updateLeadSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // Telefone digitado → contato, com a MESMA regra do POST e da importação de
  // lista (lib/contacts/contato-por-telefone). Um caminho próprio aqui é como
  // o número que o SDR acha no Maps viraria um segundo cadastro do contato que
  // o CRM já tem, partindo a conversa em duas.
  const { contact_phone, ...leadInput } = input;
  let patch = leadInput;
  if (leadInput.contact_id === undefined && contact_phone) {
    const phone = telefoneE164(contact_phone);
    if (!phone || !whatsappLink(phone)) {
      return fail(
        "validation_failed",
        "Número de WhatsApp inválido. Use DDD + número — ex: (73) 99134-6237.",
        422,
        { requestId },
      );
    }
    // O nome do contato NOVO sai do título do negócio, como no POST. Contato
    // que já existe mantém o nome que tem — quem cadastrou antes sabia mais.
    const { data: atual } = await supabase
      .from("crm_leads")
      .select("title")
      .eq("id", leadId)
      .maybeSingle();
    if (!atual) {
      return fail("not_found", "Negócio não encontrado.", 404, { requestId });
    }
    try {
      const contato = await contatoPorTelefone(supabase, {
        organizationId: activeOrg.orgId,
        createdByUserId: user.id,
        phone,
        name: (leadInput.title ?? atual.title) as string,
        source: "manual",
        sourceMetadata: { created_by_user_id: user.id, adicionado_no_negocio: leadId },
        requestId,
      });
      patch = { ...leadInput, contact_id: contato.id };
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.code, err.message, err.status, { requestId });
      }
      throw err;
    }
  }

  try {
    const updated = await updateLeadHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      leadId,
      patch,
    );
    return ok(updated, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}

/**
 * Apaga o negócio — de verdade, como o `/bulk` já fazia com `action: "delete"`
 * (crm_leads não tem coluna de arquivo).
 *
 * A rota existe para o mesmo apagar ficar ao alcance de UM negócio: até aqui,
 * tirar do quadro o lead que entrou por engano na importação exigia
 * selecionar em massa. O CONTATO NÃO VAI JUNTO: ele pertence à organização e
 * pode estar em outra conversa ou noutro negócio — apagar em cascata a partir
 * do card seria destruir histórico que ninguém pediu para destruir.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  // Lê ANTES de apagar: depois do delete não há de onde tirar pipeline e etapa
  // para a auditoria, e "apagou o quê" sem essas duas é uma linha que não
  // responde nada em investigação. A RLS já resolve a tenancy — negócio de
  // outra organização não aparece aqui e morre no 404.
  const { data: lead, error: selErr } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id, stage_id, contact_id")
    .eq("id", leadId)
    .maybeSingle();

  if (selErr) return fail("internal_error", selErr.message, 500, { requestId });
  if (!lead) return fail("not_found", "Negócio não encontrado.", 404, { requestId });

  const { data: apagado, error: delErr } = await supabase
    .from("crm_leads")
    .delete()
    .eq("id", leadId)
    .select("id")
    .maybeSingle();

  if (delErr) return fail("internal_error", delErr.message, 500, { requestId });
  if (!apagado) return fail("not_found", "Negócio não encontrado.", 404, { requestId });

  // Sem atividade na timeline de propósito: a timeline é do negócio, e o
  // negócio deixou de existir — a linha morreria junto (FK em cascata) e
  // escrever para apagar em seguida só ensinaria a duvidar do registro. O
  // rastro de quem apagou fica no evento e na auditoria, que sobrevivem.
  await supabase
    .rpc("emit_event", {
      p_event_type: "lead.deleted",
      p_entity_kind: "crm_lead",
      p_entity_id: leadId,
      p_payload: { pipeline_id: lead.pipeline_id, stage_id: lead.stage_id },
      p_metadata: { request_id: requestId, actor_type: "user" },
      p_organization_id: org.orgId,
    })
    .then(({ error }) => {
      if (error) console.error("[lead.delete] emit_event failed", error.message);
    });

  await audit({
    action: "lead.deleted",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: {
      actor_type: "user",
      pipeline_id: lead.pipeline_id,
      stage_id: lead.stage_id,
      // O contato NÃO foi apagado; guardar qual era é o que permite reencontrá-lo
      // quando alguém perguntar "e o negócio do fulano?".
      contact_id: lead.contact_id,
    },
  });

  return ok({ id: leadId, deleted: true }, { requestId });
}
