"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CaretDown } from "@/lib/ui/icons";

import { useBoard } from "@/hooks/kanban/useBoard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { MonoLabel } from "@/components/ui/mono-label";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { EmptyPipeline } from "@/components/empty";
import { ProspectingSection } from "./ProspectingSection";
import { SixtyDayPlanSection } from "./SixtyDayPlanSection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PERIOD_COMPARISON_LABEL,
  PERIOD_OPTIONS,
  periodRange,
  type PeriodId,
} from "@/lib/dashboard/period";
import {
  computeDashboardMetrics,
  formatCompactBRL,
  weeklyActivity,
} from "@/lib/dashboard/metrics";

interface Props {
  pipelineId: string | null;
  pipelineName: string | null;
  /** Funil de prospecção detectado no servidor; null ⇒ a seção não renderiza. */
  prospectingPipelineId: string | null;
  prospectingPipelineName: string | null;
  firstName: string | null;
}

export function DashboardClient({
  pipelineId,
  pipelineName,
  prospectingPipelineId,
  prospectingPipelineName,
  firstName,
}: Props) {
  const [period, setPeriod] = useState<PeriodId>("month");
  const board = useBoard(pipelineId);

  // O INSTANTE DO RENDER, congelado. Sem o `useMemo` cada re-render criaria um
  // `new Date()` novo e as janelas de dois KPIs poderiam cair em lados opostos
  // da virada do dia — dois números da mesma tela descrevendo períodos
  // diferentes, sem nada na tela dizendo isso.
  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => periodRange(period, now), [period, now]);

  const metrics = useMemo(
    () => (board.data ? computeDashboardMetrics(board.data, range) : null),
    [board.data, range],
  );
  const activity = useMemo(
    () => (board.data ? weeklyActivity(board.data.leads, now) : []),
    [board.data, now],
  );

  const periodLabel =
    PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? "Este mês";
  const comparison = PERIOD_COMPARISON_LABEL[period];

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
          {/* Emoji SÓ na saudação — é a única licença do sistema. */}
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.5px] text-text">
            {firstName ? `Olá, ${firstName}` : "Olá"} 👋
          </h1>
          <p className="text-sm text-text-muted">
            {pipelineName
              ? `Seu funil "${pipelineName}" em um relance.`
              : "Seu funil em um relance."}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="gap-2">
              <span>{periodLabel}</span>
              <CaretDown size={14} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {PERIOD_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.id}
                onClick={() => setPeriod(opt.id)}
                disabled={opt.id === period}
              >
                {opt.label}
                {opt.id === period && (
                  <span className="ml-auto text-xs text-text-subtle">atual</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* O plano de 60 dias abre o Painel: é a resposta de "o que eu faço
          hoje?", antes do "como está o funil?". Fora do ternário do board
          (dados próprios) e fora do regime do seletor de período — as janelas
          do plano são fixas (hoje/semana/60 dias), o dropdown não as governa. */}
      <SixtyDayPlanSection prospectingPipelineId={prospectingPipelineId} now={now} />

      {board.isLoading || !metrics ? (
        <DashboardSkeleton />
      ) : board.isError ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-error-fg">Não foi possível carregar o funil.</p>
          <Button variant="secondary" size="sm" onClick={() => board.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <MonoLabel>pipeline</MonoLabel>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {/* O ÚNICO card de destaque da tela. Ver StatCard: dois destaques
                  não destacam nada. É a métrica principal — o valor parado no
                  funil — e por isso não carrega pill de variação: ela é ESTOQUE
                  (quanto há agora), e comparar estoque com o "criado no período"
                  ao lado do mesmo número diria uma coisa mostrando outra. */}
              <StatCard
                featured
                label="Valor do pipeline"
                value={formatCompactBRL(metrics.pipelineValueCents)}
                hint={`em ${metrics.openCount.toLocaleString("pt-BR")} ${
                  metrics.openCount === 1 ? "negócio aberto" : "negócios abertos"
                }`}
                href={`/app/pipelines/${pipelineId}`}
              />
              <StatCard
                label="Novos negócios"
                value={metrics.createdInPeriod.toLocaleString("pt-BR")}
                delta={metrics.createdDelta}
                hint={comparison}
                href="/app/leads"
              />
              <StatCard
                label={metrics.secondStage?.name ?? "Em andamento"}
                value={(metrics.secondStage?.count ?? 0).toLocaleString("pt-BR")}
                hint="negócios nesta etapa agora"
                href="/app/leads"
              />
              <StatCard
                label="Taxa de conversão"
                value={
                  metrics.conversionRate === undefined
                    ? "—"
                    : `${metrics.conversionRate.toLocaleString("pt-BR")}%`
                }
                delta={metrics.conversionDelta}
                hint={
                  metrics.conversionRate === undefined
                    ? "sem fechamentos no período"
                    : `${metrics.wonInPeriod} ganhos · ${metrics.lostInPeriod} perdidos`
                }
                href="/app/metrics"
              />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="flex flex-col gap-6 p-6 xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <MonoLabel>atividade</MonoLabel>
                  <h2 className="text-base font-semibold text-text">
                    Negócios criados por semana
                  </h2>
                </div>
                <span className="text-xs text-text-subtle">últimas 8 semanas</span>
              </div>
              <BarChart
                data={activity}
                caption="Negócios criados por semana nas últimas 8 semanas"
              />
            </Card>

            <Card className="flex flex-col gap-6 p-6">
              <div className="flex flex-col gap-1">
                <MonoLabel>distribuição</MonoLabel>
                <h2 className="text-base font-semibold text-text">
                  Abertos por etapa
                </h2>
              </div>
              <DonutChart
                data={metrics.byStage}
                caption="Negócios abertos por etapa do funil"
                centerValue={metrics.openCount.toLocaleString("pt-BR")}
                centerLabel="abertos"
              />
              <Link
                href="/app/leads"
                className="text-sm text-accent hover:underline"
              >
                Ver todos os negócios
              </Link>
            </Card>
          </section>
        </>
      )}

      {/* Fora do ternário do board de propósito: a seção busca os próprios
          dados e não deve esperar (nem cair junto com) o funil de cima. O
          `range` congelado é o MESMO — o seletor de período governa as duas
          metades atomicamente. */}
      {prospectingPipelineId && prospectingPipelineName && (
        <ProspectingSection
          pipelineId={prospectingPipelineId}
          pipelineName={prospectingPipelineName}
          range={range}
          comparison={comparison}
          periodLabel={periodLabel}
        />
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[148px] rounded-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[360px] rounded-card xl:col-span-2" />
        <Skeleton className="h-[360px] rounded-card" />
      </div>
    </div>
  );
}
