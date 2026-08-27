/**
 * Core handlers para /api/v1/conversations.
 *
 * Reusados pelo Route Handler REST e por MCP tools (S-13.03/04).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import { contatosQueCasam } from "@/lib/busca/contatos";
import { conversasComMensagem } from "@/lib/busca/conversas";
import { padraoBusca } from "@/lib/busca/termo";
import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import type {
  ListConversationsQuery,
  PatchConversationInput,
} from "@/lib/schemas";
import type { Conversation } from "@/lib/types/messaging";

type SB = SupabaseClient;

const BASE_COLS = `
  id, organization_id, contact_id, channel_session_id, channel, status,
  status_changed_at, assigned_to_user_id, assignee_kind, assigned_at, last_inbound_at,
  last_outbound_at, last_message_at, last_message_preview,
  unread_count_for_assignee, is_group, group_chat_id, tags, metadata,
  snooze_until, created_at, updated_at
`;

const CONTACT_COLS = "id, display_name, name, phone_number, is_anonymized, tags, is_blocked";

/**
 * O mesmo SELECT, com ou sem o negócio do Kanban costurado junto.
 *
 * Filtrar por etapa é a pergunta "quem já está em R1 marcada?" — e a conversa
 * não tem etapa: quem tem é o negócio, ligado à conversa pelo CONTATO. Com
 * `!inner` nos dois níveis o recorte acontece no banco e o cursor continua
 * valendo. A alternativa (ler os contatos da etapa e mandar `in.(...)`) põe a
 * lista inteira de uuids na URL — 260 leads de uma importação já chegam perto
 * do teto de 16 KB do cliente HTTP, e o que passar do teto sai como resultado
 * a menos, calado.
 *
 * O `crm_leads` embutido é subproduto do join, não contrato: sai da resposta
 * antes de devolver (ver `listConversationsHandler`).
 */
function selectCols(comEtapa: boolean): string {
  return comEtapa
    ? `${BASE_COLS}, contacts:contact_id!inner (${CONTACT_COLS}, crm_leads!inner (stage_id))`
    : `${BASE_COLS}, contacts:contact_id (${CONTACT_COLS})`;
}

const SELECT_COLS = selectCols(false);

interface CursorPayload {
  sort: string | null;
  id: string;
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}
function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as CursorPayload & { last_message_at?: string | null };
    if (typeof parsed.id !== "string") return null;
    // `last_message_at` é o nome legado do campo de ordenação (cursores em voo
    // durante deploy); `sort` é o genérico atual (default OU fila).
    const sort = parsed.sort ?? parsed.last_message_at ?? null;
    return { sort, id: parsed.id };
  } catch {
    return null;
  }
}

