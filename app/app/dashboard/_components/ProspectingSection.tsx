"use client";
import { useId } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { MonoLabel } from "@/components/ui/mono-label";
import {
  useProspectingMetrics,
  type ProspectingFunnelStage,
} from "@/hooks/metrics/useProspectingMetrics";
import { percentChange, type PeriodRange } from "@/lib/dashboard/period";

/**
 * "// prospecção" — a metade de baixo do Painel.
 *
 * Sempre aponta para o funil de PROSPECÇÃO (detectado no servidor), mesmo
 * quando o topo mostra o funil padrão da conta. Busca os próprios dados
 * (fn_prospecting_metrics via hook) e tem loading/erro próprios — o board de
 * cima e esta seção carregam de fontes diferentes, e acorrentar os dois faria
 * o mais lento segurar o mais rápido.
 *
 * Estoque vs. fluxo (mesma regra do card de destaque lá em cima): "Em follow-up
 * agora" e "No vácuo" são ESTOQUE — sem pill de variação, porque comparar o
 * agora com uma janela diria uma coisa mostrando outra. Taxa de resposta e as
 * entradas por etapa são FLUXO da janela e seguem o seletor de período.
 */

interface Props {
  pipelineId: string;
  pipelineName: string;
  range: PeriodRange;
  comparison: string;
  periodLabel: string;
}

const R1_SLUG = /^r1[-_]/;
const R1_NAME = /^r1\b/i;

export function ProspectingSection({
  pipelineId,
  pipelineName,
  range,
  comparison,
  periodLabel,
}: Props) {
  const query = useProspectingMetrics(pipelineId, range);
  const metrics = query.data?.data ?? null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <MonoLabel>prospecção</MonoLabel>
        <p className="text-xs text-text-subtle">
          Funil &quot;{pipelineName}&quot; · {periodLabel}
        </p>
      </div>

      {query.isLoading || (!metrics && !query.isError) ? (
        <ProspectingSkeleton />
      ) : query.isError || !metrics ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-error-fg">
            Não foi possível carregar as métricas de prospecção.
          </p>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <ProspectingContent
          pipelineId={pipelineId}
          funnel={metrics.funnel}
          response={metrics.response}
          followup={metrics.followup}
          comparison={comparison}
          periodLabel={periodLabel}
        />
      )}
    </section>
  );
}

function ProspectingContent({
  pipelineId,
  funnel,
  response,
  followup,
  comparison,
  periodLabel,
}: {
  pipelineId: string;
  funnel: ProspectingFunnelStage[];
  response: { contacted: number; replied: number; prev_contacted: number | null; prev_replied: number | null };
  followup: { live_total: number; by_day: Array<{ day: string; count: number }>; vacuo: number };
  comparison: string;
  periodLabel: string;
}) {
  // Fluxo do funil, na ordem do quadro. Perdido fica fora: a passagem mede o
  // caminho até ganhar, e "70% caíram em Perdido" não é uma etapa do caminho.
  const flow = [...funnel]
    .sort((a, b) => a.position - b.position)
    .filter((s) => !s.is_lost);

  const rate =
    response.contacted > 0
      ? Math.round((response.replied / response.contacted) * 1000) / 10
      : undefined;
  const prevRate =
    response.prev_contacted !== null &&
    response.prev_contacted > 0 &&
    response.prev_replied !== null
      ? Math.round((response.prev_replied / response.prev_contacted) * 1000) / 10
      : undefined;
  const rateDelta =
    rate !== undefined && prevRate !== undefined
      ? percentChange(rate, prevRate)
      : undefined;

  const entryStage = flow[0] ?? null;
  const r1Stage =
    flow.find((s) => s.slug !== null && R1_SLUG.test(s.slug)) ??
    flow.find((s) => R1_NAME.test(s.name)) ??
    null;

  const daysHint = followup.by_day
    .filter((d) => d.count > 0)
    .map((d) => `${d.day} ${d.count.toLocaleString("pt-BR")}`)
    .join(" · ");

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Taxa de resposta"
          value={rate === undefined ? "—" : `${rate.toLocaleString("pt-BR")}%`}
          delta={rateDelta}
          hint={
            rate === undefined
              ? "ninguém contatado no período"
              : `${response.replied.toLocaleString("pt-BR")} de ${response.contacted.toLocaleString("pt-BR")} contatados responderam · ${comparison}`
          }
          href="/app/inbox"
        />
        {/* Sem etapa R1 no funil o card é OMITIDO (a passagem por etapa abaixo
            continua contando a história) — um card "R1" apontando para etapa
            adivinhada mentiria com convicção. */}
        {r1Stage && (
          <StatCard
            label={`Chegaram na ${(r1Stage.name.split(/\s+/)[0] ?? "R1").toUpperCase()}`}
            value={r1Stage.entered.toLocaleString("pt-BR")}
            hint={
              entryStage && entryStage.entered > 0
                ? `de ${entryStage.entered.toLocaleString("pt-BR")} que entraram no funil (${Math.round((r1Stage.entered / entryStage.entered) * 100)}%)`
                : "sem entradas no funil no período"
            }
            href={`/app/pipelines/${pipelineId}`}
          />
        )}
        <StatCard
          label="Em follow-up agora"
          value={followup.live_total.toLocaleString("pt-BR")}
          hint={daysHint.length > 0 ? daysHint : "ninguém na cadência agora"}
          href="/app/ai/followups"
        />
        <StatCard
          label="No vácuo"
          value={followup.vacuo.toLocaleString("pt-BR")}
          hint="terminaram a cadência sem responder"
          href="/app/ai/followups"
        />
      </div>

      <Card className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text">Passagem por etapa</h2>
          <span className="text-xs text-text-subtle">{periodLabel} · entradas</span>
        </div>
        <FunnelRows stages={flow} />
      </Card>
    </>
  );
}

