/**
 * POST /api/v1/leads/[id]/primeiro-toque — manda o gancho de abertura e devolve
 * a conversa para o inbox.
 *
 * O caminho que existia antes era: abrir a gaveta do lead, ler o gancho na
 * tela, clicar em "Iniciar no WhatsApp", esperar o WhatsApp Web, colar o texto
 * à mão. Quatro trocas de contexto para mandar uma frase que o CRM já tem
 * escrita — e a conversa só entrava no CRM quando o lead respondia.
 *
 * Aqui o CRM manda pelo próprio número conectado, a conversa nasce já dentro do
 * inbox e o SDR cai nela. Nada de novo por baixo: é o MESMO
 * `resolverSessao` → `ensureConversation` → `sendMessageHandler` que a
 * confirmação de reunião e as automações usam. A diferença é o ator.
 *
 * O ATOR É O USUÁRIO, não a IA. `sendMessageHandler` deriva `sent_via` do tipo
 * do ator: qualquer coisa diferente de `user` marca a mensagem como "ai" no
 * inbox. Uma frase escrita por gente e etiquetada como robô é pior que nenhuma
 * etiqueta — ver o mesmo cuidado no disparo por MCP.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { resolverSessao } from "@/lib/agendamento/envio";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SendMessageInput } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Mesmo teto de `sendMessageSchema` — falhar aqui dá mensagem melhor que falhar lá. */
const MAX_CORPO = 4096;

/**
 * O telefone que o WAHA vai discar bate com a identidade do WhatsApp?
 *
 * `resolveWahaChatId` monta o chat a partir de `phone_number`. Quando a
 * `wa_identity` gravada é `phone:+E164` e os dígitos divergem, a mensagem sai,
 * ganha id, aparece "enviada" no inbox — e NÃO CHEGA. Aconteceu com 20 leads
 * em 21/08/2026, e o sintoma é justamente não ter sintoma. Recusar antes é a
 * única forma de o SDR ficar sabendo.
 */
function telefoneDivergeDaIdentidade(
  phoneNumber: string | null,
  waIdentity: string | null,
): boolean {
  if (!phoneNumber || !waIdentity?.startsWith("phone:+")) return false;
  return waIdentity.slice("phone:".length).replace(/\D/g, "") !== phoneNumber.replace(/\D/g, "");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  // spec 13 §4: mandar mensagem é agent+ — o mesmo piso de POST /messages.
  const authz = await requireRole("agent", { requestId, resource: "messages" });
  if (!authz.ok) return authz.response;
  const user = authz.user;

  let corpo: string;
  try {
    const json = (await req.json()) as { body?: unknown };
    corpo = typeof json.body === "string" ? json.body.trim() : "";
  } catch {
    return fail("validation_error", "Corpo da requisição inválido.", 422, { requestId });
  }
  if (!corpo) {
    return fail("validation_error", "Escreva a mensagem antes de enviar.", 422, { requestId });
  }
  if (corpo.length > MAX_CORPO) {
    return fail("validation_error", `A mensagem passa de ${MAX_CORPO} caracteres.`, 422, {
      requestId,
    });
  }

  const { data: lead, error: selErr } = await supabase
    .from("crm_leads")
    .select("id, organization_id, contact_id, title")
    .eq("id", leadId)
    .maybeSingle();

  if (selErr) return fail("internal_error", selErr.message, 500, { requestId });
  if (!lead) return fail("not_found", "Lead não encontrado.", 404, { requestId });
  if (!lead.contact_id) {
    return fail("conflict", "Este negócio não tem contato ligado.", 409, { requestId });
  }

  const admin = createAdminClient();

  const { data: contato } = await admin
    .from("contacts")
    .select("id, phone_number, wa_identity, is_blocked")
    .eq("id", lead.contact_id)
    .eq("organization_id", lead.organization_id)
    .maybeSingle();

  const c = contato as {
    id: string;
    phone_number: string | null;
    wa_identity: string | null;
    is_blocked: boolean;
  } | null;

  if (!c) return fail("conflict", "O contato deste negócio sumiu.", 409, { requestId });
  if (!c.phone_number) {
    return fail("conflict", "O contato não tem telefone.", 409, { requestId });
  }
  if (c.is_blocked) {
    return fail("forbidden", "Este contato pediu para não ser mais contatado.", 403, { requestId });
  }
  if (telefoneDivergeDaIdentidade(c.phone_number, c.wa_identity)) {
    return fail(
      "conflict",
      "O telefone do contato não bate com o WhatsApp dele — a mensagem sairia e não chegaria. Confira o número antes.",
      409,
      { requestId },
    );
  }

  const sessionId = await resolverSessao(admin, lead.organization_id, c.id);
  if (!sessionId) {
    return fail("conflict", "Nenhum número de WhatsApp conectado para enviar.", 409, { requestId });
  }

  let conversationId: string;
  try {
    conversationId = await ensureConversation(admin, lead.organization_id, c.id, sessionId);
  } catch (err) {
    logger.error("[primeiro-toque] conversa não abriu", {
      leadId,
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Não foi possível abrir a conversa.", 500, { requestId });
  }

  // Cliente do USUÁRIO (não o admin): o envio passa pela RLS como qualquer
  // mensagem digitada no inbox, e `sent_by_user_id` recebe quem clicou.
  let message: { id: string; status: string };
  try {
    message = (await sendMessageHandler(
      supabase,
      {
        organization_id: lead.organization_id,
        actor: { type: "user", id: user.id },
        requestId,
      },
      {
        conversation_id: conversationId,
        type: "text",
        body: corpo,
        metadata: { origem: "kanban:primeiro-toque", lead_id: leadId },
      } as SendMessageInput,
    )) as unknown as { id: string; status: string };
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: lead.organization_id,
    leadId,
    contactId: c.id,
    type: "note",
    sourceModule: "crm",
    sourceId: leadId,
    actor: { type: "user", id: user.id },
    reason: "Primeiro toque enviado pelo WhatsApp a partir do funil.",
    payload: { conversation_id: conversationId, message_id: message.id },
  });
  if (!atividade.ok) {
    logger.warn("[primeiro-toque] atividade não registrada", {
      leadId,
      error: atividade.error,
      requestId,
    });
  }

  await audit({
    action: "lead.first_touch_sent",
    actorUserId: user.id,
    organizationId: lead.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: { conversation_id: conversationId, message_id: message.id, status: message.status },
  });

  return ok(
    { conversation_id: conversationId, message_id: message.id, status: message.status },
    { status: 201, requestId },
  );
}
