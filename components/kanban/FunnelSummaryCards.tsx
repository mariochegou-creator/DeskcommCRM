"use client";

import { cn } from "@/lib/utils";
import { DeltaPill } from "@/components/ui/delta-pill";
import { STAGE_SOLID_VAR, type StageTone } from "@/lib/kanban/stage-tone";

/**
 * Ondas decorativas do canto do header — o detalhe de marca do card de funil.
 *
 * `vectorEffect="non-scaling-stroke"` mantém o traço com 1px REAL mesmo com o
 * SVG esticado pelo `preserveAspectRatio="none"`; sem ele a onda engrossa junto
 * com a caixa e o detalhe fino vira um borrão. `opacity` baixa porque isto é
 * textura: se der para descrever a forma, está forte demais.
 */
function CornerWaves() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 48"
      preserveAspectRatio="none"
      className="pointer-events-none absolute right-0 top-0 h-full w-[120px] opacity-25"
    >
      {[0, 8, 16, 24].map((dy) => (
        <path
          key={dy}
          d={`M10 ${4 + dy} q 18 -8 36 0 t 36 0 t 36 0`}
          fill="none"
          stroke="var(--chart-label)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export interface FunnelStageSummary {
  stageId: string;
  name: string;
  tone: StageTone;
  count: number;
  /** Variação vs. período anterior. `undefined` = sem base de comparação. */
  delta?: number;
}

/**
 * FunnelSummaryCards — uma linha de cards, um por etapa, no topo da lista.
 *
 * Header na cor cheia da etapa com o nome em cima; corpo em `surface` com a
 * contagem grande. É o único lugar do sistema onde um bloco inteiro recebe cor
 * saturada, e ele cabe na regra do ciano escasso porque a cor aqui NÃO é o
 * accent — é o código de etapa, o mesmo que o pill da tabela usa. Ver o header
 * de lib/kanban/stage-tone.ts para por que o tom sai da semântica e não do nome.
 *
 * Mostra no máximo QUATRO etapas: a linha existe para dar o formato do funil de
 * relance, e oito cards de 25% de largura já não se leem de relance nenhum. O
 * chamador escolhe quais (ver `pickFunnelStages`).
 */
export function FunnelSummaryCards({
  stages,
  comparisonLabel = "vs. semana passada",
  className,
}: {
  stages: FunnelStageSummary[];
  comparisonLabel?: string;
  className?: string;
}) {
  if (stages.length === 0) return null;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {stages.slice(0, 4).map((s) => (
        <div
          key={s.stageId}
          className="overflow-hidden rounded-card border border-border bg-surface"
        >
          <div
            className="relative flex h-12 items-center px-5"
            style={{ backgroundColor: STAGE_SOLID_VAR[s.tone] }}
          >
            <CornerWaves />
            {/* `--chart-label` é o texto que vai SOBRE cor de série: navy no
                escuro, branco no claro. Fixar navy aqui deixaria o header do
                tema claro ilegível, porque lá os tons de etapa são escuros. */}
            <span
              className="relative truncate text-[13px] font-semibold"
              style={{ color: "var(--chart-label)" }}
            >
              {s.name}
            </span>
          </div>
          <div className="flex flex-col gap-2 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[28px] font-bold leading-none tracking-[-0.5px] text-text tabular">
                {s.count.toLocaleString("pt-BR")}
              </span>
              {s.delta !== undefined && (
                <DeltaPill
                  value={s.delta}
                  // Negócio parado numa etapa não é bom nem ruim por si: crescer
                  // "Proposta" pode ser pipeline saudável ou gargalo. Sem saber
                  // qual, o pill fica neutro — pintar de verde seria um juízo
                  // que o dado não sustenta.
                  intent="neutral"
                />
              )}
            </div>
            <span className="text-xs text-text-subtle">{comparisonLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