function actorAuditPayload(actor: Actor): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  if (actor.type === "user") {
    return { actorUserId: actor.id, metadataActor: { actor_type: "user" } };
  }
  return {
    actorUserId: null,
    metadataActor: {
      actor_type: actor.type,
      actor_id: actor.id,
      ...(actor.type === "ai_agent" && actor.api_token_id
        ? { actor_api_token_id: actor.api_token_id }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export interface ListConversationsResult {
  conversations: Conversation[];
  cursor: string | null;
  has_more: boolean;
}

export async function listConversationsHandler(
  supabase: SB,
  ctx: HandlerCtx,
  q: ListConversationsQuery,
): Promise<ListConversationsResult> {
  // Fila (assigned_to=unassigned): ordena por TEMPO DE ESPERA — quem espera há
  // mais tempo primeiro. `last_inbound_at` = última mensagem do cliente = "há
  // quanto tempo aguarda resposta" (não `created_at`, que pode ser uma conversa
  // antiga reaberta). Demais visões: por atividade recente (last_message_at desc).
  const isQueue = q.assigned_to === "unassigned";
  const sortCol = isQueue ? "last_inbound_at" : "last_message_at";
  const asc = isQueue;

  let query = supabase
    .from("conversations")
    .select(selectCols(!!q.stage_id))
    .eq("organization_id", ctx.organization_id)
    .order(sortCol, { ascending: asc, nullsFirst: false })
    .order("id", { ascending: asc })
    .limit(q.limit + 1);

  if (q.status) query = query.eq("status", q.status);
  if (q.channel_session_id) query = query.eq("channel_session_id", q.channel_session_id);
  if (q.contact_id) query = query.eq("contact_id", q.contact_id);
  // O caminho é o do embed: alias do contato → tabela do negócio → coluna.
  if (q.stage_id) query = query.eq("contacts.crm_leads.stage_id", q.stage_id);
  if (q.tag) query = query.contains("tags", [q.tag]); // tags @> array[tag] (GIN)

  if (q.assigned_to === "me") {
    if (ctx.actor.type !== "user") {
      throw new ApiError(
        400,
        "invalid_request",
        undefined,
        ctx.requestId,
        '"assigned_to=me" requer ator humano.',
      );
    }
    query = query.eq("assigned_to_user_id", ctx.actor.id);
  } else if (q.assigned_to === "unassigned") {
    query = query.is("assigned_to_user_id", null);
  } else if (q.assigned_to) {
    query = query.eq("assigned_to_user_id", q.assigned_to);
  }

  if (q.search) {
    // A busca do inbox responde "onde está o Sérgio?" e "onde falamos de
    // orçamento?" — não só "qual foi a última linha?".
    //
    // Antes olhava SÓ `last_message_preview`, e isso errava de duas formas:
    // o nome da pessoa mora em `contacts.display_name` ("Sérgio Martins",
    // nunca na mensagem), e a coluna guarda apenas a ÚLTIMA linha — uma
    // palavra dita cinco mensagens atrás não existia para a busca.
    //
    // Agora são três caminhos num OU: a última mensagem (de graça, coluna da
    // própria linha) OU o CONTATO OU qualquer mensagem do HISTÓRICO. Os dois
    // últimos são resolvidos em ids ANTES porque o `or` do PostgREST não
    // atravessa tabela embutida — ver lib/busca/contatos.ts e conversas.ts.
    //
    // `imatch` (`~*`) no lugar de `ilike`: o padrão já chega com as famílias
    // de acento, então "sergio" acha "Sérgio" — ver lib/busca/termo.ts.
    const padrao = padraoBusca(q.search);
    if (padrao) {
      const [contatos, mensagens] = await Promise.all([
        contatosQueCasam(supabase, ctx.organization_id, q.search),
        conversasComMensagem(supabase, ctx.organization_id, q.search),
      ]);
      const falha = contatos.error ?? mensagens.error;
      if (falha) {
        throw new ApiError(500, "internal_error", undefined, ctx.requestId, falha);
      }
      const alvos = [`last_message_preview.imatch.${padrao}`];
      if (contatos.ids.length > 0) {
        alvos.push(`contact_id.in.(${contatos.ids.join(",")})`);
      }
      if (mensagens.ids.length > 0) {
        alvos.push(`id.in.(${mensagens.ids.join(",")})`);
      }
      query = query.or(alvos.join(","));
    }
  }

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    if (!c) {
      throw new ApiError(400, "invalid_cursor", undefined, ctx.requestId, "Cursor inválido.");
    }
    const op = asc ? "gt" : "lt";
    if (c.sort) {
      // `.is.null` no OR: NULLS LAST vale nas duas ordenações, então a partir
      // de qualquer cursor não-nulo TODAS as linhas NULL ainda estão à frente.
      // Sem esse braço, comparação com NULL é sempre falsa e conversa sem
      // last_inbound_at (criada só por envio nosso) ficava inalcançável
      // depois da página 1.
      query = query.or(
        `${sortCol}.${op}.${c.sort},and(${sortCol}.eq.${c.sort},id.${op}.${c.id}),${sortCol}.is.null`,
      );
    } else {
      // Página já na região de sort NULL (nulls last): pagina só por id.
      query = query.is(sortCol, null);
      query = asc ? query.gt("id", c.id) : query.lt("id", c.id);
    }
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }

  const rows = (data ?? []) as unknown as Conversation[];
  if (q.stage_id) {
    // O join fez seu trabalho; o `crm_leads` pendurado no contato só faria a
    // resposta mudar de forma conforme o filtro em uso.
    for (const row of rows) {
      const contato = (row as { contacts?: Record<string, unknown> | null }).contacts;
      if (contato) delete contato.crm_leads;
    }
  }
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const cursor =
    hasMore && last
      ? encodeCursor({ sort: (last[sortCol] as string | null) ?? null, id: last.id })
      : null;

  return { conversations: page, cursor, has_more: hasMore };
}

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

export async function getConversationHandler(
  supabase: SB,
  ctx: HandlerCtx,
  conversationId: string,
): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .select(SELECT_COLS)
    .eq("id", conversationId)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }
  if (!data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Conversa não encontrada.");
  }
  return data as unknown as Conversation;
}

// ---------------------------------------------------------------------------
// update status (claim/close/release)
// ---------------------------------------------------------------------------

export async function patchConversationHandler(
  supabase: SB,
  ctx: HandlerCtx,
  conversationId: string,
  input: PatchConversationInput,
): Promise<Conversation> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};

  if (input.status !== undefined) {
    update.status = input.status;
    update.status_changed_at = now;
    // Atalho: status='claimed' assume o atendimento se ator for usuário humano.
    if (input.status === "claimed" && ctx.actor.type === "user") {
      update.assigned_to_user_id = ctx.actor.id;
      update.assigned_at = now;
    }
  }
  if (input.tags !== undefined) {
    update.tags = input.tags;
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", conversationId)
    .eq("organization_id", ctx.organization_id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }
  if (!data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Conversa não encontrada.");
  }

  const conv = data as unknown as Conversation;
  const a = actorAuditPayload(ctx.actor);

  if (input.status !== undefined) {
    const action =
      input.status === "claimed"
        ? "conversation.claimed"
        : input.status === "closed"
          ? "conversation.closed"
          : "conversation.released";
    await audit({
      action,
      actorUserId: a.actorUserId,
      organizationId: conv.organization_id,
      resourceType: "conversation",
      resourceId: conv.id,
      requestId: ctx.requestId,
      metadata: { ...a.metadataActor, status: input.status },
    });
  }
  if (input.tags !== undefined) {
    await audit({
      action: "conversation.tags_changed",
      actorUserId: a.actorUserId,
      organizationId: conv.organization_id,
      resourceType: "conversation",
      resourceId: conv.id,
      requestId: ctx.requestId,
      metadata: { ...a.metadataActor, tags: input.tags },
    });
  }

  return conv;
}
