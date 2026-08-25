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
  /**
   * Foto escolhida do computador (0109). Preenchido → o dialog pula o
   * microfone e vira "guardar esta foto": mesma tela de nome/compartilhar,
   * outra fonte. Vazio → grava áudio, como sempre.
   */
  file?: File;
  onClose: () => void;
}

/**
 * Guarda na gaveta o que se repete: um áudio gravado aqui, ou a foto que veio
 * de fora. Nada sobe pro servidor até o "Salvar" — o vendedor confere antes (é
 * o mesmo arquivo que dezenas de clientes vão receber) e pode trocar sem custo.
 *
 * Montado só enquanto aberto (quem controla é o SavedAudioMenu): desmontar
 * fecha o microfone pelo cleanup do useAudioRecording e zera o rascunho.
 */
export function SaveAudioDialog({ file, onClose }: Props) {
  const [take, setTake] = useState<AudioTake | null>(null);
  // Nome do arquivo sem a extensão: o print já chega com um nome, e digitar de
  // novo o que o Windows escreveu é trabalho à toa. Editável, e o maxLength 80
  // do Input espelha o schema.
  const [title, setTitle] = useState(() => (file ? file.name.replace(/\.[^.]+$/, "").slice(0, 80) : ""));
  const [shared, setShared] = useState(false);
  const canShare = usePermission("inbox.saved_audio.share");
  const create = useCreateSavedAudio();
  // Hook sempre chamado (regra de hooks); com `file` ninguém aperta start, então
  // o microfone nunca abre.
  const rec = useAudioRecording(useCallback((t: AudioTake) => setTake(t), []));

  const sourceBlob: Blob | null = file ?? take?.blob ?? null;
  const previewUrl = useMemo(() => (sourceBlob ? URL.createObjectURL(sourceBlob) : null), [sourceBlob]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  async function handleSave() {
    if (!sourceBlob || !title.trim()) return;
    try {
      await create.mutateAsync({
        blob: sourceBlob,
        filename: file ? file.name : (take?.filename ?? "audio.ogg"),
        title: title.trim(),
        shared: shared && canShare,
        durationSeconds: take?.seconds,
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
          <DialogTitle>{file ? "Guardar esta foto" : "Gravar áudio para guardar"}</DialogTitle>
        </DialogHeader>

        {!sourceBlob ? (
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
            {previewUrl &&
              (file ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob: local, sem loader do next/image
                <img
                  src={previewUrl}
                  alt="Foto escolhida"
                  className="max-h-56 w-full rounded-md bg-muted object-contain"
                />
              ) : (
                <audio src={previewUrl} controls className="w-full" aria-label="Ouvir a gravação" />
              ))}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={file ? "Nome da foto (ex.: pesquisa do Google)" : "Nome do áudio (ex.: abertura)"}
              aria-label={file ? "Nome da foto" : "Nome do áudio"}
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
                    Desligado, {file ? "a foto fica" : "o áudio fica"} só na sua gaveta.
                  </span>
                </span>
                <Switch checked={shared} onCheckedChange={setShared} aria-label="Compartilhar com o time" />
              </label>
            )}
            {/* Foto não tem "regravar": pra trocar, fecha e escolhe outra. */}
            {!file && (
              <Button
                variant="ghost"
                className="self-start text-destructive"
                onClick={() => setTake(null)}
                disabled={create.isPending}
              >
                <Trash size={16} weight="regular" aria-hidden className="mr-1.5" />
                Regravar
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSave()} disabled={!sourceBlob || !title.trim() || create.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
