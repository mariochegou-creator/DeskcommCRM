"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MagnifyingGlass,
  Plus,
  Export,
  UploadSimple,
  ArrowsDownUp,
  DotsThree,
  CaretLeft,
  CaretRight,
} from "@/lib/ui/icons";

import { useBoard } from "@/hooks/kanban/useBoard";
import { useMoveCard } from "@/hooks/kanban/useMoveCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MonoLabel } from "@/components/ui/mono-label";
import { EmptyPipeline } from "@/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditableStagePill } from "@/components/kanban/StagePill";
import { BulkActionBar } from "@/components/kanban/BulkActionBar";
import { FunnelSummaryCards } from "@/components/kanban/FunnelSummaryCards";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { ImportKaptarDialog } from "@/components/kanban/ImportKaptarDialog";
import { FilterChips, type ActiveFilter } from "./FilterChips";
import { periodRange } from "@/lib/dashboard/period";
import { formatBRL, pickFunnelStages } from "@/lib/dashboard/metrics";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";

const PAGE_SIZE = 25;

type SortId = "recent" | "value-desc" | "value-asc" | "activity";

const SORT_OPTIONS: Array<{ id: SortId; label: string }> = [
  { id: "recent", label: "Mais recentes" },
  { id: "activity", label: "Atividade mais recente" },
  { id: "value-desc", label: "Maior valor" },
  { id: "value-asc", label: "Menor valor" },
];

const STATUS_OPTIONS = [
  { id: "open", label: "Abertos" },
  { id: "won", label: "Ganhos" },
  { id: "lost", label: "Perdidos" },
] as const;

type StatusId = (typeof STATUS_OPTIONS)[number]["id"];

function relativeTime(iso: string | null): string {
  if (!iso) return "sem atividade";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `há ${days}d`;
  const months = Math.round(days / 30);
  return `há ${months} ${months === 1 ? "mês" : "meses"}`;
}

/**
 * Exporta o RECORTE VISÍVEL, não o pipeline inteiro.
 *
 * Quem clica em Exportar depois de filtrar e ordenar espera o arquivo que está
 * vendo. Exportar tudo obrigaria a refazer o filtro na planilha — e silenciosa-
 * mente entregaria negócios que a pessoa tinha acabado de excluir da vista.
 */
