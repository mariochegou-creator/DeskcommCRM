/**
 * lib/waha/ingest.ts — pipeline de ingestão WAHA compartilhado pelos dois route
 * handlers de webhook (`/waha` global e `/waha/[token]` per-tenant).
 *
 * Fonte única da verdade para: parse de identidade WhatsApp, resolução de
 * contato/conversa e persistência de mensagem. Resolução é ATÔMICA via RPC
 * (fn_upsert_wa_contact / fn_upsert_wa_conversation) — o padrão check-then-act
 * antigo criava um contato/conversa novo a cada mensagem porque o WAHA NOWEB
 * emite `message` E `message.any` para a mesma mensagem (corrida). Ver migration
 * 0027 para o modelo de identidade canônica.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { audit } from "@/lib/audit";
import { analisarVCard } from "@/lib/contacts/vcard";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ackToStatus } from "@/lib/types/messaging";
import { bareWaMessageId } from "@/lib/waha/message-id";
import { ehPedidoDeOptOut } from "@/lib/waha/opt-out";

type Admin = ReturnType<typeof createAdminClient>;

interface Session {
  id: string;
  organization_id: string;
}

export interface WahaPayload {
  id?: string;
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string;
  type?: string;
  hasMedia?: boolean;
  ack?: number;
  ackName?: string;
  participant?: string;
  author?: string;
  status?: string;
  timestamp?: number;
  mediaUrl?: string;
  mimetype?: string;
  /** WAHA >= 2026.x (NOWEB): mídia vem aninhada em payload.media. */
  media?: { url?: string | null; mimetype?: string | null; filename?: string | null } | null;
  /** NOWEB: contato compartilhado — um texto de vCard por cartão enviado. */
  vCards?: string[] | null;
  _data?: {
    notifyName?: string;
    pushName?: string;
    /** NOWEB: o conteúdo real (imageMessage, stickerMessage, …) — fonte do tipo. */
    message?: Record<string, unknown>;
    /**
     * NOWEB: a WAMessageKey. `remoteJid` é SEMPRE o outro lado do chat.
     * `remoteJidAlt` é o JID alternativo: quando o chat vem identificado por
     * `@lid` (pseudônimo de privacidade), o telefone real chega aqui.
     */
    key?: {
      id?: string;
      fromMe?: boolean;
      remoteJid?: string;
      remoteJidAlt?: string;
    } & Record<string, unknown>;
  } & Record<string, unknown>;
}

/** Identidade da própria sessão, como o WAHA a devolve no envelope. */
export interface WahaMe {
  id?: string | null;
  lid?: string | null;
}

export interface WahaEnvelope {
  event?: string;
  session?: string;
  payload?: WahaPayload;
  /** Quem é a sessão. Usado para nunca confundir o próprio número com o contato. */
  me?: WahaMe | null;
}

export type ChatIdentity =
  | { kind: "phone"; phone: string; lid: null }
  | { kind: "lid"; phone: null; lid: string } // lid = somente dígitos
  | { kind: "group"; phone: null; lid: null };

/**
 * Resolve um chatId WAHA em identidade canônica:
 *  - `{number}@c.us` | `@s.whatsapp.net` -> phone E.164 ("+55...")
 *  - `{lid}@lid` -> lid (somente dígitos; número protegido pelo WhatsApp)
 *  - `@g.us` | formato desconhecido -> group (skip binding CRM)
 */
export function parseChatId(chatId: string): ChatIdentity {
  if (chatId.endsWith("@g.us")) return { kind: "group", phone: null, lid: null };
  if (chatId.endsWith("@lid")) {
    return { kind: "lid", phone: null, lid: chatId.replace(/@.*$/, "") };
  }
  if (chatId.endsWith("@c.us") || chatId.endsWith("@s.whatsapp.net")) {
    const digits = chatId.replace(/@.*$/, "").replace(/^\+/, "");
    return { kind: "phone", phone: "+" + digits, lid: null };
  }
  return { kind: "group", phone: null, lid: null };
}

