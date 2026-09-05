"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "@/lib/ui/icons";

import { useBoard } from "@/hooks/kanban/useBoard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { BarChart } from "@/components/charts/BarChart";
import { SegmentedBar } from "@/components/charts/SegmentedBar";
import { EmptyPipeline } from "@/components/empty";
import { TodayDate } from "@/components/shell/TodayDate";
import { ProspectingSection } from "./ProspectingSection";
import { SixtyDayPlanSection } from "./SixtyDayPlanSection";
import { TarefasDeHojeSection } from "./TarefasDeHojeSection";
import { NumeroFilter } from "./NumeroFilter";
import { CardHeading, PeriodSegmented, SectionHeading } from "./primitives";
import { useLeadChannels } from "@/hooks/metrics/useLeadChannels";
import {
  SEM_CONVERSA,
  TODOS_OS_NUMEROS,
  filtrarPorNumero,
} from "@/lib/dashboard/numeros";
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

/**
 * Painel (redesign 2026-09) — o mosaico.
 *
 * A primeira dobra é UMA peça: o card-herói (valor do pipeline, com a barra
 * "abertos por etapa" no pé) à esquerda e o gráfico grande de negócios por
 * semana ocupando dois terços à direita; embaixo, três números do período.
 * Depois vêm as tarefas do dia, o plano de 60 dias e a prospecção. A ordem
 * mudou de propósito: a tela existe para mostrar o funil, então o funil abre.
 *
 * As métricas de uma mesma seção dividem a MESMA janela de período, escolhida
 * na régua do topo. `max-w-[1400px]`: acima disso o gráfico de oito barras
 * vira oito palitos.
 */
