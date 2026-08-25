"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAcaoNoDisparo,
  useDisparos,
  estaViva,
  type Campanha,
} from "@/hooks/disparos/useDisparos";
import { fraseDaPausa } from "@/lib/broadcasts/vocabulario";
import type { StatusDeCampanha } from "@/lib/broadcasts/vocabulario";
import { PaperPlaneTilt, Plus } from "@/lib/ui/icons";

import { NovoDisparoDialog } from "./_novo";
import { DetalheDoDisparo } from "./_detalhe";

/**
 * Rótulo e cor por estado. Em português de operação, não do banco: quem lê a
 * tela quer saber se está mandando, não o valor do enum.
 */
type VarianteDeBadge = "default" | "neutral" | "success" | "warning" | "error" | "info";

const ROTULO: Record<StatusDeCampanha, { texto: string; variant: VarianteDeBadge }> = {
  draft: { texto: "Rascunho", variant: "neutral" },
  scheduled: { texto: "Agendado", variant: "info" },
  running: { texto: "Mandando", variant: "default" },
  paused: { texto: "Pausado", variant: "warning" },
  done: { texto: "Concluído", variant: "success" },
  cancelled: { texto: "Cancelado", variant: "neutral" },
};

function somaDoPlacar(c: Campanha): { enviados: number; total: number; falhas: number } {
  const p = c.placar ?? {};
  const enviados = p.sent ?? 0;
  const falhas = p.failed ?? 0;
  const total =
    (p.pending ?? 0) + (p.sending ?? 0) + enviados + falhas + (p.skipped ?? 0) + (p.cancelled ?? 0);
  return { enviados, total, falhas };
}

/**
 * Barra de progresso da campanha. Sem componente próprio no design system — é
 * uma div com largura em porcentagem, e inventar um componente novo para uma
 * régua usada em um lugar só seria a peça a mais que o repo evita.
 */
function Progresso({ enviados, total }: { enviados: number; total: number }) {
  const pct = total > 0 ? Math.round((enviados / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-32 overflow-hidden rounded-pill bg-surface-elevated">
        <div className="h-full rounded-pill bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-text-muted">
        {enviados}/{total}
      </span>
    </div>
  );
}

function LinhaDaCampanha({ campanha, onAbrir }: { campanha: Campanha; onAbrir: () => void }) {
  const pausar = useAcaoNoDisparo("pause");
  const retomar = useAcaoNoDisparo("resume");
  const { enviados, total, falhas } = somaDoPlacar(campanha);
  const rotulo = ROTULO[campanha.status];

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{campanha.name}</span>
          <Badge variant={rotulo.variant}>{rotulo.texto}</Badge>
          {campanha.media_type ? (
            <Badge variant="neutral">
              {campanha.media_type === "audio" ? "Áudio" : campanha.media_type === "video" ? "Vídeo" : "Foto"}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs text-text-muted">
          {campanha.status === "paused" && campanha.pause_reason
            ? fraseDaPausa(campanha.pause_reason)
            : (campanha.body_template ?? "Só mídia, sem texto.")}
        </p>
        {falhas > 0 ? (
          <p className="mt-1 text-xs text-error-fg">{falhas} não conseguiram sair — abra para ver.</p>
        ) : null}
      </button>

      <div className="flex shrink-0 items-center gap-3">
        {total > 0 ? <Progresso enviados={enviados} total={total} /> : null}
        {campanha.status === "running" || campanha.status === "scheduled" ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={pausar.isPending}
            onClick={() =>
              pausar.mutate(campanha.id, { onSuccess: () => toast.success("Campanha pausada.") })
            }
          >
            Pausar
          </Button>
        ) : null}
        {campanha.status === "paused" ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={retomar.isPending}
            onClick={() =>
              retomar.mutate(campanha.id, { onSuccess: () => toast.success("Campanha retomada.") })
            }
          >
            Retomar
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onAbrir}>
          Abrir
        </Button>
      </div>
    </Card>
  );
}

export function DisparosClient() {
  const { data: campanhas, isLoading } = useDisparos();
  const [criando, setCriando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  if (aberta) {
    return <DetalheDoDisparo id={aberta} onVoltar={() => setAberta(null)} />;
  }

  const lista = campanhas ?? [];
  const rodando = lista.filter((c) => estaViva(c.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {rodando > 0
            ? `${rodando} campanha${rodando > 1 ? "s" : ""} em andamento.`
            : "Nenhuma campanha em andamento."}
        </p>
        <Button onClick={() => setCriando(true)}>
          <Plus size={16} weight="bold" />
          Novo disparo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : lista.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <PaperPlaneTilt size={32} className="text-text-muted" />
          <div>
            <p className="text-sm font-medium text-text">Nenhum disparo ainda</p>
            <p className="mt-1 text-sm text-text-muted">
              Comece por um grupo pequeno — uma tag de teste com 2 ou 3 números seus — para ver
              como a mensagem chega antes de mandar para a lista inteira.
            </p>
          </div>
          <Button onClick={() => setCriando(true)}>
            <Plus size={16} weight="bold" />
            Criar o primeiro
          </Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {lista.map((c) => (
            <LinhaDaCampanha key={c.id} campanha={c} onAbrir={() => setAberta(c.id)} />
          ))}
        </div>
      )}

      {criando ? (
        <NovoDisparoDialog
          onFechar={() => setCriando(false)}
          onCriada={(id) => {
            setCriando(false);
            setAberta(id);
          }}
        />
      ) : null}
    </div>
  );
}
