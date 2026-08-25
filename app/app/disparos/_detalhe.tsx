"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAcaoNoDisparo,
  useAnexarMidia,
  useAtivarDisparo,
  useDisparo,
} from "@/hooks/disparos/useDisparos";
import { fraseDaPausa, fraseDoPulo } from "@/lib/broadcasts/vocabulario";
import { CaretLeft } from "@/lib/ui/icons";

/** Um número grande com legenda — o quadro do relatório. */
function Quadro({ valor, legenda }: { valor: number; legenda: string }) {
  return (
    <div className="rounded-card border border-border p-3">
      <p className="text-2xl font-semibold tabular-nums text-text">{valor}</p>
      <p className="text-xs text-text-muted">{legenda}</p>
    </div>
  );
}

export function DetalheDoDisparo({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const { data: campanha, isLoading } = useDisparo(id);
  const ativar = useAtivarDisparo();
  const pausar = useAcaoNoDisparo("pause");
  const retomar = useAcaoNoDisparo("resume");
  const cancelar = useAcaoNoDisparo("cancel");
  const anexar = useAnexarMidia();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const [confirmandoAtivar, setConfirmandoAtivar] = useState(false);
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);

  if (isLoading || !campanha) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const r = campanha.relatorio;
  const enviados = r.por_status.sent ?? 0;
  const naFila = (r.por_status.pending ?? 0) + (r.por_status.sending ?? 0);
  const pulados = r.por_status.skipped ?? 0;
  const falhas = r.por_status.failed ?? 0;
  const ehRascunho = campanha.status === "draft";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <CaretLeft size={16} aria-hidden />
          Voltar
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-text">{campanha.name}</h2>
          {campanha.status === "paused" ? (
            <p className="mt-1 text-sm text-warning-fg">{fraseDaPausa(campanha.pause_reason)}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {ehRascunho ? (
            <>
              <input
                ref={inputArquivo}
                type="file"
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Zerar para que escolher o MESMO arquivo de novo dispare o evento.
                  e.target.value = "";
                  if (!file) return;
                  anexar.mutate(
                    { id, file },
                    { onSuccess: () => toast.success("Mídia anexada.") },
                  );
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={anexar.isPending}
                onClick={() => inputArquivo.current?.click()}
              >
                {anexar.isPending
                  ? "Enviando…"
                  : campanha.media_storage_path
                    ? "Trocar mídia"
                    : "Anexar vídeo, áudio ou foto"}
              </Button>
              <Button size="sm" onClick={() => setConfirmandoAtivar(true)}>
                Ativar e começar a mandar
              </Button>
            </>
          ) : null}
          {campanha.status === "running" || campanha.status === "scheduled" ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pausar.isPending}
              onClick={() => pausar.mutate(id, { onSuccess: () => toast.success("Pausada.") })}
            >
              Pausar
            </Button>
          ) : null}
          {campanha.status === "paused" ? (
            <Button
              size="sm"
              disabled={retomar.isPending}
              onClick={() => retomar.mutate(id, { onSuccess: () => toast.success("Retomada.") })}
            >
              Retomar
            </Button>
          ) : null}
          {campanha.status !== "done" && campanha.status !== "cancelled" ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmandoCancelar(true)}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      {campanha.body_template ? (
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">A mensagem</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text">{campanha.body_template}</p>
          {campanha.media_type ? (
            <Badge variant="neutral" className="mt-3">
              {campanha.media_type === "audio"
                ? "Vai junto um áudio"
                : campanha.media_type === "video"
                  ? "Vai junto um vídeo"
                  : "Vai junto uma foto"}
            </Badge>
          ) : null}
        </Card>
      ) : null}

      {ehRascunho ? (
        <Card className="p-4 text-sm text-text-muted">
          Ainda é rascunho — ninguém recebeu nada. Quando você ativar, a fila é montada e as
          mensagens começam a sair, uma a cada 5 segundos.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Quadro valor={enviados} legenda="enviadas" />
            <Quadro valor={r.entregues} legenda="chegaram" />
            <Quadro valor={r.lidos} legenda="foram lidas" />
            <Quadro valor={r.responderam} legenda="responderam" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Quadro valor={naFila} legenda="ainda na fila" />
            <Quadro valor={pulados} legenda="pulados" />
            <Quadro valor={falhas} legenda="não saíram" />
          </div>
        </>
      )}

      {Object.keys(r.por_motivo_de_pulo).length > 0 ? (
        <Card className="flex flex-col gap-1.5 p-4">
          <p className="text-sm font-medium text-text">Por que alguns foram pulados</p>
          {Object.entries(r.por_motivo_de_pulo).map(([motivo, quantos]) => (
            <p key={motivo} className="text-xs text-text-muted">
              <span className="font-medium tabular-nums text-text">{quantos}</span>{" "}
              {fraseDoPulo(motivo)}
            </p>
          ))}
        </Card>
      ) : null}

      {campanha.problemas.length > 0 ? (
        <Card className="flex flex-col gap-1.5 p-4">
          <p className="text-sm font-medium text-text">Quem não recebeu</p>
          <div className="flex flex-col gap-1">
            {campanha.problemas.slice(0, 50).map((p, i) => (
              <p key={i} className="truncate text-xs text-text-muted">
                {p.nome ?? "Sem nome"} — {p.telefone ?? "sem telefone"} —{" "}
                {p.status === "skipped" ? fraseDoPulo(p.motivo) : (p.motivo ?? "falhou")}
              </p>
            ))}
          </div>
        </Card>
      ) : null}

      <AlertDialog open={confirmandoAtivar} onOpenChange={setConfirmandoAtivar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Começar a mandar?</AlertDialogTitle>
            <AlertDialogDescription>
              A partir daqui as mensagens saem pelo seu WhatsApp, uma a cada 5 segundos, dentro do
              horário comercial. Dá para pausar a qualquer momento — mas o que já saiu não volta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ainda não</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                ativar.mutate(
                  { id },
                  {
                    onSuccess: (res) => {
                      setConfirmandoAtivar(false);
                      toast.success(
                        `Começou: ${res.aptos} vão receber${res.pulados > 0 ? `, ${res.pulados} pulados` : ""}.`,
                      );
                    },
                  },
                );
              }}
            >
              {ativar.isPending ? "Ativando…" : "Pode mandar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmandoCancelar} onOpenChange={setConfirmandoCancelar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem ainda não recebeu sai da fila e não recebe mais. Quem já recebeu continua no
              relatório. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Deixar como está</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                cancelar.mutate(id, {
                  onSuccess: () => {
                    setConfirmandoCancelar(false);
                    toast.success("Campanha cancelada.");
                  },
                });
              }}
            >
              {cancelar.isPending ? "Cancelando…" : "Cancelar campanha"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
