"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { ApiError, type ApiErrorBody } from "@/lib/api/types";
import type { UploadedMedia } from "@/hooks/inbox/useUploadMedia";

export interface SavedAudio {
  id: string;
  title: string;
  media_mime: string;
  media_size_bytes: number;
  duration_seconds: number | null;
  /** null = compartilhado da org; preenchido = pessoal de quem gravou. */
  owner_user_id: string | null;
}

const KEY = ["saved-audios"];

/** Gaveta de áudios prontos do composer (pessoais + compartilhados). */
export function useSavedAudios(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => apiClient.get<{ data: SavedAudio[] }>("/api/v1/saved-audios"),
    staleTime: 60_000,
    enabled,
    select: (res) => res.data,
  });
}

/** URL tocável do áudio salvo (302 → signed URL); serve de src do <audio>. */
export function savedAudioSrc(id: string): string {
  return `/api/v1/saved-audios/${id}/audio`;
}

export function useCreateSavedAudio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      blob: Blob;
      filename: string;
      title: string;
      shared: boolean;
      durationSeconds?: number;
    }) => {
      // multipart: o apiClient serializa JSON, então este vai de fetch direto
      // (mesmo padrão do useUploadMedia).
      const form = new FormData();
      form.append("file", args.blob, args.filename);
      form.append("title", args.title);
      form.append("shared", args.shared ? "true" : "false");
      if (args.durationSeconds != null) form.append("duration_seconds", String(args.durationSeconds));
      const res = await fetch("/api/v1/saved-audios", { method: "POST", body: form });
      const json = (await res.json()) as Partial<ApiErrorBody> & { data?: SavedAudio };
      if (!res.ok || !json.data) {
        const e = json.error;
        throw new ApiError(res.status, e?.code ?? "save_failed", e?.details, e?.request_id ?? "", e?.message);
      }
      return json.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => showApiError(err),
  });
}

export function useDeleteSavedAudio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete<void>(`/api/v1/saved-audios/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => showApiError(err),
  });
}

/**
 * Cola uma cópia do áudio salvo dentro da conversa e devolve o shape do upload —
 * daí o envio segue pelo useSendMessage de sempre.
 */
export function useAttachSavedAudio() {
  return useMutation({
    mutationFn: async (args: { id: string; conversationId: string }) => {
      const res = await apiClient.post<{ data: UploadedMedia }>(`/api/v1/saved-audios/${args.id}/attach`, {
        conversation_id: args.conversationId,
      });
      return res.data;
    },
    onError: (err) => showApiError(err),
  });
}