/**
 * parseChatId com o véu do LID levantado: quando o chat chega como `@lid`
 * (pseudônimo de privacidade do WhatsApp), a WAMessageKey traz o JID real em
 * `remoteJidAlt` — e é o TELEFONE que casa com o resto do CRM.
 *
 * Sem esta troca, `wa_identity` nasce como `lid:…` e NÃO bate com o contato
 * que a importação de prospecção criou (`phone:+55…`): a conversa aparece no
 * inbox sem nome, sem telefone, sem os leads e sem os ganchos de abertura.
 * Visto no ar em 05/08/2026 — o "oi" pro Hotel Rio Branco criou um contato
 * fantasma em vez de cair no contato com o gancho.
 *
 * O alt só é aceito se resolver para telefone: alt ausente, de grupo ou de
 * formato desconhecido mantém a identidade lid (que segue funcional — só não
 * casa com contatos importados).
 */
export function parseChatIdComAlt(chatId: string, p: WahaPayload): ChatIdentity {
  const parsed = parseChatId(chatId);
  if (parsed.kind !== "lid") return parsed;
  const alt = p._data?.key?.remoteJidAlt;
  if (typeof alt === "string" && alt) {
    const altParsed = parseChatId(alt);
    if (altParsed.kind === "phone") return altParsed;
  }
  return parsed;
}

// A leitura do opt-out mora em `lib/waha/opt-out.ts` desde 12/08/2026. Aqui
// havia uma busca de palavra solta (`/\b(STOP|PARAR|SAIR|UNSUBSCRIBE)\b/i`) que
// casava a palavra no meio de qualquer frase — e como o bloqueio é
// IRREVERSÍVEL, cada engano apagava um lead vivo em silêncio. Dois aconteceram:
// a resposta comercial que dizia "antes de sair de casa" e a despedida da nossa
// própria cadência ("vou parar de te escrever"), que voltou como recebida e
// bloqueou o contato com o nosso texto. Ver o cabeçalho daquele módulo.

