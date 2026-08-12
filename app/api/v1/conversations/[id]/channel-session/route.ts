/**
 * PATCH /api/v1/conversations/[id]/channel-session — troca o número de WhatsApp
 * por onde esta conversa fala.
 *
 * O número de saída nunca foi escolha de ninguém: a conversa nasce presa ao
 * canal que RECEBEU a primeira mensagem (fn_upsert_wa_conversation), e todo
 * envio — humano, IA, agendamento — sai por ele. Numa org com dois números isso
 * quer dizer que quem atende pode estar respondendo pelo número do colega sem
 * ver, porque nenhuma tela dizia por onde a mensagem saía.
 *
 * ⚠️ Trocar tem custo do lado do cliente: no celular dele a resposta chega de
 * um número que ele não conhece, sem o histórico. Quem chama (a UI) avisa antes;
 * aqui a troca é aceita como decisão do usuário.
 *
 * ⚠️ `conversations` tem unique (organization_id, contact_id, channel_session_id)
 * where is_group = false — o mesmo contato JÁ pode ter conversa no número de
 * destino. Nesse caso não existe troca a fazer: a conversa daquele número é
 * aquela, e a resposta devolve o `conversation_id` dela para a UI abrir. Sem
 * isso o UPDATE estouraria 23505 e o usuário levaria um erro cru no lugar da
 * conversa que ele estava procurando.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ channel_session_id: z.string().uuid() });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  // spec 13 §4: escrita na conversa é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const destinoId = parsed.data.channel_session_id;

  const supabase = await createClient();
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, contact_id, channel_session_id, is_group")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (convErr) return fail("internal_error", convErr.message, 500, { requestId });
  if (!conv) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  if (conv.channel_session_id === destinoId) {
    return ok({ conversation_id: conv.id, trocou: false }, { requestId });
  }
  // Grupo é identificado pelo chatId `@g.us` dentro de UMA sessão do WhatsApp:
  // o outro número simplesmente não está lá dentro. Trocar produziria envio
  // para um grupo do qual a sessão não participa — erro do WAHA, não conversa.
  if (conv.is_group) {
    return fail("invalid_state_transition", "Conversa de grupo não troca de número.", 422, {
      requestId,
    });
  }
  if (!conv.contact_id) {
    return fail("invalid_state_transition", "Conversa sem contato não troca de número.", 422, {
      requestId,
    });
  }

  const { data: destino, error: destinoErr } = await supabase
    .from("channel_sessions")
    .select("id, status, archived_at")
    .eq("id", destinoId)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (destinoErr) return fail("internal_error", destinoErr.message, 500, { requestId });
  if (!destino || destino.archived_at) {
    return fail("not_found", "Número não encontrado.", 404, { requestId });
  }
  // Mandar por número desconectado deixaria a mensagem em `queued` sem ninguém
  // dizer por quê (queued_reason: channel_session_not_working) — recusar aqui é
  // o aviso que o usuário consegue ler, na hora em que ainda dá para escolher.
  if (destino.status !== "WORKING") {
    return fail("unprocessable_entity", "Esse número não está conectado.", 422, { requestId });
  }

  const { data: existente, error: existenteErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", org.orgId)
    .eq("contact_id", conv.contact_id)
    .eq("channel_session_id", destinoId)
    .eq("is_group", false)
    .maybeSingle();
  if (existenteErr) return fail("internal_error", existenteErr.message, 500, { requestId });
  if (existente && existente.id !== conv.id) {
    return ok(
      { conversation_id: existente.id, trocou: false, ja_existia: true },
      { requestId },
    );
  }

  // `.select("id").maybeSingle()` confirma que a linha existia e era escrevível:
  // UPDATE barrado pela RLS afeta 0 linhas e ainda assim retornaria sucesso —
  // audit de mutação que não ocorreu (mesma lição do snooze).
  const { data: atualizada, error: updErr } = await supabase
    .from("conversations")
    .update({ channel_session_id: destinoId })
    .eq("id", conv.id)
    .eq("organization_id", org.orgId)
    .select("id")
    .maybeSingle();
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });
  if (!atualizada) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  void audit({
    action: "conversation.channel_session_changed",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: atualizada.id,
    requestId,
    metadata: { de: conv.channel_session_id, para: destinoId },
  });

  return ok({ conversation_id: atualizada.id, trocou: true }, { requestId });
}
