/**
 * POST /api/v1/contacts/[id]/calls
 *
 * O SDR clicou em "Ligar". Esta rota registra a TENTATIVA — antes de existir
 * áudio, antes de saber se alguém atendeu.
 *
 * A tentativa é registrada mesmo quando não vira gravação nenhuma, e isso é o
 * ponto: a maior parte da prospecção por telefone não completa. Se só a ligação
 * gravada deixasse rastro, a timeline mostraria uma prospecção que parece
 * eficiente (só o que deu certo aparece) e o SDR que ligou trinta vezes sem
 * ninguém atender pareceria ter ficado parado. Esforço invisível é esforço que
 * não conta na avaliação de ninguém.
 *
 * O roteamento contato→negócio usa `resolveActiveLeadForContact`, o MESMO do
 * motor do agente: quando a pessoa tem dois negócios abertos empatados, ele se
 * recusa a escolher. Aqui a recusa não bloqueia nada — a gravação existe com
 * `lead_id` nulo e a atividade simplesmente não nasce, porque atividade precisa
 * de negócio. Mover o card errado do cliente errado é pior que uma timeline sem
 * a linha.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { toE164BR } from "@/lib/calls/phone";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const Body = z.object({
  /**
   * De onde partiu o clique. Não muda comportamento nenhum — vai para o
   * `payload` da atividade para responder "o time liga mais do card do negócio
   * ou da ficha do contato?" sem ter de instrumentar depois.
   */
  origin: z.enum(["contact", "deal"]).optional().default("contact"),
});

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;

  // Mesmo piso do move e do next-action: `viewer` lê a ficha, mas registrar
  // ligação é agir sobre o negócio.
  const authz = await requireRole("agent", { requestId, resource: "crm_call_recordings" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail("validation_failed", "Corpo inválido.", 422, {
      requestId,
      details: { issues: parsed.error.issues },
    });
  }

  const supabase = await createClient();

  // O contato vem pela RLS do caller — é ele que prova a org, nunca o body.
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, organization_id, phone_number, is_anonymized")
    .eq("id", contactId)
    .maybeSingle();
  if (contactErr) return fail("internal_error", contactErr.message, 500, { requestId });
  if (!contact) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  if (contact.is_anonymized) {
    // Gravar a voz de quem exerceu o direito ao esquecimento é o oposto do que a
    // anonimização significa. Recusa aqui, no início, e não depois do áudio já
    // ter subido.
    return fail(
      "contact_anonymized",
      "Contato anonimizado (LGPD) — não é possível registrar ligações.",
      409,
      { requestId },
    );
  }

  const phone = toE164BR(contact.phone_number);
  if (!phone) {
    return fail(
      "phone_unavailable",
      "Contato sem telefone utilizável. Cadastre o número antes de ligar.",
      422,
      { requestId },
    );
  }

  // ---- para qual negócio esta ligação conta ----
  const { data: leadRows, error: leadsErr } = await supabase
    .from("crm_leads")
    .select("id, organization_id, pipeline_id, status, last_activity_at, created_at")
    .eq("organization_id", contact.organization_id)
    .eq("contact_id", contactId);
  if (leadsErr) return fail("internal_error", leadsErr.message, 500, { requestId });

  const { data: defaultPipeline } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", contact.organization_id)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();

  const alvo = resolveActiveLeadForContact((leadRows ?? []) as LeadCandidate[], {
    defaultPipelineId: defaultPipeline?.id ?? null,
  });
  const leadId = alvo.routed ? alvo.leadId : null;

  // ---- a gravação nasce aqui, vazia ----
  const { data: call, error: insertErr } = await supabase
    .from("crm_call_recordings")
    .insert({
      organization_id: contact.organization_id,
      contact_id: contactId,
      lead_id: leadId,
      status: "pending",
      created_by_user_id: user.id,
    })
    .select("id, status, created_at")
    .single();
  if (insertErr) return fail("internal_error", insertErr.message, 500, { requestId });

  // ---- a linha na timeline ----
  // Fire-and-forget por doutrina: a timeline não derruba a operação que ela
  // descreve. Sem negócio roteado não há linha — `crm_lead_activities.lead_id`
  // é o eixo do barramento e inventar um alvo é o dano que a resolução recusa.
  let activityId: string | null = null;
  if (alvo.routed) {
    const r = await emitLeadActivity(supabase, {
      organizationId: contact.organization_id,
      leadId: alvo.leadId,
      contactId,
      type: "call_logged",
      sourceModule: "calls",
      sourceId: call.id,
      actor: { type: "user", id: user.id, role: org.role },
      // Sem PII: a `reason` aparece na tela e sai no export LGPD, então ela diz
      // QUE houve ligação, nunca para qual número.
      reason: "Ligação iniciada pelo SDR",
      payload: { call_id: call.id, origin: parsed.data.origin },
    });
    if (!r.ok) {
      logger.warn("[calls] atividade call_logged não gravada", {
        call_id: call.id,
        detail: r.error,
        requestId,
      });
    }
  } else {
    logger.info("[calls] ligação sem negócio roteado", {
      call_id: call.id,
      reason: alvo.reason,
      requestId,
    });
  }

  // A atividade é fire-and-forget, então o id só é buscado se ela nasceu. Uma
  // consulta a mais aqui é barata e evita passar o id por dentro do emissor
  // compartilhado só para este caminho.
  if (leadId) {
    const { data: act } = await supabase
      .from("crm_lead_activities")
      .select("id")
      .eq("organization_id", contact.organization_id)
      .eq("source_module", "calls")
      .eq("source_id", call.id)
      .maybeSingle();
    activityId = act?.id ?? null;
    if (activityId) {
      await supabase
        .from("crm_call_recordings")
        .update({ activity_id: activityId })
        .eq("id", call.id)
        .eq("organization_id", contact.organization_id);
    }
  }

  void audit({
    action: "call.logged",
    actorUserId: user.id,
    organizationId: contact.organization_id,
    resourceType: "crm_call_recordings",
    resourceId: call.id,
    requestId,
    metadata: {
      contact_id: contactId,
      lead_id: leadId,
      routed: alvo.routed,
      ...(alvo.routed ? {} : { unrouted_reason: alvo.reason }),
    },
  });

  return ok(
    {
      call_id: call.id,
      status: call.status,
      lead_id: leadId,
      activity_id: activityId,
      /** E.164 para o `tel:` do mobile; a tela formata para leitura. */
      phone_e164: phone,
      lead_routing: alvo.routed ? "routed" : alvo.reason,
    },
    { status: 201, requestId },
  );
}
