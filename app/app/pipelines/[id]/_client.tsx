"use client";
import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useBoard } from "@/hooks/kanban/useBoard";

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof obj.message === "string") {
      const code = typeof obj.code === "string" ? ` [${obj.code}]` : "";
      return `${obj.message}${code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Erro desconhecido";
    }
  }
  return String(err);
}
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { FilterBar } from "@/components/kanban/FilterBar";
import { BulkActionBar } from "@/components/kanban/BulkActionBar";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CaretDown, Check, Plus } from "@/lib/ui/icons";
import type { LeadFilters } from "@/lib/kanban/filters";
import { applyFilters, filtersFromParams, filtersToParams } from "@/lib/kanban/filters";

export interface FunilDoSeletor {
  id: string;
  name: string;
  is_default: boolean;
}

export function PipelinePageClient({
  pipelineId,
  initialName,
  funis = [],
}: {
  pipelineId: string;
  initialName: string;
  /** Todos os funis da empresa — o seletor do topo troca sem sair do quadro. */
  funis?: FunilDoSeletor[];
}) {
  const { data, isLoading, error, pulses, realtimeStatus, seguranca } = useBoard(pipelineId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next: LeadFilters) => {
      const qs = filtersToParams(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);

  const filteredLeads = data ? applyFilters(data.leads, filters) : [];

  return (
    <div
      className="flex h-full flex-col gap-4"
      // OBSERVÁVEL de propósito, e é a razão de existir desta linha: "a
      // assinatura morreu" e "nada aconteceu" produzem o MESMO silêncio na
      // tela, e sem este valor nem o produto nem o teste conseguem separar as
      // duas famílias de causa. Com ele, quem investiga olha DURANTE a rodada
      // que falha: `subscribed` manda procurar a montante (entrega, filtro, ou
      // o evento nunca saiu); `channel_error`/`timed_out`/`closed` já é a
      // resposta.
      //
      // Ainda NÃO religa — religar é desenho e merece bloco próprio. Isto aqui
      // é só parar de descartar o que já era calculado.
      data-realtime-status={realtimeStatus.toLowerCase()}
      // A rede de segurança fica OBSERVÁVEL pelo mesmo motivo do status do
      // canal: "a entrega morreu" e "nada aconteceu" têm a mesma aparência, que
      // é silêncio. Aqui o número de divergências é a diferença entre os dois —
      // e é o sinal que faltava para uma verificação poder APROVAR, e não só
      // reprovar.
      data-refetch-divergencias={seguranca.divergencias}
      data-refetch-em={seguranca.ultimaVerificacao ?? ""}
    >
      <header className="flex items-center justify-between">
        {/* O nome do funil É o seletor: quem abre o Kanban já cai no funil
            principal, e trocar de funil é um clique aqui — não uma tela
            inteira antes do quadro. */}
        <DropdownMenu>
          {/* O <h1> continua sendo o título da página: o gatilho mora DENTRO
              dele, não no lugar dele. */}
          <h1 className="text-2xl font-semibold tracking-tight">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="-ml-2 flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted"
                title="Trocar de funil"
              >
                {data?.pipeline.name ?? initialName}
                <CaretDown size={18} className="text-muted-foreground" aria-hidden />
              </button>
            </DropdownMenuTrigger>
          </h1>
          <DropdownMenuContent align="start" className="min-w-56">
            {funis.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onSelect={() => {
                  if (f.id !== pipelineId) router.push(`/app/pipelines/${f.id}`);
                }}
              >
                <Check
                  size={14}
                  className={f.id === pipelineId ? "mr-2" : "mr-2 opacity-0"}
                  aria-hidden
                />
                {f.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/app/kanban/funis")}>
              Gerenciar funis…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={() => setNewOpen(true)} disabled={!data}>
          <Plus size={16} className="mr-2" /> Novo Lead
        </Button>
      </header>
      {data && (
        <NewLeadDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          pipelineId={pipelineId}
          stages={data.stages}
        />
      )}
      <FilterBar filters={filters} onChange={setFilters} leads={data?.leads ?? []} />

      {/* Logo abaixo dos filtros, no topo: é onde o olho já está quando se
          acabou de marcar um card, e não depende de rolar a página. */}
      <BulkActionBar
        selectedIds={selectedIds}
        stages={data?.stages ?? []}
        pipelineId={pipelineId}
        onClear={() => setSelectedIds([])}
      />
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          Erro ao carregar pipeline:{" "}
          {formatError(error)}
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-1 animate-pulse items-center justify-center text-muted-foreground">
          Carregando…
        </div>
      ) : (
        <KanbanBoard
          pipelineId={pipelineId}
          stages={data.stages}
          leads={filteredLeads}
          pulses={pulses}
          pipeline={data.pipeline}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      )}
    </div>
  );
}
