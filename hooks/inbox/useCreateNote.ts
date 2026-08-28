"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Note } from "@/lib/types/messaging";

interface CreateNoteArgs {
  conversation_id: string;
  body: string;
  /** Ids citados com @ (0110). A rota confere cada um contra a org antes de gravar. */
  mentions?: string[];
}

export function useCreateNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversation_id, body, mentions }: CreateNoteArgs) =>
      apiClient.post<{ data: Note }>(`/api/v1/conversations/${conversation_id}/notes`, {
        body,
        mentions,
      }),
    onSuccess: (_res, args) => {
      qc.invalidateQueries({ queryKey: ["notes", args.conversation_id] });
    },
    onError: showApiError,
  });
}
