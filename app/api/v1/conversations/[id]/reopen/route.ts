/**
 * POST /api/v1/conversations/[id]/reopen — reabre uma conversa fechada.
 *
 * Contraparte do /close. Sem isto, fechar é caminho sem volta pela UI: o
 * composer fica desligado e não há botão que traga a conversa de volta — o
 * vendedor só reabre se o contato mandar mensagem (a ingestão reabre). O
 * bom-dia das 8h30 fecha a própria conversa depois de enviar, então a rota
 * mais comum de esbarrar nisso é a conversa do próprio time.
 *
 * Não bloqueia por assignee — mesma regra do /close: qualquer membro com
 * permissão (RLS) pode reabrir.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types/messaging";

export const dynamic = "force-dynamic";

const SELECT_COLS = `
  id, organization_id, contact_id, channel_session_id, channel, status,
  status_changed_at, assigned_to_user_id, assigned_at, last_inbound_at,
  last_outbound_at, last_message_at, last_message_preview,
  unread_count_for_assignee, is_group, group_chat_id, metadata,
  created_at, updated_at
`;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const user = authz.user;

  const { data: current, error: readError } = await supabase
    .from("conversations")
    .select("id, status, assigned_to_user_id")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return fail("internal_error", readError.message, 500, { requestId });
  }
  if (!current) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }

  // Reabrir preserva o dono: conversa que estava com alguém volta 'claimed',
  // igual ao que o transfer faz. Voltar sempre pra 'open' devolveria pra fila
  // uma conversa que já tem responsável.
  const nextStatus = current.assigned_to_user_id ? "claimed" : "open";
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("conversations")
    .update({ status: nextStatus, status_changed_at: now })
    .eq("id", id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }

  const conv = data as unknown as Conversation;

  await audit({
    action: "conversation.reopened",
    actorUserId: user.id,
    organizationId: conv.organization_id,
    resourceType: "conversation",
    resourceId: conv.id,
    requestId,
  });

  return ok(conv, { requestId });
}
