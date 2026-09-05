"use client";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * SegmentedBar — a parte-do-todo deitada: uma barra fina dividida em fatias
 * (vão de 2px na cor da superfície entre elas) e a legenda logo abaixo com
 * nome, contagem e percentual.
 *
 * Substitui o donut no card-herói do Painel: numa coluna de 4/12 o anel
 * ficava do tamanho de uma moeda com a legenda espremida ao lado; a barra
 * usa a largura inteira e a legenda corre em linha. Passar o mouse numa fatia
 * ou numa entrada da legenda acende o par — a fatia é a cor, a legenda é o
 * nome; nenhum dos dois precisa ser lido sozinho.
 *
 * Cores na ORDEM FIXA da paleta de gráfico; com mais de 5 fatias a paleta
 * repete, então o chamador agrupa a cauda antes.
 */
export interface Segment {
  label: string;
  value: number;
}

export interface SegmentedBarProps {
  data: Segment[];
  /** Descrição para leitor de tela. */
  caption: string;
  className?: string;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function SegmentedBar({ data, caption, className }: SegmentedBarProps) {
  const [active, setActive] = useState<number | null>(null);
  const total = useMemo(() => data.reduce((a, d) => a + d.value, 0), [data]);

  if (total === 0) {
    return <p className="text-xs text-text-subtle">Sem negócios abertos agora.</p>;
  }

  const dim = (i: number) => active !== null && active !== i;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-pill"
        aria-hidden
      >
        {data.map((d, i) =>
          d.value > 0 ? (
            <div
              key={`${d.label}-${i}`}
              className={cn(
                "h-full min-w-[3px] transition-opacity duration-fast",
                dim(i) && "opacity-30",
              )}
              style={{
                width: `${(d.value / total) * 100}%`,
                backgroundColor: PALETTE[i % PALETTE.length],
              }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          ) : null,
        )}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-hidden>
        {data.map((d, i) => (
          <li
            key={`${d.label}-legend-${i}`}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-opacity duration-fast",
              dim(i) && "opacity-40",
            )}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-pill"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="text-text-muted">{d.label}</span>
            <span className="font-semibold text-text tabular">
              {d.value.toLocaleString("pt-BR")}
            </span>
            <span className="text-text-subtle tabular">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>

      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d, i) => (
            <tr key={`${d.label}-sr-${i}`}>
              <th scope="row">{d.label}</th>
              <td>{`${d.value} (${Math.round((d.value / total) * 100)}%)`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
