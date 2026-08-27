/**
 * "Em quais conversas essa palavra foi dita?" — o histórico inteiro, não só a
 * última linha.
 *
 * `conversations.last_message_preview` é uma coluna desnormalizada com a ÚLTIMA
 * mensagem, e era só ela que a busca do inbox lia. Na prática isso significava
 * que procurar "orçamento" só achava as conversas em que a palavra por acaso
 * está na mensagem mais recente — 1, nesta base, contra 46 que realmente
 * falaram de orçamento.
 *
 * `media_derived_text` entra junto com `body` porque ÁUDIO NÃO TEM BODY: a
 * transcrição mora naquela coluna, e quem lê só o `body` fica surdo para tudo
 * que o cliente mandou falando.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { padraoBusca } from "@/lib/busca/termo";

/**
 * Teto de mensagens lidas por busca.
 *
 * A varredura é um `~*` sem índice (3 mil mensagens, 2,8 MB, ~60 ms nesta
 * base) e o que volta é uma coluna de uuid — barato hoje, e o teto é o aviso de
 * quando deixar de ser: passando disso, uma conversa antiga que casa pode ficar
 * de fora, e a resposta certa vira índice de texto (`pg_trgm`, já instalado) ou
 * uma RPC, não um teto maior.
 */
export const TETO_DE_MENSAGENS = 2000;

/**
 * Teto de conversas devolvidas. Mesmo orçamento de URL do TETO_DE_CONTATOS —
 * as duas listas viajam juntas no `.or()` do inbox.
 *
 * Quando o teto morde, o que fica são as conversas MAIS RECENTES: a varredura
 * lê as mensagens em ordem decrescente de data, que é a mesma ordem em que o
 * inbox mostra a lista. Um termo comum ("bom dia" casa com 150 conversas nesta
 * base) devolve, então, o pedaço que o usuário veria primeiro de qualquer
 * jeito — e não um recorte arbitrário.
 *
 * A exceção é a aba FILA, que ordena por quem espera há mais tempo: ali uma
 * conversa antiga pode ficar de fora de uma busca por termo muito comum. É o
 * sinal de que a resposta certa passou a ser índice de texto, não teto maior.
 */
export const TETO_DE_CONVERSAS = 150;

/**
 * Os ids das conversas em que o termo aparece em ALGUMA mensagem.
 *
 * `organizationId: null` só para o inbox de suporte (super-admin), que
 * atravessa tenants de propósito.
 */
export async function conversasComMensagem(
  supabase: SupabaseClient,
  organizationId: string | null,
  termo: string,
  teto = TETO_DE_MENSAGENS,
): Promise<{ ids: string[]; error: string | null }> {
  const padrao = padraoBusca(termo);
  if (!padrao) return { ids: [], error: null };

  let query = supabase
    .from("messages")
    .select("conversation_id")
    .or(`body.imatch.${padrao},media_derived_text.imatch.${padrao}`)
    .order("created_at", { ascending: false })
    .limit(teto);
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) return { ids: [], error: error.message };

  const ids = new Set<string>();
  for (const linha of (data ?? []) as Array<{ conversation_id: string | null }>) {
    if (linha.conversation_id) ids.add(linha.conversation_id);
    if (ids.size >= TETO_DE_CONVERSAS) break;
  }
  return { ids: [...ids], error: null };
}