/**
 * Barras horizontais locais, e não o <BarChart>: ele é vertical, trunca rótulo
 * longo de etapa e não tem onde anotar o "% da anterior" — que é a métrica
 * desta visualização, não um enfeite dela.
 */
function FunnelRows({ stages }: { stages: ProspectingFunnelStage[] }) {
  const tableId = useId();
  const max = Math.max(0, ...stages.map((s) => s.entered));

  if (stages.length === 0 || stages.every((s) => s.entered === 0)) {
    return (
      <p className="py-10 text-center text-sm text-text-muted">
        Sem movimento no período.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2" aria-hidden>
        {stages.map((s, i) => {
          const prev = i > 0 ? stages[i - 1] : null;
          const pass =
            prev && prev.entered > 0
              ? Math.round((s.entered / prev.entered) * 100)
              : null;
          const width = max > 0 ? (s.entered / max) * 100 : 0;
          return (
            <div key={s.stage_id} className="flex items-center gap-3">
              <span
                className="w-32 shrink-0 truncate text-xs text-text-muted"
                title={s.name}
              >
                {s.name}
              </span>
              <div className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-[6px] bg-surface-elevated">
                <div
                  className="h-full rounded-[6px] bg-accent"
                  style={{
                    width: `${width}%`,
                    // 0 não some: barra de largura 0 é indistinguível de
                    // "etapa não medida", e as duas coisas são diferentes.
                    minWidth: s.entered > 0 ? 4 : 2,
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs font-bold text-text tabular">
                {s.entered.toLocaleString("pt-BR")}
              </span>
              <span className="hidden w-28 shrink-0 text-right text-[11px] text-text-subtle tabular sm:block">
                {i === 0 ? "" : pass === null ? "—" : `${pass}% da anterior`}
              </span>
            </div>
          );
        })}
      </div>

      {/* O gráfico é decoração para leitor de tela; o DADO é esta tabela. */}
      <table id={tableId} className="sr-only">
        <caption>Leads que entraram em cada etapa do funil no período</caption>
        <tbody>
          {stages.map((s, i) => {
            const prev = i > 0 ? stages[i - 1] : null;
            const pass =
              prev && prev.entered > 0
                ? `${Math.round((s.entered / prev.entered) * 100)}% da anterior`
                : "";
            return (
              <tr key={`${s.stage_id}-sr`}>
                <th scope="row">{s.name}</th>
                <td>{s.entered.toLocaleString("pt-BR")}</td>
                <td>{pass}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProspectingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[148px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-card" />
    </div>
  );
}