function exportCsv(leads: Lead[], stages: Stage[]) {
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const header = ["Negócio", "Etapa", "Status", "Valor (R$)", "Criado em", "Última atividade"];
  const rows = leads.map((l) => [
    l.title,
    stageName.get(l.stage_id) ?? "",
    l.status,
    ((l.value_cents ?? 0) / 100).toFixed(2),
    new Date(l.created_at).toLocaleDateString("pt-BR"),
    l.last_activity_at ? new Date(l.last_activity_at).toLocaleDateString("pt-BR") : "",
  ]);

  // Aspas duplicadas + campo entre aspas: nome de negócio com vírgula ou aspas
  // (`Contrato "Premium", 12x`) quebraria a coluna no Excel sem isto.
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");

  // BOM UTF-8: sem ele o Excel do Windows abre "Negócio" como "NegÃ³cio".
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `negocios-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function LeadsClient({
  pipelineId,
  pipelines,
}: {
  pipelineId: string | null;
  pipelines: Array<{ id: string; name: string }>;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusId | null>("open");
  const [sort, setSort] = useState<SortId>("recent");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const board = useBoard(pipelineId);
  const move = useMoveCard(pipelineId ?? "");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => periodRange("month", now), [now]);

  // `?? []` sem memo criaria um array novo a cada render e invalidaria o
  // `stageById` abaixo em toda passagem — e, com ele, tudo que depende do mapa.
  const stages = useMemo(() => board.data?.stages ?? [], [board.data]);
  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.id, s])),
    [stages],
  );

  const filtered = useMemo(() => {
    const all = board.data?.leads ?? [];
    const term = search.trim().toLowerCase();
    const result = all.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (stageFilter && l.stage_id !== stageFilter) return false;
      if (term && !l.title.toLowerCase().includes(term)) return false;
      return true;
    });

    const sorted = [...result];
    sorted.sort((a, b) => {
      if (sort === "value-desc") return (b.value_cents ?? 0) - (a.value_cents ?? 0);
      if (sort === "value-asc") return (a.value_cents ?? 0) - (b.value_cents ?? 0);
      if (sort === "activity") {
        // Sem atividade vai para o FIM em vez de virar epoch 0 e liderar a
        // ordenação inversa — "nunca teve atividade" não é "atividade antiga".
        const av = a.last_activity_at ? new Date(a.last_activity_at).getTime() : -Infinity;
        const bv = b.last_activity_at ? new Date(b.last_activity_at).getTime() : -Infinity;
        return bv - av;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return sorted;
  }, [board.data, search, stageFilter, statusFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Filtrar reduz a lista e a página atual pode deixar de existir — sem isto a
  // tabela ficaria vazia com a paginação dizendo "3 de 1".
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const funnel = useMemo(
    () => (board.data ? pickFunnelStages(board.data, range) : []),
    [board.data, range],
  );

  const activeFilters: ActiveFilter[] = [];
  if (search)
    activeFilters.push({
      id: "search",
      label: `Busca: "${search}"`,
      onRemove: () => { setSearchInput(""); setSearch(""); },
    });
  if (stageFilter)
    activeFilters.push({
      id: "stage",
      label: `Etapa: ${stageById.get(stageFilter)?.name ?? "—"}`,
      onRemove: () => setStageFilter(null),
    });
  if (statusFilter)
    activeFilters.push({
      id: "status",
      label: `Status: ${STATUS_OPTIONS.find((s) => s.id === statusFilter)?.label}`,
      onRemove: () => setStatusFilter(null),
    });

  const allVisibleSelected =
    visible.length > 0 && visible.every((l) => selected.has(l.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      // A caixa do header opera sobre a PÁGINA visível, não sobre os 652 do
      // filtro: marcar em massa o que não está na tela é como se apagam
      // registros sem querer.
      if (allVisibleSelected) visible.forEach((l) => next.delete(l.id));
      else visible.forEach((l) => next.add(l.id));
      return next;
    });
  }

  if (!pipelineId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyPipeline primary={{ label: "Ir para Configurações", href: "/app/settings" }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <MonoLabel>negócios</MonoLabel>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.5px] text-text">
            Negócios
          </h1>
        </div>
        {pipelines.length > 1 && (
          <span className="text-sm text-text-muted">
            {pipelines.find((p) => p.id === pipelineId)?.name}
          </span>
        )}
      </header>

      {board.isLoading ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[124px] rounded-card" />
            ))}
          </div>
          <Skeleton className="h-[420px] rounded-card" />
        </>
      ) : board.isError ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-error-fg">Não foi possível carregar os negócios.</p>
          <Button variant="secondary" size="sm" onClick={() => board.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <>
          <FunnelSummaryCards stages={funnel} />

          <Card className="overflow-hidden">
            {/* Barra de ações. `flex-wrap` porque são seis controles: numa
                tela de 1280px com o rail aberto eles não cabem em uma linha, e
                sem a quebra o botão primário sairia do card. */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <MagnifyingGlass
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
                  aria-hidden
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); setPage(0); }}
                  placeholder="Buscar negócio…"
                  aria-label="Buscar negócio"
                  className="h-10 w-full rounded-pill bg-surface-elevated pl-10 pr-4 text-sm text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                />
              </div>

              <span className="text-sm text-text-muted tabular">
                {filtered.length.toLocaleString("pt-BR")}{" "}
                {filtered.length === 1 ? "negócio" : "negócios"}
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  variant="link"
                  onClick={() => setImportOpen(true)}
                  className="gap-2 no-underline"
                >
                  <UploadSimple size={16} aria-hidden />
                  Importar
                </Button>

                <Button
                  variant="link"
                  onClick={() => exportCsv(filtered, stages)}
                  disabled={filtered.length === 0}
                  className="gap-2 no-underline"
                >
                  <Export size={16} aria-hidden />
                  Exportar
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" className="gap-2">
                      <ArrowsDownUp size={16} aria-hidden />
                      <span className="hidden sm:inline">Ordenar</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[220px]">
                    <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {SORT_OPTIONS.map((o) => (
                      <DropdownMenuItem
                        key={o.id}
                        onClick={() => setSort(o.id)}
                        disabled={o.id === sort}
                      >
                        {o.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Status</DropdownMenuLabel>
                    {STATUS_OPTIONS.map((o) => (
                      <DropdownMenuItem
                        key={o.id}
                        onClick={() => { setStatusFilter(o.id); setPage(0); }}
                        disabled={o.id === statusFilter}
                      >
                        {o.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button onClick={() => setCreateOpen(true)} className="gap-2">
                  <Plus size={16} weight="bold" aria-hidden />
                  Adicionar
                </Button>
              </div>
            </div>

            {activeFilters.length > 0 && (
              <div className="border-b border-border px-4 py-3">
                <FilterChips
                  filters={activeFilters}
                  onClearAll={() => {
                    setSearchInput("");
                    setSearch("");
                    setStageFilter(null);
                    setStatusFilter(null);
                    setPage(0);
                  }}
                />
              </div>
            )}

            {/* Acima da tabela, junto dos filtros — mesma razão do Kanban: é
                onde o olho está depois de marcar, sem depender de rolar uma
                lista de centenas de linhas. */}
            {selected.size > 0 && (
              <div className="border-b border-border px-4 py-3">
                <BulkActionBar
                  selectedIds={[...selected]}
                  stages={stages}
                  pipelineId={pipelineId}
                  onClear={() => setSelected(new Set())}
                />
              </div>
            )}

            {visible.length === 0 ? (
              <p className="p-10 text-center text-sm text-text-muted">
                Nenhum negócio corresponde a estes filtros.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label="Selecionar todos os negócios desta página"
                        className="h-4 w-4 cursor-pointer rounded-sm accent-[var(--color-accent)]"
                      />
                    </TableHead>
                    <TableHead>Negócio</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="hidden lg:table-cell">Atividade</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((lead) => {
                    const stage = stageById.get(lead.stage_id);
                    return (
                      <TableRow
                        key={lead.id}
                        data-state={selected.has(lead.id) ? "selected" : undefined}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(lead.id)}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(lead.id)) next.delete(lead.id);
                                else next.add(lead.id);
                                return next;
                              })
                            }
                            aria-label={`Selecionar ${lead.title}`}
                            className="h-4 w-4 cursor-pointer rounded-sm accent-[var(--color-accent)]"
                          />
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Link
                              href={`/app/leads/${lead.id}`}
                              className="truncate text-sm font-medium text-text hover:text-accent"
                            >
                              {lead.title}
                            </Link>
                            <span className="truncate text-xs text-text-subtle">
                              criado em{" "}
                              {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className="text-right text-sm tabular">
                          {lead.value_cents ? (
                            formatBRL(lead.value_cents)
                          ) : (
                            <span className="text-text-subtle">—</span>
                          )}
                        </TableCell>

                        <TableCell>
                          {stage && (
                            <EditableStagePill
                              stage={stage}
                              stages={stages}
                              // `position_in_stage: 0` = topo da coluna de
                              // destino. É a mesma convenção do Kanban ao
                              // soltar um card no alto, e o servidor reordena
                              // os vizinhos.
                              onSelect={(stageId) =>
                                move.mutate({
                                  leadId: lead.id,
                                  stageId,
                                  positionInStage: 0,
                                  expectedUpdatedAt: lead.updated_at,
                                })
                              }
                              disabled={move.isPending}
                            />
                          )}
                        </TableCell>

                        <TableCell className="hidden text-xs text-text-muted lg:table-cell">
                          {relativeTime(lead.last_activity_at)}
                        </TableCell>

                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-round"
                                aria-label={`Ações de ${lead.title}`}
                              >
                                <DotsThree size={18} weight="bold" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/app/leads/${lead.id}`}>Abrir negócio</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/app/pipelines/${pipelineId}`}>
                                  Ver no Kanban
                                </Link>
                              </DropdownMenuItem>
                              {lead.contact_id && (
                                <DropdownMenuItem asChild>
                                  <Link href={`/app/contacts/${lead.contact_id}`}>
                                    Ver contato
                                  </Link>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-4 border-t border-border p-4">
                <span className="text-xs text-text-muted tabular">
                  {safePage + 1} de {pageCount}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="icon-round"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    aria-label="Página anterior"
                  >
                    <CaretLeft size={14} aria-hidden />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon-round"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={safePage >= pageCount - 1}
                    aria-label="Próxima página"
                  >
                    <CaretRight size={14} aria-hidden />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {board.data && (
        <NewLeadDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          pipelineId={pipelineId}
          stages={board.data.stages}
        />
      )}

      {board.data && (
        <ImportKaptarDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          pipelineId={pipelineId}
          stages={board.data.stages}
        />
      )}

    </div>
  );
}
