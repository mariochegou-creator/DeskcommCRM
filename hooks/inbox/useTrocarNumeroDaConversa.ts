"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface TrocaArgs {
  conversation_id: string;
  channel_session_id: string;
}

interface TrocaResposta {
  /** Onde continuar a conversa: a mesma, ou a que já existia no número novo. */
  conversation_id: string;
  trocou: boolean;
  ja_existia?: boolean;
}

/**
 * Troca o número de WhatsApp por onde a conversa fala.
 *
 * O retorno pode apontar para OUTRA conversa: quando o contato já tinha
 * conversa no número escolhido, ela é a conversa daquele número (a unique do
 * banco garante isso), e quem chama deve abrir a que voltou — em vez de
 * insistir numa troca que não existe.
 */
export function useTrocarNumeroDaConversa() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: TrocaArgs) => {
      const res = await apiClient.patch<{ data: TrocaResposta }>(
        `/api/v1/conversations/${args.conversation_id}/channel-session`,
        { channel_session_id: args.channel_session_id },
      );
      return res.data;
    },
    onError: showApiError,
    onSuccess: (data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      if (data.ja_existia) {
        toast.info("Este lead já tinha conversa nesse número — abrindo ela.");
      } else if (data.trocou) {
        toast.success("Número trocado. As próximas mensagens saem por ele.");
      }
    },
  });
}
