/**
 * O trilho por onde as mensagens do agendamento saem.
 *
 * Mesmo caminho do bom-dia do plano (contato → sessão → conversa →
 * `sendMessageHandler`), e pelo mesmo motivo: quem passa por aqui ganha
 * histórico no inbox, audit, e o redrive automático de `queued` quando a
 * sessão WAHA volta. Cutucar o WAHA direto entregaria a mensagem e perderia
 * as três coisas.
 *
 * ZERO LLM, de propósito — o texto é montado em `lib/meetings/mensagens.ts`.
 * Os agentes da NEXO seguem sem versão publicada, e um lembrete de reunião não
 * pode depender disso para sair.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { logger } from "@/lib/logger";

export type ResultadoDoEnvio =
  | { ok: true; messageId: string; conversationId: string }
  | {
      ok: false;
      motivo:
        | "sem_contato"
        | "sem_telefone"
        | "contato_bloqueado"
        | "sem_sessao"
        | "automacao_desligada"
        | "ja_confirmada"
        | "falhou";
      detalhe?: string;
    };

/**
 * A org está com as mensagens automáticas desligadas?
 *
 * Reusa a MESMA chave que cala a IA nas respostas
 * (`organizations.settings.ai_dispatch_mode = 'external'`, spec 14) em vez de
 * criar uma segunda. A razão é do dia 12/08/2026: a IA já estava desligada na
 * chave certa e ainda assim saiu uma mensagem sozinha uma hora antes de uma
 * reunião — porque o lembrete de agendamento não consultava chave nenhuma.
 *
 * Dois interruptores para a mesma pergunta ("a IA está calada?") é exatamente
 * como se chega nesse tipo de surpresa: desliga-se um e o outro segue mandando.
 * Aqui há um só, e ele vale para os três textos do anti-no-show (confirmação,
 * véspera e toque final).
 *
 * FAIL-CLOSED: se a leitura falhar, considera DESLIGADO. Entre não mandar e
 * mandar sem saber se era permitido, o erro caro é o segundo — a mensagem que
 * sai no WhatsApp do lead não tem botão de desfazer.
 */
export async function automacaoDesligada(
  admin: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    logger.error("[agendamento] interruptor da automação ilegível — tratando como desligado", {
      organizationId,
      error: error.message,
    });
    return true;
  }

  const settings = (data as { settings?: unknown } | null)?.settings;
  const modo =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).ai_dispatch_mode
      : undefined;
  return modo === "external";
}

/**
 * A sessão por onde falar com este contato.
 *
 * Preferir a sessão da conversa que já existe não é detalhe: a org pode ter
 * mais de um número, e responder de um número diferente daquele em que o lead
 * foi abordado faz a confirmação chegar como mensagem de estranho — que é
 * justamente o que produz no-show.
 */
export async function resolverSessao(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<string | null> {
  const { data: conversa } = await admin
    .from("conversations")
    .select("channel_session_id, channel_sessions:channel_session_id(status)")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const daConversa = conversa as {
    channel_session_id: string | null;
    channel_sessions: { status: string } | { status: string }[] | null;
  } | null;
  if (daConversa?.channel_session_id) {
    const sessao = Array.isArray(daConversa.channel_sessions)
      ? daConversa.channel_sessions[0]
      : daConversa.channel_sessions;
    if (sessao?.status === "WORKING") return daConversa.channel_session_id;
  }

  const { data } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "WORKING")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? (data as { id: string }).id : null;
}

export interface EnvioDeTexto {
  organizationId: string;
  contactId: string | null;
  corpo: string;
  /** Vai para `messages.metadata` — é o rastro de quem mandou e por quê. */
  metadata: Record<string, unknown>;
  /** Quem aparece no audit da mensagem. */
  origem: string;
  requestId: string;
}

/** Manda um texto para o contato do lead. Nunca lança — devolve o motivo. */
export async function enviarTexto(
  admin: SupabaseClient,
  envio: EnvioDeTexto,
): Promise<ResultadoDoEnvio> {
  if (!envio.contactId) return { ok: false, motivo: "sem_contato" };

  const { data: contato } = await admin
    .from("contacts")
    .select("id, phone_number, is_blocked")
    .eq("id", envio.contactId)
    .eq("organization_id", envio.organizationId)
    .maybeSingle();

  const c = contato as { id: string; phone_number: string | null; is_blocked: boolean } | null;
  if (!c) return { ok: false, motivo: "sem_contato" };
  if (!c.phone_number) return { ok: false, motivo: "sem_telefone" };
  if (c.is_blocked) return { ok: false, motivo: "contato_bloqueado" };

  const sessionId = await resolverSessao(admin, envio.organizationId, c.id);
  if (!sessionId) return { ok: false, motivo: "sem_sessao" };

  try {
    const conversationId = await ensureConversation(
      admin,
      envio.organizationId,
      c.id,
      sessionId,
    );
    const message = await sendMessageHandler(
      admin,
      {
        organization_id: envio.organizationId,
        actor: { type: "webhook_source", id: envio.origem },
        requestId: envio.requestId,
      },
      {
        conversation_id: conversationId,
        type: "text",
        body: envio.corpo,
        metadata: envio.metadata,
      } as Parameters<typeof sendMessageHandler>[2],
    );
    return { ok: true, messageId: (message as { id: string }).id, conversationId };
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[meetings] envio falhou", {
      organizationId: envio.organizationId,
      origem: envio.origem,
      error: detalhe,
      requestId: envio.requestId,
    });
    return { ok: false, motivo: "falhou", detalhe };
  }
}
