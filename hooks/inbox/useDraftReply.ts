"use client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Sugestao } from "@/lib/agent-engine/agent/draft-reply";

export type { Sugestao };

export interface RascunhoDaIa {
  /** Até três, com ângulos diferentes. Escolher o ângulo é a parte que é do vendedor. */
  sugestoes: Sugestao[];
  /** O que o modelo leu para escrever. Vai na tela: sugestão que não se confere não se usa. */
  fontes: string[];
}

/** Rascunho sob demanda gerado pelo agente publicado da org (sem enviar nada). */
export function useDraftReply() {
  return useMutation({
    mutationFn: async (conversationId: string) =>
      apiClient.post<{ data: RascunhoDaIa }>(
        `/api/v1/conversations/${conversationId}/draft-reply`,
        {},
      ),
    onError: showApiError,
  });
}
