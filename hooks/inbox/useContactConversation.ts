"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { ConversationWithContact } from "./useConversationsRealtime";

/**
 * A conversa mais recente deste contato, ou `null` se ele nunca escreveu.
 *
 * `null` é resposta LEGÍTIMA, não erro: no CRM toda conversa nasce de uma
 * mensagem que o lead manda, então um lead de prospecção importado não tem
 * nenhuma até responder pela primeira vez. Quem chama usa essa distinção para
 * escolher o destino do botão — inbox quando a conversa existe, WhatsApp quando
 * ainda não existe.
 *
 * Sem `retry`: a ausência de conversa vem como lista vazia (HTTP 200), não como
 * 404, então não há falha para re-tentar.
 */
export function useContactConversation(contactId: string | null) {
  return useQuery({
    queryKey: ["contact-conversation", contactId],
    enabled: !!contactId,
    queryFn: () =>
      apiClient
        .get<{ data: ConversationWithContact[] }>(
          `/api/v1/conversations?contact_id=${contactId}&limit=1`,
        )
        .then((r) => r.data[0] ?? null),
  });
}
