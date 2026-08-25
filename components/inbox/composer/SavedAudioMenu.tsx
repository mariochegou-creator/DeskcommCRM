"use client";
import { useRef, useState } from "react";

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
import { ImageSquare, MusicNote, PaperPlaneTilt, Plus, Trash, UsersThree } from "@/lib/ui/icons";
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
  /**
   * O texto que está escrito no composer. Vai como LEGENDA da foto, numa
   * mensagem só — é assim que o print da pesquisa chega com a frase que o
   * explica. Áudio ignora: PTT no WhatsApp não tem legenda.
   */
  caption?: string;
  /** Chamado depois que a legenda foi usada, pra o composer limpar o texto. */
  onSent?: () => void;
}

const isPhoto = (item: SavedAudio) => item.media_mime.startsWith("image/");

/**
 * Gaveta do que se repete: o vendedor grava a fala UMA vez e reenvia quando
 * precisar (sai como PTT, igual ao gravado na hora — o WhatsApp não distingue),
 * e guarda a foto que manda sempre, como o print da pesquisa do Google (0109).
 *
 * A lista só é buscada com a gaveta aberta: o composer monta em toda conversa
 * e a maioria das mensagens é texto.
 */
export function SavedAudioMenu({ conversationId, disabled, caption, onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedAudio | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const list = useSavedAudios(open);
  const attach = useAttachSavedAudio();
  const remove = useDeleteSavedAudio();
  const send = useSendMessage();
  const busy = attach.isPending || send.isPending;

  async function handleSend(item: SavedAudio) {
    try {
      const media = await attach.mutateAsync({ id: item.id, conversationId });
      // `media.kind` vem do attach (derivado do mime), não daqui: quem manda no
      // type da mensagem é o backend que copiou o arquivo.
      const legenda = media.kind === "image" ? (caption ?? "").trim() : "";
      send.mutate(
        {
          conversation_id: conversationId,
          type: media.kind,
          ...(legenda ? { body: legenda } : {}),
          media_storage_path: media.storage_path,
          media_mime: media.media_mime,
          media_size_bytes: media.media_size_bytes,
        },
        {
          onSuccess: () => {
            setOpen(false);
            // Só limpa o composer se o texto REALMENTE virou legenda; senão o
            // vendedor perderia o que digitou ao mandar um áudio salvo.
            if (legenda) onSent?.();
          },
        },
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
            aria-label="Áudios e fotos salvos"
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
              Nada salvo ainda. Guarde as falas que você repete e as fotos que você manda sempre.
            </p>
          ) : (
            (list.data ?? []).map((item) => (
              <div key={item.id} className="rounded-md px-2 py-2 hover:bg-muted">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium">{item.title}</span>
                  {item.owner_user_id === null && (
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
                    aria-label={`Excluir ${item.title}`}
                    onClick={() => setPendingDelete(item)}
                  >
                    <Trash size={14} weight="regular" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={`Enviar ${item.title}`}
                    disabled={busy}
                    onClick={() => void handleSend(item)}
                  >
                    <PaperPlaneTilt size={14} weight="fill" aria-hidden />
                  </Button>
                </div>
                {isPhoto(item) ? (
                  // A miniatura é o que faz escolher o print certo — sem ela a
                  // gaveta vira uma lista de nomes parecidos.
                  // eslint-disable-next-line @next/next/no-img-element -- rota própria (302 → signed URL), sem loader do next/image
                  <img
                    src={savedAudioSrc(item.id)}
                    alt={item.title}
                    loading="lazy"
                    className="mt-1 max-h-32 w-full rounded bg-muted object-contain"
                  />
                ) : (
                  /* preload none: abrir a gaveta não baixa todos os áudios. */
                  <audio
                    src={savedAudioSrc(item.id)}
                    controls
                    preload="none"
                    className="mt-1 h-8 w-full"
                    aria-label={`Ouvir ${item.title}`}
                  />
                )}
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
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
            onClick={() => photoRef.current?.click()}
          >
            <ImageSquare size={16} weight="regular" className="text-primary" aria-hidden />
            Guardar uma foto
          </button>
        </PopoverContent>
      </Popover>

      {/* Fora do Popover: fechar a gaveta desmontaria o input no meio do clique. */}
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          e.target.value = ""; // escolher a MESMA foto de novo tem que disparar onChange
          if (!picked) return;
          setOpen(false);
          setPhotoFile(picked);
        }}
      />

      {(recordOpen || photoFile) && (
        <SaveAudioDialog
          file={photoFile ?? undefined}
          onClose={() => {
            setRecordOpen(false);
            setPhotoFile(null);
          }}
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete && isPhoto(pendingDelete) ? "Excluir esta foto?" : "Excluir este áudio?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{pendingDelete?.title}&quot; sai da gaveta e não dá para desfazer. O que já foi
              enviado nas conversas continua lá.
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
