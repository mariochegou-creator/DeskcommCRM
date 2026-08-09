"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Microphone, Trash } from "@/lib/ui/icons";
import { useAudioRecording, type AudioTake } from "@/hooks/inbox/useAudioRecording";
import { useCreateSavedAudio } from "@/hooks/inbox/useSavedAudios";
import { usePermission } from "@/hooks/auth/AuthProvider";

interface Props {
  onClose: () => void;
}

/**
 * Grava um áudio e guarda na gaveta. O take fica em memória até salvar: o
 * vendedor OUVE antes (é o mesmo áudio que o cliente vai receber, dezenas de
 * vezes) e pode regravar sem custo — nada sobe pro servidor até o "Salvar".
 *
 * Montado só enquanto aberto (quem controla é o SavedAudioMenu): desmontar
 * fecha o microfone pelo cleanup do useAudioRecording e zera o rascunho.
 */
export function SaveAudioDialog({ onClose }: Props) {
  const [take, setTake] = useState<AudioTake | null>(null);
  const [title, setTitle] = useState("");
  const [shared, setShared] = useState(false);
  const canShare = usePermission("inbox.saved_audio.share");
  const create = useCreateSavedAudio();
  const rec = useAudioRecording(useCallback((t: AudioTake) => setTake(t), []));

  const previewUrl = useMemo(() => (take ? URL.createObjectURL(take.blob) : null), [take]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  async function handleSave() {
    if (!take || !title.trim()) return;
    try {
      await create.mutateAsync({
        blob: take.blob,
        filename: take.filename,
        title: title.trim(),
        shared: shared && canShare,
        durationSeconds: take.seconds,
      });
      onClose();
    } catch {
      // toast já disparado pelo onError; o dialog fica aberto pra tentar de novo
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gravar áudio para guardar</DialogTitle>
        </DialogHeader>

        {!take ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/40 py-6">
            {rec.recording ? (
              <>
                <span className="flex items-center gap-2 text-lg tabular-nums text-destructive">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
                  {rec.elapsedLabel}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={rec.cancel} aria-label="Cancelar gravação">
                    Cancelar
                  </Button>
                  <Button onClick={rec.finish}>Parar</Button>
                </div>
              </>
            ) : (
              <>
                <Button size="icon" className="h-12 w-12" onClick={rec.start} aria-label="Gravar áudio">
                  <Microphone size={22} weight="fill" aria-hidden />
                </Button>
                <p className="text-xs text-muted-foreground">Toque no microfone e fale.</p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {previewUrl && (
              <audio src={previewUrl} controls className="w-full" aria-label="Ouvir a gravação" />
            )}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome do áudio (ex.: abertura)"
              aria-label="Nome do áudio"
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim() && !create.isPending) void handleSave();
              }}
            />
            {canShare && (
              <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  Compartilhar com o time
                  <span className="block text-xs text-muted-foreground">
                    Desligado, o áudio fica só na sua gaveta.
                  </span>
                </span>
                <Switch checked={shared} onCheckedChange={setShared} aria-label="Compartilhar com o time" />
              </label>
            )}
            <Button
              variant="ghost"
              className="self-start text-destructive"
              onClick={() => setTake(null)}
              disabled={create.isPending}
            >
              <Trash size={16} weight="regular" aria-hidden className="mr-1.5" />
              Regravar
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSave()} disabled={!take || !title.trim() || create.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
