"use client";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SaveAudioDialog } from "@/components/inbox/composer/SaveAudioDialog";
import { MusicNote, PaperPlaneTilt, Plus, Trash, UsersThree } from "@/lib/ui/icons";
import {
  savedAudioSrc,
  useAttachSavedAudio,
  useDeleteSavedAudio,
  useSavedAudios,
  type SavedAudio,
} from "@/hooks/inbox/useSavedAudios";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";

interface Props {
  conversationId: string;
  disabled?: boolean;
}

/**
 * Gaveta de áudios prontos: o vendedor grava a fala repetida UMA vez e reenvia
 * quando precisar. Sai como PTT igual ao gravado na hora — o WhatsApp não
 * distingue os dois.
 *
 * A lista só é buscada com a gaveta aberta: o composer monta em toda conversa
 * e a maioria das mensagens é texto.
 */
export function SavedAudioMenu({ conversationId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedAudio | null>(null);
  const list = useSavedAudios(open);
  const attach = useAttachSavedAudio();
  const remove = useDeleteSavedAudio();
  const send = useSendMessage();
  const busy = attach.isPending || send.isPending;

  async function handleSend(audio: SavedAudio) {
    try {
      const media = await attach.mutateAsync({ id: audio.id, conversationId });
      send.mutate(
        {
          conversation_id: conversationId,
          type: "audio",
          media_storage_path: media.storage_path,
          media_mime: media.media_mime,
          media_size_bytes: media.media_size_bytes,
        },
        { onSuccess: () => setOpen(false) },
      );
    } catch {
      // toast já disparado pelo onError do useAttachSavedAudio
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0"
            aria-label="Áudios salvos"
            disabled={disabled}
          >
            <MusicNote size={18} weight="regular" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="max-h-80 w-80 overflow-y-auto p-1">
          {list.isLoading ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Carregando…</p>
          ) : (list.data ?? []).length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum áudio salvo ainda. Grave suas falas que mais repetem.
            </p>
          ) : (
            (list.data ?? []).map((audio) => (
              <div key={audio.id} className="rounded-md px-2 py-2 hover:bg-muted">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium">{audio.title}</span>
                  {audio.owner_user_id === null && (
                    <UsersThree
                      size={14}
                      weight="regular"
                      className="shrink-0 text-muted-foreground"
                      aria-label="Compartilhado com o time"
                    />
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-destructive"
                    aria-label={`Excluir ${audio.title}`}
                    onClick={() => setPendingDelete(audio)}
                  >
                    <Trash size={14} weight="regular" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={`Enviar ${audio.title}`}
                    disabled={busy}
                    onClick={() => void handleSend(audio)}
                  >
                    <PaperPlaneTilt size={14} weight="fill" aria-hidden />
                  </Button>
                </div>
                {/* preload none: abrir a gaveta não baixa todos os áudios. */}
                <audio
                  src={savedAudioSrc(audio.id)}
                  controls
                  preload="none"
                  className="mt-1 h-8 w-full"
                  aria-label={`Ouvir ${audio.title}`}
                />
              </div>
            ))
          )}
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-3 py-2 text-sm hover:bg-muted"
            onClick={() => {
              setOpen(false);
              setRecordOpen(true);
            }}
          >
            <Plus size={16} weight="regular" className="text-primary" aria-hidden />
            Gravar novo áudio
          </button>
        </PopoverContent>
      </Popover>

      {recordOpen && <SaveAudioDialog onClose={() => setRecordOpen(false)} />}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este áudio?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{pendingDelete?.title}&quot; sai da gaveta e não dá para desfazer. Os áudios já
              enviados nas conversas continuam lá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => {
                const target = pendingDelete;
                if (!target) return;
                remove.mutate(target.id, { onSettled: () => setPendingDelete(null) });
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
