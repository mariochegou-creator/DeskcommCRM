"use client";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * DonutChart — anel fino, fatias separadas por um vão de 2px na cor da
 * superfície, total no centro e legenda ao lado com contagem e percentual.
 *
 * Aqui SVG é o certo (ao contrário do BarChart): o desenho é radial, o
 * `viewBox` quadrado nunca distorce, e um arco em CSS exigiria máscaras
 * cônicas que não dão o vão entre fatias.
 *
 * Nenhum número é escrito DENTRO da fatia: a legenda é a leitura, e passar o
 * mouse (na fatia ou na linha da legenda) acende o par e escreve o valor no
 * centro do anel. As fatias saem da paleta de gráfico na ORDEM FIXA — com mais
 * de 5 a paleta repete, então o chamador agrupa a cauda em "Outros" antes.
 */
export interface DonutSlice {
  label: string;
  value: number;
}

export interface DonutChartProps {
  data: DonutSlice[];
  /** Descrição para leitor de tela. */
  caption: string;
  /** Texto grande no centro do anel (ex.: total). */
  centerValue?: string;
  centerLabel?: string;
  className?: string;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Geometria em unidades do viewBox (100×100). `R` é o raio da LINHA MÉDIA do
// anel — o traço cresce metade para cada lado.
const R = 40;
const STROKE = 11;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** Vão entre fatias, em unidades de comprimento de arco (~2px em 168px). */
const GAP = 1.9;

export function DonutChart({
  data,
  caption,
  centerValue,
  centerLabel,
  className,
}: DonutChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const total = useMemo(() => data.reduce((a, d) => a + d.value, 0), [data]);

  const slices = useMemo(() => {
    const lengths = data.map((d) =>
      total === 0 ? 0 : (d.value / total) * CIRCUMFERENCE,
    );
    const starts: number[] = [];
    let running = 0;
    for (const len of lengths) {
      starts.push(running);
      running += len;
    }
    return data.map((d, i) => {
      const length = lengths[i] ?? 0;
      const start = starts[i] ?? 0;
      return {
        ...d,
        color: PALETTE[i % PALETTE.length],
        fraction: total === 0 ? 0 : d.value / total,
        // `length - GAP` abre o vão comendo o FIM da fatia. Máximo com 0 para
        // uma fatia menor que o vão não virar dasharray negativo, que o
        // navegador renderiza como ANEL INTEIRO.
        dash: Math.max(0, length - GAP),
        offset: -start,
      };
    });
  }, [data, total]);

  if (total === 0) {
    return (
      <p className="py-10 text-center text-sm text-text-muted">
        Sem dados no período.
      </p>
    );
  }

  const highlighted = active !== null ? slices[active] : null;

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-5 sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="h-[168px] w-[168px]" aria-hidden>
          {/* `rotate(-90)` põe o zero no topo; sem isso a primeira fatia
              começaria às 3 horas, que é onde ninguém procura o começo. */}
          <g transform="rotate(-90 50 50)">
            {slices.map((s, i) => (
              <circle
                key={`${s.label}-${i}`}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={active === i ? STROKE + 2 : STROKE}
                strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
                strokeDashoffset={s.offset}
                opacity={active !== null && active !== i ? 0.3 : 1}
                className="transition-[opacity,stroke-width] duration-fast"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </g>
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
          {highlighted ? (
            <>
              <span className="text-2xl font-semibold leading-none tracking-[-0.02em] text-text">
                {highlighted.value.toLocaleString("pt-BR")}
              </span>
              <span className="line-clamp-2 text-[11px] leading-tight text-text-muted">
                {highlighted.label}
              </span>
            </>
          ) : (
            centerValue && (
              <>
                <span className="text-2xl font-semibold leading-none tracking-[-0.02em] text-text">
                  {centerValue}
                </span>
                {centerLabel && (
                  <span className="text-[11px] text-text-muted">{centerLabel}</span>
                )}
              </>
            )
          )}
        </div>
      </div>

      <ul className="flex w-full min-w-0 flex-1 flex-col gap-0.5">
        {slices.map((s, i) => (
          <li
            key={`${s.label}-legend-${i}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className={cn(
              "flex items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors duration-fast",
              active === i && "bg-surface-elevated",
            )}
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-pill"
              style={{ backgroundColor: s.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-text">
              {s.label}
            </span>
            <span className="shrink-0 text-[13px] font-medium text-text tabular">
              {s.value.toLocaleString("pt-BR")}
            </span>
            <span className="w-9 shrink-0 text-right text-xs text-text-subtle tabular">
              {Math.round(s.fraction * 100)}%
            </span>
          </li>
        ))}
      </ul>

      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {slices.map((s, i) => (
            <tr key={`${s.label}-sr-${i}`}>
              <th scope="row">{s.label}</th>
              <td>{`${s.value} (${Math.round(s.fraction * 100)}%)`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
