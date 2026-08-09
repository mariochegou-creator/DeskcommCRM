"use client";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Microphone, PaperPlaneTilt, Trash } from "@/lib/ui/icons";
import { useAudioRecording, type AudioTake } from "@/hooks/inbox/useAudioRecording";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { useUploadMedia } from "@/hooks/inbox/useUploadMedia";

interface Props {
  conversationId: string;
  disabled?: boolean;
}

/** Gravação de voz estilo WhatsApp: mic → timer + cancelar/enviar → PTT. */
export function AudioRecorder({ conversationId, disabled }: Props) {
  const upload = useUploadMedia();
  const send = useSendMessage();

  const onTake = useCallback(
    (take: AudioTake) => {
      void upload
        .mutateAsync({ conversationId, file: take.blob, filename: take.filename })
        .then((uploaded) =>
          send.mutate(
            {
              conversation_id: conversationId,
              type: "audio",
              media_storage_path: uploaded.storage_path,
              media_mime: uploaded.media_mime,
              media_size_bytes: uploaded.media_size_bytes,
            },
            {},
          ),
        )
        .catch(() => {
          // toast já disparado pelo onError de useUploadMedia
        });
    },
    [conversationId, send, upload],
  );

  const rec = useAudioRecording(onTake);

  if (!rec.recording) {
    return (
      <Button
        type="button"
        size="icon"
        className="h-9 w-9 shrink-0"
        aria-label="Gravar áudio"
        onClick={rec.start}
        disabled={disabled}
      >
        <Microphone size={16} weight="fill" aria-hidden />
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-9 w-9 shrink-0 text-destructive"
        aria-label="Cancelar gravação"
        onClick={rec.cancel}
      >
        <Trash size={16} weight="regular" aria-hidden />
      </Button>
      <span className="flex items-center gap-1.5 text-sm tabular-nums text-destructive">
        <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden />
        {rec.elapsedLabel}
      </span>
      <Button
        type="button"
        size="icon"
        className="h-9 w-9 shrink-0"
        aria-label="Enviar áudio"
        onClick={rec.finish}
      >
        <PaperPlaneTilt size={16} weight="fill" aria-hidden />
      </Button>
    </div>
  );
}