export function DashboardClient({
  pipelineId,
  pipelineName,
  prospectingPipelineId,
  prospectingPipelineName,
  firstName,
}: Props) {
  const [period, setPeriod] = useState<PeriodId>("month");
  const [numeroId, setNumeroId] = useState<string>(TODOS_OS_NUMEROS);
  const board = useBoard(pipelineId);
  const canais = useLeadChannels(pipelineId);

  // O INSTANTE DO RENDER, congelado. Sem o `useMemo` cada re-render criaria um
  // `new Date()` novo e as janelas de dois KPIs poderiam cair em lados opostos
  // da virada do dia — dois números da mesma tela descrevendo períodos
  // diferentes, sem nada na tela dizendo isso.
  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => periodRange(period, now), [period, now]);

  const canaisData = canais.data?.data ?? null;

  /**
   * O quadro já recortado pelo número escolhido.
   *
   * Com "Todos os números" devolve o MESMO objeto do board — sem cópia — para
   * os `useMemo` de baixo não recalcularem a cada render quando não há filtro,
   * que é o caso da maioria das visitas ao Painel.
   *
   * Enquanto o mapa de números não chega, o filtro fica inerte em vez de
   * esvaziar a tela: um Painel que pisca "0 negócios" antes de mostrar o número
   * certo é pior que um Painel que demora meio segundo a mais para filtrar.
   */
  const boardFiltrado = useMemo(() => {
    if (!board.data) return null;
    if (numeroId === TODOS_OS_NUMEROS || !canaisData) return board.data;
    return {
      ...board.data,
      leads: filtrarPorNumero(board.data.leads, canaisData.byLead, numeroId),
    };
  }, [board.data, canaisData, numeroId]);

  const metrics = useMemo(
    () => (boardFiltrado ? computeDashboardMetrics(boardFiltrado, range) : null),
    [boardFiltrado, range],
  );
  const activity = useMemo(
    () => (boardFiltrado ? weeklyActivity(boardFiltrado.leads, now) : []),
    [boardFiltrado, now],
  );
  // A mesma série das barras, como sparkline no card de "Novos negócios": o
  // card diz a direção, o gráfico grande diz o valor de cada semana.
  const trend = useMemo(() => activity.map((a) => a.value), [activity]);

  const periodLabel =
    PERIOD_OPTIONS.find((p) => p.id === period)?.label ?? "Este mês";
  const comparison = PERIOD_COMPARISON_LABEL[period];

  const filtrando = numeroId !== TODOS_OS_NUMEROS;
  const nomeDoNumero = filtrando
    ? numeroId === SEM_CONVERSA
      ? "quem ainda não tem conversa"
      : (canaisData?.numeros.find((n) => n.id === numeroId)?.nome ?? "um número")
    : null;

  if (!pipelineId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyPipeline primary={{ label: "Ir para Configurações", href: "/app/settings" }} />
      </div>
    );
  }

  const abertosLabel = `${metrics?.openCount.toLocaleString("pt-BR") ?? "0"} ${
    metrics?.openCount === 1 ? "negócio aberto" : "negócios abertos"
  }`;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <TodayDate className="text-[13px] font-medium text-text-muted" />
          {/* Emoji SÓ na saudação — é a única licença do sistema. */}
          <h1 className="text-[28px] font-semibold leading-none tracking-[-0.03em] text-text sm:text-[32px]">
            {firstName ? `Olá, ${firstName}` : "Olá"} 👋
          </h1>
          <p className="text-sm text-text-muted">
            {pipelineName
              ? `Seu funil "${pipelineName}" em um relance.`
              : "Seu funil em um relance."}
            {nomeDoNumero ? ` Vendo só ${nomeDoNumero}.` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* O seletor só nasce quando há mais de uma linha para comparar: com
              um número só ele seria um botão que não muda nada. */}
          {canaisData && canaisData.numeros.length > 1 && (
            <NumeroFilter
              numeros={canaisData.numeros}
              semConversa={canaisData.semConversa}
              total={board.data?.leads.length ?? 0}
              valor={numeroId}
              onChange={setNumeroId}
            />
          )}
          <PeriodSegmented value={period} onChange={setPeriod} />
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Funil"
          subtitle={
            pipelineName ? `"${pipelineName}" · ${periodLabel}` : periodLabel
          }
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href={`/app/pipelines/${pipelineId}`}>
                Abrir funil
                <ArrowRight size={14} aria-hidden />
              </Link>
            </Button>
          }
        />

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
            {/* A peça central: herói (4/12) + gráfico grande (8/12). */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
              {/* O ÚNICO card-herói da tela. É a métrica principal — o valor
                  parado no funil — e por isso não carrega pill de variação: ela
                  é ESTOQUE (quanto há agora), e comparar estoque com o "criado
                  no período" ao lado do mesmo número diria uma coisa mostrando
                  outra. A barra por etapa no pé é a distribuição desse mesmo
                  estoque. */}
              <StatCard
                featured
                label="Valor do pipeline"
                value={formatCompactBRL(metrics.pipelineValueCents)}
                hint={`em ${abertosLabel}`}
                href={`/app/pipelines/${pipelineId}`}
                className="xl:col-span-4"
                footer={
                  <div className="flex flex-col gap-2.5">
                    <span className="text-xs font-medium text-text-muted">
                      Abertos por etapa
                    </span>
                    <SegmentedBar
                      data={metrics.byStage}
                      caption="Negócios abertos por etapa do funil"
                    />
                  </div>
                }
              />

              <Card className="flex flex-col gap-5 p-5 sm:p-6 xl:col-span-8">
                <CardHeading
                  title="Negócios criados por semana"
                  subtitle="últimas 8 semanas · a semana começa na segunda"
                />
                <BarChart
                  data={activity}
                  height={236}
                  caption="Negócios criados por semana nas últimas 8 semanas"
                />
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Novos negócios"
                value={metrics.createdInPeriod.toLocaleString("pt-BR")}
                delta={metrics.createdDelta}
                hint={comparison}
                trend={trend}
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
          </>
        )}
      </section>

      {/* O combinado com hora marcada vem logo depois do funil. Some sozinho
          nos dias em que não há nada vencendo. */}
      <TarefasDeHojeSection now={now} />

      {/* Fora do regime da régua de período: as janelas do plano são fixas
          (hoje/semana/60 dias). Dados próprios, queda própria. */}
      <SixtyDayPlanSection prospectingPipelineId={prospectingPipelineId} now={now} />

      {/* O seletor de número NÃO governa a seção de baixo: ela agrega no banco
          (fn_prospecting_metrics) e recebe o funil, não a lista de leads. Dizer
          isso na tela é o mínimo — número filtrado em cima e número cheio
          embaixo, sem aviso, viraria "o Painel se contradiz". */}
      {filtrando && prospectingPipelineId && (
        <p className="-mb-4 text-xs text-text-subtle">
          A prospecção abaixo continua somando todos os números.
        </p>
      )}

      {/* Fora do ternário do board de propósito: a seção busca os próprios
          dados e não deve esperar (nem cair junto com) o funil de cima. O
          `range` congelado é o MESMO — a régua de período governa as duas
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
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Skeleton className="h-[372px] rounded-card xl:col-span-4" />
        <Skeleton className="h-[372px] rounded-card xl:col-span-8" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[156px] rounded-card" />
        ))}
      </div>
    </div>
  );
}
