import type { BoardData, Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";
import { openStagesOf, stageTone } from "@/lib/kanban/stage-tone";
import type { FunnelStageSummary } from "@/components/kanban/FunnelSummaryCards";
import {
  inRange,
  percentChange,
  type PeriodRange,
} from "@/lib/dashboard/period";

/**
 * Os números do painel e do topo da lista, derivados do board.
 *
 * Tudo aqui sai de `crm_leads` (via /api/v1/pipelines/[id]/board) e é calculado
 * no cliente. Não há endpoint de agregação por período no produto, e inventar
 * um seria mudar o backend numa tarefa de pele — então a conta é feita sobre os
 * leads que a tela já carregou. A consequência a saber: se o board vier
 * paginado no futuro, estes números passam a descrever a página, não o pipeline.
 */

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

export function formatCompactBRL(cents: number): string {
  const reais = cents / 100;
  // Acima de 1 milhão o valor por extenso não cabe no KPI de 32px sem quebrar
  // linha, e quebrar destrói o alinhamento da fileira de cards.
  if (Math.abs(reais) >= 1_000_000) {
    return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })}M`;
  }
  if (Math.abs(reais) >= 10_000) {
    return `R$ ${(reais / 1000).toLocaleString("pt-BR", {
      maximumFractionDigits: 0,
    })}k`;
  }
  return formatBRL(cents);
}

const valueOf = (l: Lead) => l.value_cents ?? 0;

export interface DashboardMetrics {
  /** Soma dos negócios ABERTOS agora — estoque, não fluxo do período. */
  pipelineValueCents: number;
  openCount: number;
  /** Negócios criados dentro da janela. */
  createdInPeriod: number;
  createdDelta: number | undefined;
  wonInPeriod: number;
  lostInPeriod: number;
  /** ganhos / (ganhos + perdidos) fechados na janela, em %. */
  conversionRate: number | undefined;
  conversionDelta: number | undefined;
  /** A segunda etapa aberta do funil — o "R1 agendada" genérico. */
  secondStage: { name: string; count: number } | null;
  /** Distribuição dos abertos por etapa, para o donut. */
  byStage: Array<{ label: string; value: number }>;
}

function conversionOf(leads: Lead[], from: Date, to: Date): number | undefined {
  const won = leads.filter((l) => l.status === "won" && inRange(l.closed_at, from, to)).length;
  const lost = leads.filter((l) => l.status === "lost" && inRange(l.closed_at, from, to)).length;
  const closed = won + lost;
  // Sem nenhum fechamento na janela a taxa não é 0% — ela é indefinida. 0%
  // leria como "fechamos tudo errado", quando o que houve foi "não fechamos".
  if (closed === 0) return undefined;
  return Math.round((won / closed) * 1000) / 10;
}

export function computeDashboardMetrics(
  board: BoardData,
  range: PeriodRange,
): DashboardMetrics {
  const { leads, stages } = board;
  const open = leads.filter((l) => l.status === "open");
  const openStages = openStagesOf(stages);

  const createdInPeriod = leads.filter((l) =>
    inRange(l.created_at, range.from, range.to),
  ).length;
  const createdPrev = leads.filter((l) =>
    inRange(l.created_at, range.prevFrom, range.prevTo),
  ).length;

  const conversionRate = conversionOf(leads, range.from, range.to);
  const conversionPrev = conversionOf(leads, range.prevFrom, range.prevTo);

  const second = openStages[1] ?? null;

  const byStage = openStages
    .map((s) => ({
      label: s.name,
      value: open.filter((l) => l.stage_id === s.id).length,
    }))
    .filter((s) => s.value > 0);

  return {
    pipelineValueCents: open.reduce((acc, l) => acc + valueOf(l), 0),
    openCount: open.length,
    createdInPeriod,
    createdDelta: percentChange(createdInPeriod, createdPrev),
    wonInPeriod: leads.filter(
      (l) => l.status === "won" && inRange(l.closed_at, range.from, range.to),
    ).length,
    lostInPeriod: leads.filter(
      (l) => l.status === "lost" && inRange(l.closed_at, range.from, range.to),
    ).length,
    conversionRate,
    conversionDelta:
      conversionRate !== undefined && conversionPrev !== undefined
        ? percentChange(conversionRate, conversionPrev)
        : undefined,
    secondStage: second
      ? { name: second.name, count: open.filter((l) => l.stage_id === second.id).length }
      : null,
    byStage,
  };
}

/**
 * Série semanal de negócios criados, para o gráfico de barras.
 *
 * Semana e não dia: em 8 dias de barras uma operação pequena mostra três zeros
 * e duas barras, e o gráfico deixa de ter forma. `weeks` semanas fechadas
 * (segunda a domingo) dão tendência mesmo com volume baixo.
 */
export function weeklyActivity(
  leads: Lead[],
  now: Date,
  weeks = 8,
): Array<{ label: string; value: number }> {
  const buckets: Array<{ label: string; value: number; start: number; end: number }> = [];

  // Início da semana corrente (segunda-feira). `getDay()` devolve 0 para
  // domingo, então domingo precisa voltar 6 dias, não 0 — senão a semana de
  // quem abre o painel no domingo aparece vazia.
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - (day === 0 ? 6 : day - 1));
  startOfWeek.setHours(0, 0, 0, 0);

  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(startOfWeek);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    buckets.push({
      label: `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}`,
      value: 0,
      start: start.getTime(),
      end: end.getTime(),
    });
  }

  for (const lead of leads) {
    const t = new Date(lead.created_at).getTime();
    const bucket = buckets.find((b) => t >= b.start && t < b.end);
    if (bucket) bucket.value += 1;
  }

  return buckets.map(({ label, value }) => ({ label, value }));
}

/**
 * Os quatro cards de resumo do funil.
 *
 * Escolhe as três primeiras etapas ABERTAS mais a etapa de ganho — que é o
 * formato do briefing (entrada → meio → proposta → fechado) e o que resume um
 * funil de qualquer tamanho. Pipelines com menos etapas devolvem menos cards; o
 * componente lida com isso.
 */
export function pickFunnelStages(
  board: BoardData,
  range: PeriodRange,
): FunnelStageSummary[] {
  const { leads, stages } = board;
  const openStages = openStagesOf(stages);
  const wonStage = stages.find((s) => s.is_won && !s.is_archived);

  const chosen: Stage[] = [...openStages.slice(0, 3)];
  if (wonStage) chosen.push(wonStage);

  return chosen.map((stage) => {
    const inStage = leads.filter((l) => l.stage_id === stage.id);
    const curr = inStage.filter((l) => inRange(l.created_at, range.from, range.to)).length;
    const prev = inStage.filter((l) => inRange(l.created_at, range.prevFrom, range.prevTo)).length;
    return {
      stageId: stage.id,
      name: stage.name,
      tone: stageTone(stage, openStages),
      count: inStage.length,
      delta: percentChange(curr, prev),
    };
  });
}
