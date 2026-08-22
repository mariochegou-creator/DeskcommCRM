"use client";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Message } from "@/lib/types/messaging";

interface SendArgs {
  conversation_id: string;
  body?: string;
  media_url?: string;
  media_mime?: string;
  media_storage_path?: string;
  media_size_bytes?: number;
  type?: string;
}

interface MessagesPage {
  data: Message[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export function useSendMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: SendArgs) =>
      apiClient.post<{ data: Message }>("/api/v1/messages", input, {
        // O POST só responde depois que o WAHA terminou de subir o arquivo pro
        // WhatsApp (envio síncrono, ver app/api/v1/messages/_handler.ts). Um
        // vídeo de alguns MB passa fácil dos 10s do padrão — e o timeout aqui
        // deixava o dialog de anexo travado em "enviando" mesmo com a mensagem
        // já entregue.
        ...(input.media_storage_path || input.media_url ? { timeoutMs: 180_000 } : {}),
      }),
    onMutate: async (args) => {
      if (args.media_storage_path || args.media_url) return {};

      const queryKey = ["messages", args.conversation_id];
      await qc.cancelQueries({ queryKey });

      const tempId = `temp-${Date.now()}`;
      const tempMsg: Message = {
        id: tempId,
        organization_id: "",
        conversation_id: args.conversation_id,
        channel_session_id: "",
        contact_id: "",
        external_id: null,
        type: args.type ?? "text",
        direction: "outbound",
        status: "queued",
        ack: null,
        error_code: null,
        error_message: null,
        body: args.body ?? null,
        media_url: args.media_url ?? null,
        media_mime: args.media_mime ?? null,
        media_size_bytes: null,
        media_storage_path: null,
        // Eco otimista de mensagem de TEXTO (mídia sai deste caminho na linha
        // 36), então não há mídia para derivar — e mesmo que houvesse, o
        // derivado nasce no servidor segundos depois.
        media_derived_text: null,
        media_derived_status: null,
        sent_via: "user",
        sent_by_user_id: null,
        sent_at: new Date().toISOString(),
        delivered_at: null,
        read_at: null,
        metadata: { _optimistic: true },
        created_at: new Date().toISOString(),
      };

      // A página 0 é a janela MAIS RECENTE da conversa (ver listMessagesHandler),
      // e dentro dela as mensagens vêm em ordem cronológica — então o rascunho
      // otimista entra no fim dela, não no fim da última página (que é a mais
      // antiga carregada).
      qc.setQueryData<InfiniteData<MessagesPage>>(queryKey, (old) => {
        if (!old || old.pages.length === 0) return old;
        const pages = [...old.pages];
        const recente = pages[0]!;
        pages[0] = { ...recente, data: [...recente.data, tempMsg] };
        return { ...old, pages };
      });

      return { tempId };
    },
    onError: (err, args) => {
      qc.invalidateQueries({ queryKey: ["messages", args.conversation_id] });
      showApiError(err);
    },
    onSettled: (_data, _err, args) => {
      qc.invalidateQueries({ queryKey: ["messages", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
