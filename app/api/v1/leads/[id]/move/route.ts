/**
 * POST /api/v1/leads/[id]/move
 *
 * Moves a lead within its pipeline (P-01: cross-pipeline moves require clone).
 * Uses Pattern B optimistic concurrency (P-08): client sends `expected_updated_at`,
 * UPDATE filters by it, zero rows affected ⇒ 409 lead_stage_changed_concurrent.
 *
 * Status transitions are driven by trigger `fn_crm_lead_close_on_stage` (P-02);
 * this endpoint NEVER sets `status` directly.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moveLeadSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { emitLeadActivity, stageChangeReason } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { etapaMarcaContatoFeito } from "@/lib/leads/etapa-de-contato";
import { resolveOwnerPatch } from "@/lib/leads/owner-patch";

export const dynamic = "force-dynamic";

/**
 * O trio de posse (0070) + o carimbo, para quem assume o negócio ao movê-lo.
 *
 * A regra continua sendo a de `owner-patch.ts` — montar `owner_kind` na mão aqui
 * é exatamente o drift que aquele helper existe para impedir.
 */
function donoHumano(userId: string, agora: string) {
  const resultado = resolveOwnerPatch({ owner_user_id: userId });
  // Com um dono humano nomeado o helper sempre devolve patch; a guarda é para o
  // compilador, não para o runtime.
  if (!resultado.ok || !resultado.patch) return null;
  return { ...resultado.patch, assigned_at: agora };
}