export function verifyHmacSha512(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const got = signatureHeader.replace(/^sha512=/i, "").trim();
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * O texto dos cartões de contato que vieram na mensagem, ou null.
 *
 * ⚠️ ISTO É O QUE FAZIA O CONTATO COMPARTILHADO SUMIR DO INBOX. O NOWEB manda
 * "compartilhar contato" com `body: null`, `hasMedia: false` e `media: null` —
 * o vCard vai em `payload.vCards[]` (e em `_data.message.contactMessage.vcard`).
 * A guarda de conteúdo lia só body/mídia, então a mensagem morria como
 * `skip:sem_conteudo`: chegava no WhatsApp Web e nunca no CRM. Medido em
 * 12/08/2026, no cartão do Hotel Taco de Ouro que o David mandou.
 *
 * O topo do payload vem primeiro porque é a forma normalizada do WAHA e já
 * cobre `multi_vcard` (o WhatsApp deixa mandar vários cartões numa mensagem
 * só). `_data.message` é o cru do Baileys, usado quando o topo não veio.
 *
 * O retorno é o texto inteiro, com um cartão por bloco `BEGIN:VCARD` — é ele
 * que vira o `body` da mensagem, e é dele que `lib/contacts/vcard.ts` tira nome
 * e telefone tanto na bolha quanto na rota que grava o vínculo.
 */
export function textoDosVCards(p: WahaPayload): string | null {
  const cartoes: string[] = [];
  const guardar = (v: unknown) => {
    if (typeof v === "string" && v.includes("BEGIN:VCARD")) cartoes.push(v);
  };

  if (Array.isArray(p.vCards)) p.vCards.forEach(guardar);

  if (cartoes.length === 0) {
    const msg = p._data?.message as Record<string, unknown> | undefined;
    const um = msg?.contactMessage as { vcard?: unknown } | undefined;
    guardar(um?.vcard);
    const varios = msg?.contactsArrayMessage as { contacts?: unknown } | undefined;
    if (Array.isArray(varios?.contacts)) {
      for (const c of varios.contacts) guardar((c as { vcard?: unknown })?.vcard);
    }
  }

  return cartoes.length > 0 ? cartoes.join("\n") : null;
}

/**
 * O que vai para `messages.body`: o texto escrito, ou o vCard quando a mensagem
 * É um contato. A bolha do inbox lê o `body` de uma mensagem `contact` como
 * vCard — deixá-lo nulo desenharia uma bolha vazia.
 */
function corpoDaMensagem(p: WahaPayload): string | null {
  return p.body ?? textoDosVCards(p);
}

function previewFromMessage(p: WahaPayload): string {
  if (p.body) return p.body.slice(0, 280);
  // Cartão de contato: a lista de conversas mostra o nome de quem foi
  // compartilhado, não "[contact]" nem sete linhas de BEGIN:VCARD.
  const vcards = textoDosVCards(p);
  if (vcards) {
    const nomes = analisarVCard(vcards)
      .map((c) => c.nome)
      .filter(Boolean);
    return nomes.length > 0 ? `Contato: ${nomes.join(", ")}`.slice(0, 280) : "[contato]";
  }
  const t = resolveMessageType(p);
  return t !== "text" ? `[${t}]` : "";
}

/** URL da mídia: WAHA novo (payload.media.url) com fallback legado (payload.mediaUrl). */
export function mediaUrlOf(p: WahaPayload): string | null {
  return p.mediaUrl ?? p.media?.url ?? null;
}

/** MIME da mídia: idem (payload.media.mimetype é o campo do NOWEB atual). */
export function mediaMimeOf(p: WahaPayload): string | null {
  return p.mimetype ?? p.media?.mimetype ?? null;
}

/**
 * Mapeia o `type` cru do WAHA NOWEB para o vocabulário de messages.type do CRM
 * (check constraint messages_type_check). WAHA usa `chat` p/ texto, `ptt` p/
 * áudio de voz, `vcard` p/ contato, etc. Sem esse mapa o INSERT viola a
 * constraint e a mensagem some. O type cru fica em metadata.raw_type.
 */
const WA_TYPE_MAP: Record<string, string> = {
  chat: "text",
  text: "text",
  ptt: "audio",
  audio: "audio",
  image: "image",
  video: "video",
  document: "document",
  sticker: "sticker",
  location: "location",
  vcard: "contact",
  contact: "contact",
  multi_vcard: "contact",
  reaction: "reaction",
};

function mapWahaMessageType(raw: string | undefined): string {
  if (!raw) return "text";
  // Fallback "text": só chegamos ao insert com body/mídia presente (guarda acima),
  // então tratar tipo desconhecido como texto não perde a mensagem.
  return WA_TYPE_MAP[raw.toLowerCase()] ?? "text";
}

/**
 * NOWEB (WAHA 2026.x) não envia `type` no payload — o tipo real está nas
 * chaves de `_data.message` (imageMessage, stickerMessage, …). Ordem de
 * resolução: `type` explícito → chave do message → prefixo do MIME → text.
 */
const NOWEB_MESSAGE_KEY_TYPE: Record<string, string> = {
  contactMessage: "contact",
  contactsArrayMessage: "contact",
  stickerMessage: "sticker",
  imageMessage: "image",
  videoMessage: "video",
  ptvMessage: "video", // video note (bolinha)
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
};

export function resolveMessageType(p: WahaPayload): string {
  if (p.type) return mapWahaMessageType(p.type);
  // vCard no topo do payload sem `_data` (WAHA normaliza assim): sem esta linha
  // o cartão entraria como `text` e a bolha mostraria o BEGIN:VCARD cru.
  if (Array.isArray(p.vCards) && p.vCards.length > 0) return "contact";
  const msg = p._data?.message;
  if (msg && typeof msg === "object") {
    for (const [key, mapped] of Object.entries(NOWEB_MESSAGE_KEY_TYPE)) {
      if (key in msg) return mapped;
    }
  }
  const mime = mediaMimeOf(p);
  if (mime) {
    if (mime === "image/webp") return "sticker";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "document";
  }
  return "text";
}

function notifyNameOf(p: WahaPayload): string | null {
  return p._data?.notifyName ?? p._data?.pushName ?? null;
}

/**
 * Upsert atômico de contato pela identidade canônica. Retorna null se a
 * identidade for de grupo ou a RPC falhar.
 */
async function upsertContact(
  admin: Admin,
  orgId: string,
  parsed: ChatIdentity,
  chatId: string,
  notifyName: string | null,
): Promise<string | null> {
  if (parsed.kind === "group") return null;
  const { data, error } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: orgId,
    p_kind: parsed.kind,
    p_phone: parsed.kind === "phone" ? parsed.phone : null,
    p_lid: parsed.kind === "lid" ? parsed.lid : null,
    p_chat_id: chatId,
    p_notify: notifyName,
  } as never);
  if (error) {
    console.error("[waha.ingest] fn_upsert_wa_contact failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

async function upsertConversation(
  admin: Admin,
  orgId: string,
  contactId: string,
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation" as never, {
    p_org: orgId,
    p_contact: contactId,
    p_session: sessionId,
  } as never);
  if (error) {
    console.error("[waha.ingest] fn_upsert_wa_conversation failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

/**
 * Carimba a conversa com a mensagem que acabou de entrar.
 *
 * ⚠️ FALHA BAIXO, MAS CONTA — e a diferença entre as duas coisas é o motivo
 * desta função existir com corpo próprio. A mensagem JÁ foi inserida quando
 * chegamos aqui; bloquear a ingestão porque o carimbo falhou deixaria o
 * histórico refém de uma coluna derivada. Então não se bloqueia.
 *
 * Mas `console.error` sozinho não é "falhar baixo": ele **não bloqueia e também
 * não conta** (anti-pattern nº 14 do CLAUDE.md, e a mesma doutrina já escrita em
 * `lib/leads/activity-write-failure.ts`). Log de servidor sem destino não vira
 * alerta de ninguém — e o efeito prático é que "a RPC falha às vezes" nunca sai
 * de OPINIÃO para NÚMERO. Em 25/07 isso custou caro: a suspeita de que esta
 * chamada falhava foi levada a sério por horas, e não havia como medi-la porque
 * cada falha tinha sumido no log de um processo que já não existia.
 *
 * O evento é o que torna a pergunta respondível: `select count(*) from event_log
 * where event_type = 'whatsapp.conversation_mark_failed'`.
 */
async function markConversation(
  admin: Admin,
  organizationId: string,
  convId: string,
  direction: "inbound" | "outbound",
  preview: string,
  at: string,
): Promise<void> {
  const { error } = await admin.rpc("fn_mark_conversation_message" as never, {
    p_conv: convId,
    p_direction: direction,
    p_preview: preview,
    p_at: at,
  } as never);
  if (!error) return;

  const { error: erroAviso } = await admin.rpc("emit_event" as never, {
    p_event_type: "whatsapp.conversation_mark_failed",
    p_entity_kind: "conversation",
    p_entity_id: convId,
    // O preview NÃO entra no payload: ele é o texto da mensagem do cliente, e
    // isto é registro operacional, não cópia de conteúdo. O que se precisa
    // saber para agir é qual conversa, que sentido, e o erro.
    p_payload: { direction, erro: error.message },
    p_metadata: { severity: "warn" },
    p_organization_id: organizationId,
  } as never);

  if (erroAviso) {
    // Segunda linha de defesa: o próprio canal de aviso caiu. Aqui o log do
    // processo é o que sobra — é para ESTE caso que ele existe, não como rotina.
    console.error("[waha.ingest] o carimbo falhou E o aviso também", {
      conversa: convId,
      erro: error.message,
      aviso: erroAviso.message,
    });
  }
}

/**
 * Mensagem recebida (fromMe=false). Contato = remetente (`from`).
 *
 * Devolve o MOTIVO do descarte (ou `null` quando gravou) — o route handler
 * carimba isso em `webhook_events_log.error_message`. Antes eram returns mudos
 * e "evento chegou mas mensagem não existe" era indiagnosticável.
 */
async function handleInbound(
  admin: Admin,
  session: Session,
  p: WahaPayload,
  requestId: string,
): Promise<string | null> {
  const chatId = p.from ?? "";
  const parsed = parseChatIdComAlt(chatId, p);
  if (parsed.kind === "group") return "grupo"; // grupos não fazem binding CRM
  if (!p.id || !chatId) return "sem_id_ou_chat";
  // WAHA emite eventos vazios p/ status/read-receipt/presence — não viram mensagem.
  const corpo = corpoDaMensagem(p);
  if (!corpo && !mediaUrlOf(p) && !p.hasMedia) return "sem_conteudo";

  const contactId = await upsertContact(admin, session.organization_id, parsed, chatId, notifyNameOf(p));
  if (!contactId) return "contato_upsert_falhou";
  const conversationId = await upsertConversation(admin, session.organization_id, contactId, session.id);
  if (!conversationId) return "conversa_upsert_falhou";

  const now = new Date().toISOString();
  const { data: insertedMessage, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      contact_id: contactId,
      external_id: p.id,
      type: resolveMessageType(p),
      direction: "inbound",
      status: "delivered",
      ack: p.ack ?? null,
      body: corpo,
      media_url: mediaUrlOf(p),
      media_mime: mediaMimeOf(p),
      sent_via: "external_device",
      sent_at: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : now,
      delivered_at: now,
      metadata: { raw_type: p.type, ack_name: p.ackName },
    })
    .select("id")
    .maybeSingle();

  // Idempotência: 23505 = unique (organization_id, external_id) já ingerido.
  if (insertErr && insertErr.code !== "23505") {
    console.error("[waha.ingest] message insert failed", insertErr.message);
    return `insert_falhou:${insertErr.message}`;
  }
  if (insertErr?.code === "23505") return "dedupe";

  await markConversation(admin, session.organization_id, conversationId, "inbound", previewFromMessage(p), now);

  if (ehPedidoDeOptOut(p.body)) {
    await admin
      .from("contacts")
      .update({ is_blocked: true, blocked_reason: "stop_keyword", blocked_at: now })
      .eq("id", contactId);
    await audit({
      action: "contact.blocked",
      organizationId: session.organization_id,
      resourceType: "contact",
      requestId,
      metadata: { reason: "stop_keyword", contact_id: contactId },
    });
  }

  await audit({
    action: "message.received",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: { conversation_id: conversationId, type: p.type, external_id: p.id },
  });

  // Dispara o agent-dispatcher worker (fire-and-forget; falha não quebra o 200).
  if (insertedMessage?.id) {
    const inboundMessageId = insertedMessage.id;
    admin
      .rpc("emit_event" as never, {
        p_event_type: "ai_agent.dispatch_requested",
        p_entity_kind: "message",
        p_entity_id: inboundMessageId,
        p_payload: {
          organization_id: session.organization_id,
          conversation_id: conversationId,
          contact_id: contactId,
          channel_session_id: session.id,
          inbound_message_id: inboundMessageId,
        },
        p_metadata: { source: "waha_webhook", request_id: requestId },
        p_organization_id: session.organization_id,
      } as never)
      .then(({ error }) => {
        if (error) console.error("[waha.ingest] emit dispatch_requested failed", error.message);
      });

    admin
      .rpc("emit_event" as never, {
        p_event_type: "message.received",
        p_entity_kind: "message",
        p_entity_id: inboundMessageId,
        p_payload: {
          conversation_id: conversationId,
          contact_id: contactId,
          channel_session_id: session.id,
          body_preview: (p.body ?? "").slice(0, 280),
        },
        p_metadata: { source: "waha_webhook", request_id: requestId },
        p_organization_id: session.organization_id,
      } as never)
      .then(({ error }) => {
        if (error) console.error("[waha.ingest] emit message.received failed", error.message);
      });

    if (mediaUrlOf(p)) {
      admin
        .rpc("emit_event" as never, {
          p_event_type: "media.persist_requested",
          p_entity_kind: "message",
          p_entity_id: inboundMessageId,
          p_payload: { message_id: inboundMessageId, conversation_id: conversationId },
          p_metadata: { source: "waha_webhook", request_id: requestId },
          p_organization_id: session.organization_id,
        } as never)
        .then(({ error }) => {
          if (error) console.error("[waha.ingest] emit media.persist_requested failed", error.message);
        });
    }
  }
  return null;
}

/**
 * Descobre COM QUEM é a conversa numa mensagem `fromMe=true`.
 *
 * ⚠️ Esta função existe por causa de um bug que apagou 368 mensagens enviadas.
 * A versão original lia só `p.to`, porque no WEBJS o `to` é o destinatário e o
 * `from` é o próprio operador. **O NOWEB não manda `to` nenhum**: para fromMe
 * ele põe o outro lado do chat em `from` (= `_data.key.remoteJid`). Resultado no
 * ar: `p.to ?? ""` virava `parseChatId("")` → `group` → `return` mudo, e TODA
 * mensagem enviada pelo WhatsApp Web/celular era descartada sem erro, sem log e
 * sem evento. O inbox ficou só com o que o cliente escreveu — metade da conversa.
 *
 * Ordem: `to` (WEBJS) → `_data.key.remoteJid` (NOWEB, explícito) → `from`
 * (NOWEB). O último passo é o perigoso: no WEBJS `from` É o operador. Por isso a
 * identidade da própria sessão (`me`) veta o candidato — sem esse veto o CRM
 * criaria um "contato" que é o próprio número e conversaria consigo mesmo.
 */
export function resolveOutboundChatId(p: WahaPayload, me?: WahaMe | null): string | null {
  const proprios = new Set(
    [me?.id, me?.lid].filter((v): v is string => typeof v === "string" && v.length > 0),
  );
  for (const candidato of [p.to, p._data?.key?.remoteJid, p.from]) {
    if (!candidato) continue;
    if (proprios.has(candidato)) continue;
    return candidato;
  }
  return null;
}

/**
 * fromMe=true: a mensagem saiu do WhatsApp vinculado (Web, celular, outro
 * atendente) — ou é o eco da que o próprio CRM acabou de enviar. Nos dois casos
 * ela PRECISA entrar no histórico, senão o inbox mostra só um lado da conversa.
 *
 * O contato é o outro lado do chat (ver `resolveOutboundChatId`), nunca o
 * próprio número da sessão.
 */
async function handleOutboundFromUserPhone(
  admin: Admin,
  session: Session,
  p: WahaPayload,
  requestId: string,
  me?: WahaMe | null,
): Promise<string | null> {
  const chatId = resolveOutboundChatId(p, me) ?? "";
  const parsed = parseChatIdComAlt(chatId, p);
  if (parsed.kind === "group") return "grupo";
  if (!p.id || !chatId) return "sem_id_ou_chat";
  const corpo = corpoDaMensagem(p);
  if (!corpo && !mediaUrlOf(p) && !p.hasMedia) return "sem_conteudo";

  // Eco do próprio composer: o CRM já gravou esta linha em `sendMessageHandler`.
  // Os dois lados guardam formas DIFERENTES do mesmo id — o NOWEB responde ao
  // envio com o id cru (`3EB0…`) e manda no webhook o completo
  // (`true_{chat}_3EB0…`); o WEBJS usa o completo nos dois. Procurar pelas duas
  // formas é o que impede a mensagem enviada pelo CRM de aparecer duplicada no
  // thread. A unique (organization_id, external_id) continua como rede embaixo.
  const bare = bareWaMessageId(p.id);
  const idsPossiveis = bare === p.id ? [p.id] : [p.id, bare];
  const { data: jaExiste } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", session.organization_id)
    .in("external_id", idsPossiveis)
    .limit(1)
    .maybeSingle();
  if (jaExiste) return "dedupe";

  // ⚠️ SEM NOME, DE PROPÓSITO — e o `null` aqui é a correção de um estrago real.
  //
  // `notifyNameOf(p)` lê `_data.notifyName`/`pushName`, que numa mensagem
  // `fromMe` é o nome de QUEM ENVIOU: nós. Passá-lo adiante batizou 48 contatos
  // com "David wilkerson Nexoia" / "Mario Brandao" — o inbox virou uma lista de
  // conversas com o próprio operador e o nome do negócio sumiu. A conferência
  // nos payloads é categórica: todo valor não-nulo desse campo em evento fromMe
  // era exatamente o pushName de uma das nossas sessões.
  //
  // Não dá para consertar escolhendo outro campo: uma mensagem que NÓS enviamos
  // não carrega o nome do destinatário. O nome do contato só chega quando ele
  // responde (aí `handleInbound` o grava). Até lá o contato fica sem nome — que
  // é honesto — e `fn_upsert_wa_contact` faz `coalesce(display_name, excluded)`,
  // então o nome real nunca é sobrescrito depois.
  const contactId = await upsertContact(admin, session.organization_id, parsed, chatId, null);
  if (!contactId) return "contato_upsert_falhou";
  const conversationId = await upsertConversation(admin, session.organization_id, contactId, session.id);
  if (!conversationId) return "conversa_upsert_falhou";

  const now = new Date().toISOString();
  const { data: insertedOutbound, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      contact_id: contactId,
      external_id: p.id,
      type: resolveMessageType(p),
      direction: "outbound",
      status: "sent",
      ack: p.ack ?? null,
      body: corpo,
      media_url: mediaUrlOf(p),
      media_mime: mediaMimeOf(p),
      sent_via: "external_device",
      sent_at: p.timestamp ? new Date(p.timestamp * 1000).toISOString() : now,
      metadata: { raw_type: p.type, fromMe: true },
    })
    .select("id")
    .maybeSingle();
  if (insertErr && insertErr.code !== "23505") {
    console.error("[waha.ingest] outbound insert failed", insertErr.message);
    return `insert_falhou:${insertErr.message}`;
  }
  if (insertErr?.code === "23505") return "dedupe";

  await markConversation(admin, session.organization_id, conversationId, "outbound", previewFromMessage(p), now);

  await audit({
    action: "message.sent",
    organizationId: session.organization_id,
    resourceType: "message",
    requestId,
    metadata: { conversation_id: conversationId, type: p.type, external_id: p.id, from_user_phone: true },
  });

  if (insertedOutbound?.id && mediaUrlOf(p)) {
    admin
      .rpc("emit_event" as never, {
        p_event_type: "media.persist_requested",
        p_entity_kind: "message",
        p_entity_id: insertedOutbound.id,
        p_payload: { message_id: insertedOutbound.id, conversation_id: conversationId },
        p_metadata: { source: "waha_webhook", request_id: requestId },
        p_organization_id: session.organization_id,
      } as never)
      .then(({ error }) => {
        if (error) console.error("[waha.ingest] emit media.persist_requested failed", error.message);
      });
  }
  return null;
}

async function handleAck(admin: Admin, session: Session, p: WahaPayload): Promise<void> {
  if (!p.id) return;
  const ack = p.ack ?? 0;
  const status = ackToStatus(ack);
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { ack, status };
  if (ack >= 2) update.delivered_at = now;
  if (ack >= 3) update.read_at = now;

  // O ack do WAHA 2026.x vem como `{fromMe}_{chatId}_{bareId}`. O NOWEB grava
  // `external_id` = bareId (id interno), o WEBJS grava o `_serialized` completo.
  // Casar as duas formas cobre ambos os engines sem tocar no external_id de
  // inbound (que é full e sustenta o dedup 23505).
  const bare = bareWaMessageId(p.id);
  const candidates = bare === p.id ? [p.id] : [p.id, bare];
  await admin
    .from("messages")
    .update(update)
    .eq("organization_id", session.organization_id)
    .in("external_id", candidates);
}

interface SessionStatusRow extends Session {
  is_warmup_complete: boolean | null;
  warmup_started_at: string | null;
}

async function handleSessionStatus(
  admin: Admin,
  session: SessionStatusRow,
  p: WahaPayload,
): Promise<void> {
  const status = (p.status ?? "").toUpperCase() || null;
  if (!status) return;
  const allowed = new Set(["STARTING", "SCAN_QR_CODE", "WORKING", "STOPPED", "FAILED"]);
  if (!allowed.has(status)) return;
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { status, last_status_change_at: now };
  if (status === "WORKING" && session.warmup_started_at && !session.is_warmup_complete) {
    update.is_warmup_complete = true;
    update.warmup_completed_at = now;
  }
  // Canal removido não tem status para sincronizar. Sem esta guarda, um evento
  // atrasado do WAHA ressuscita a linha arquivada para WORKING — foi o que
  // aconteceu no primeiro número removido em 09/08/2026.
  await admin.from("channel_sessions").update(update).eq("id", session.id).is("archived_at", null);
}

/**
 * Roteador único de eventos WAHA. Os dois route handlers convergem aqui após
 * resolver a sessão e validar HMAC.
 *
 * Devolve o motivo do descarte (`"grupo"`, `"dedupe"`, `"insert_falhou:…"`, …)
 * ou `null` quando o evento foi consumido — o route handler grava isso em
 * `webhook_events_log` para o descarte nunca ser mudo.
 */
export async function dispatchWahaEvent(
  admin: Admin,
  session: SessionStatusRow,
  envelope: WahaEnvelope,
  requestId: string,
): Promise<string | null> {
  const eventType = envelope.event ?? "unknown";
  const payload = envelope.payload ?? {};

  if (eventType === "message" || eventType === "message.any") {
    if (payload.fromMe) {
      return handleOutboundFromUserPhone(admin, session, payload, requestId, envelope.me);
    }
    return handleInbound(admin, session, payload, requestId);
  } else if (eventType === "message.ack") {
    await handleAck(admin, session, payload);
  } else if (eventType === "session.status" || eventType === "state.change") {
    await handleSessionStatus(admin, session, payload);
  }
  return null;
}
