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
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { logger } from "@/lib/logger";
import { getWahaClient } from "@/lib/waha/client";

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

/**
 * O "digitando…" antes da fala — o que separa resposta de gente de resposta
 * de robô. O pedido é do Mario (22/08): o obrigado do "confirmado" chegou no
 * MESMO segundo da mensagem do lead, e resposta instantânea denuncia máquina
 * exatamente na conversa em que a Nexo quer parecer bem atendida.
 *
 * A duração acompanha o tamanho do texto (45ms por caractere, entre 2s e 5s) —
 * "digitou" 3 segundos e soltou um parágrafo também denuncia. O teto de 5s é
 * deliberado: isto roda DENTRO do webhook da mensagem recebida, e segurar a
 * resposta HTTP por muito tempo faria o WAHA reenviar o evento.
 *
 * MELHOR-ESFORÇO por inteiro: qualquer falha aqui (WAHA sem o endpoint, sessão
 * caída, conversa sem grupo) é engolida com log e o envio segue — o teatro
 * nunca pode custar a mensagem.
 */
async function digitarAntes(
  admin: SupabaseClient,
  conversationId: string,
  corpo: string,
  requestId: string,
): Promise<void> {
  try {
    const client = getWahaClient();
    if (!client) return;

    const { data } = await admin
      .from("conversations")
      .select("group_chat_id, channel_sessions:channel_session_id(waha_session_name)")
      .eq("id", conversationId)
      .maybeSingle();
    const row = data as {
      group_chat_id: string | null;
      channel_sessions: { waha_session_name: string } | { waha_session_name: string }[] | null;
    } | null;
    const sessao = Array.isArray(row?.channel_sessions)
      ? row?.channel_sessions[0]
      : row?.channel_sessions;
    if (!row?.group_chat_id || !sessao?.waha_session_name) return;

    await client.startTyping(sessao.waha_session_name, row.group_chat_id);
    const ms = Math.min(5000, Math.max(2000, corpo.length * 45));
    await new Promise((r) => setTimeout(r, ms));
    await client.stopTyping(sessao.waha_session_name, row.group_chat_id);
  } catch (err) {
    logger.warn("[agendamento] 'digitando' falhou — mensagem sai sem o teatro", {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
  }
}

/**
 * Manda um texto NUMA CONVERSA que já existe — o caso do grupo da reunião.
 *
 * Separado de `enviarTexto` porque lá o alvo é um CONTATO e a conversa é
 * derivada dele (`ensureConversation`); aqui o alvo é a conversa em si, que é
 * de grupo e não tem contato próprio. Passar o contato do lead por
 * `enviarTexto` mandaria a mensagem no privado dele — exatamente o que o grupo
 * existe para substituir.
 *
 * O roteamento para o `…@g.us` acontece sozinho: `sendMessageHandler` lê
 * `is_group`/`group_chat_id` da conversa (ver `lib/waha/send.ts`).
 */
export async function enviarNoGrupo(
  admin: SupabaseClient,
  envio: Omit<EnvioDeTexto, "contactId"> & {
    conversationId: string;
    /** Mostra "digitando…" antes de enviar — só para RESPOSTA a alguém (ver `digitarAntes`). */
    digitando?: boolean;
  },
): Promise<ResultadoDoEnvio> {
  try {
    if (envio.digitando) {
      await digitarAntes(admin, envio.conversationId, envio.corpo, envio.requestId);
    }
    const message = await sendMessageHandler(
      admin,
      {
        organization_id: envio.organizationId,
        actor: { type: "webhook_source", id: envio.origem },
        requestId: envio.requestId,
      },
      {
        conversation_id: envio.conversationId,
        type: "text",
        body: envio.corpo,
        metadata: envio.metadata,
      } as Parameters<typeof sendMessageHandler>[2],
    );
    return {
      ok: true,
      messageId: (message as { id: string }).id,
      conversationId: envio.conversationId,
    };
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[agendamento] envio no grupo falhou", {
      organizationId: envio.organizationId,
      conversationId: envio.conversationId,
      origem: envio.origem,
      error: detalhe,
      requestId: envio.requestId,
    });
    return { ok: false, motivo: "falhou", detalhe };
  }
}

/**
 * Manda o áudio REUTILIZÁVEL do Claudio numa conversa de grupo.
 *
 * O binário mora fora da conversa (`{org}/library/…`), e o envio de mídia exige
 * posse (`isMediaPathOwnedBy`): por isso o objeto é COPIADO para dentro da
 * conversa antes de sair — o mesmo desenho da gaveta de áudios do inbox
 * (`saved-audios/[id]/attach`), pela mesma razão. Bônus idêntico: trocar o
 * áudio da biblioteca não muda o que os grupos antigos já receberam.
 *
 * `type: "audio"` faz o WAHA sair por `sendVoice` com `convert: true` — chega
 * como nota de voz, indistinguível de gravada na hora.
 */
export async function enviarAudioNoGrupo(
  admin: SupabaseClient,
  envio: Omit<EnvioDeTexto, "contactId" | "corpo"> & {
    conversationId: string;
    /** Path do áudio na biblioteca do bucket `whatsapp-media`. */
    audioDaBiblioteca: string;
  },
): Promise<ResultadoDoEnvio> {
  try {
    const extensao = envio.audioDaBiblioteca.split(".").pop()?.toLowerCase() || "mp3";
    const destino = `${envio.organizationId}/${envio.conversationId}/out-${randomUUID()}.${extensao}`;
    const { error: copyErr } = await admin.storage
      .from("whatsapp-media")
      .copy(envio.audioDaBiblioteca, destino);
    if (copyErr) throw new Error(`copia_do_audio_falhou: ${copyErr.message}`);

    const message = await sendMessageHandler(
      admin,
      {
        organization_id: envio.organizationId,
        actor: { type: "webhook_source", id: envio.origem },
        requestId: envio.requestId,
      },
      {
        conversation_id: envio.conversationId,
        type: "audio",
        media_storage_path: destino,
        media_mime: extensao === "ogg" ? "audio/ogg" : "audio/mpeg",
        metadata: envio.metadata,
      } as Parameters<typeof sendMessageHandler>[2],
    );
    const m = message as { id: string; status?: string };
    // O handler não lança quando o WAHA recusa — grava `failed` e devolve. Um
    // áudio `failed` precisa contar como falha aqui, senão a abertura perderia
    // a apresentação sem o texto reserva sair no lugar.
    if (m.status === "failed") return { ok: false, motivo: "falhou", detalhe: "waha_failed" };
    return { ok: true, messageId: m.id, conversationId: envio.conversationId };
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[agendamento] áudio no grupo falhou", {
      organizationId: envio.organizationId,
      conversationId: envio.conversationId,
      origem: envio.origem,
      error: detalhe,
      requestId: envio.requestId,
    });
    return { ok: false, motivo: "falhou", detalhe };
  }
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