export async function POST(
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

  let input;
  try {
    input = await validateRequest(moveLeadSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // Fetch current lead (RLS scoped).
  const { data: lead, error: selErr } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (selErr) {
    return fail("internal_error", selErr.message, 500, { requestId });
  }
  if (!lead) {
    return fail("not_found", "Lead não encontrado.", 404, { requestId });
  }

  // Fetch target stage to validate same pipeline (P-01).
  const { data: stage, error: stageErr } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id, name")
    .eq("id", input.stage_id)
    .maybeSingle();

  if (stageErr) {
    return fail("internal_error", stageErr.message, 500, { requestId });
  }
  if (!stage) {
    return fail("not_found", "Stage não encontrado.", 404, { requestId });
  }
  if (stage.pipeline_id !== lead.pipeline_id) {
    return fail(
      "pipeline_immutable_use_clone",
      "Move cross-pipeline não é permitido. Clone o lead para o pipeline alvo.",
      422,
      { requestId },
    );
  }

  // QUEM ARRASTA PARA «CONTATADO» É QUEM CONTATOU — e passa a ser o responsável.
  //
  // Sem isto, a coluna «Contatado» enche de card sem dono e o funil não responde
  // "quem falou com essa empresa?" — a informação existia no momento do arrasto
  // e se perdia ali.
  //
  // Duas guardas, as duas deliberadas:
  //  · só quando o negócio NÃO tem dono. Card de outra pessoa não muda de mão
  //    porque alguém organizou o quadro — reatribuir é ação explícita (o menu do
  //    card, ou o bulk assign, que é ≥manager de propósito).
  //  · dono AGENTE também conta como dono: tomar o negócio da IA aqui desligaria
  //    a cadência automática em silêncio.
  //
  // Vai no MESMO update do estágio, não num segundo: uma escrita, um
  // `updated_at`, e nenhum estado intermediário em que o card mudou de coluna e
  // ficou sem dono se a segunda falhasse.
  const agora = new Date().toISOString();
  const assumeODono =
    !lead.owner_user_id && !lead.owner_agent_id && etapaMarcaContatoFeito(stage);
  const patchDeDono = assumeODono ? donoHumano(user.id, agora) : null;

  // OCC update (Pattern B / Spec 09 §7.2).
  const { data: updated, error: updErr } = await supabase
    .from("crm_leads")
    .update({
      stage_id: input.stage_id,
      position_in_stage: input.position_in_stage,
      updated_at: agora,
      ...(patchDeDono ?? {}),
    })
    .eq("id", leadId)
    .eq("updated_at", input.expected_updated_at)
    .select("id")
    .maybeSingle();

  if (updErr) {
    return fail("internal_error", updErr.message, 500, { requestId });
  }

  if (!updated) {
    // Concurrent edit. Re-fetch current to surface the latest updated_at.
    const { data: current } = await supabase
      .from("crm_leads")
      .select("updated_at")
      .eq("id", leadId)
      .maybeSingle();
    return fail(
      "lead_stage_changed_concurrent",
      "Lead foi modificado por outro usuário. Recarregue e tente novamente.",
      409,
      {
        details: { current_updated_at: current?.updated_at ?? null },
        requestId,
      },
    );
  }

  // Re-SELECT so trigger-driven status/closed_at changes are reflected.
  const { data: fresh } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  const finalLead = fresh ?? lead;

  // Wave 3 (CORE 2): esta é a rota que o BOARD usa — arrastar o card passa por
  // aqui, não pelo moveLeadHandler. O emissor é o mesmo dos outros escritores
  // (lib/leads/activity-emitter), para os quatro caminhos escreverem a mesma
  // linha na timeline.
  const { data: fromStage } = await supabase
    .from("crm_stages")
    .select("name")
    .eq("id", lead.stage_id)
    .maybeSingle();

  const atividade = await emitLeadActivity(supabase, {
    organizationId: lead.organization_id,
    leadId,
    contactId: (lead as { contact_id?: string | null }).contact_id ?? null,
    type: "stage_changed",
    sourceModule: "crm",
    sourceId: leadId,
    actor: { type: "user", id: user.id },
    reason: stageChangeReason(fromStage?.name ?? null, stage.name),
    payload: {
      from_stage_id: lead.stage_id,
      to_stage_id: input.stage_id,
      pipeline_id: lead.pipeline_id,
    },
  });
  if (!atividade.ok) {
    // Mesma política do handler: mutação já ocorrida não bloqueia, mas o rastro
    // perdido é contado em vez de sumir num log de processo.
    await registraFalhaDeAtividade(supabase, {
      organizationId: lead.organization_id,
      leadId,
      tipo: "stage_changed",
      origem: "leads/[id]/move",
      erro: atividade.error,
      requestId,
    });
  }

  // DUAS linhas na timeline, não uma: mudar de etapa e ganhar dono são dois
  // acontecimentos, e o segundo é o que o dossiê precisa responder depois
  // ("desde quando é seu, e por quê"). O `reason` nomeia o campo e a etapa —
  // nunca o nome da pessoa (§9: sem PII nova em reason).
  if (patchDeDono) {
    const atividadeDeDono = await emitLeadActivity(supabase, {
      organizationId: lead.organization_id,
      leadId,
      contactId: (lead as { contact_id?: string | null }).contact_id ?? null,
      type: "lead_edited",
      sourceModule: "crm",
      sourceId: leadId,
      actor: { type: "user", id: user.id },
      reason: `Passou a ser o responsável ao mover para «${stage.name}»`,
      payload: { fields: ["owner_user_id"], motivo: "move_para_etapa_de_contato" },
    });
    if (!atividadeDeDono.ok) {
      await registraFalhaDeAtividade(supabase, {
        organizationId: lead.organization_id,
        leadId,
        tipo: "lead_edited",
        origem: "leads/[id]/move",
        erro: atividadeDeDono.error,
        requestId,
      });
    }
  }

  // Emit domain event (fire-and-forget; trigger NEVER does HTTP — workers do).
  await supabase
    .rpc("emit_event", {
      p_event_type: "lead.stage_changed",
      p_entity_kind: "crm_lead",
      p_entity_id: leadId,
      p_payload: {
        from_stage_id: lead.stage_id,
        to_stage_id: input.stage_id,
        position_in_stage: input.position_in_stage,
        status: finalLead.status,
      },
      p_metadata: { request_id: requestId, actor_user_id: user.id },
      p_organization_id: lead.organization_id,
    })
    .then(({ error }) => {
      if (error) console.error("[lead.move] emit_event failed", error.message);
    });

  await audit({
    action: "lead.moved",
    actorUserId: user.id,
    organizationId: lead.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: {
      from_stage_id: lead.stage_id,
      to_stage_id: input.stage_id,
      position_in_stage: input.position_in_stage,
      ...(patchDeDono ? { auto_assigned_owner_user_id: user.id } : {}),
    },
  });

  return ok(finalLead, { requestId });
}
