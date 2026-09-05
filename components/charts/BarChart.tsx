"use client";
import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * BarChart — colunas finas (≤ 24px) no accent, topo com raio de 4px e base
 * reta, grade de fio de cabelo, eixo X só com rótulos.
 *
 * Feito em CSS (flex + altura percentual) e NÃO em SVG com viewBox: para o
 * gráfico acompanhar a largura do card, um SVG precisaria de
 * `preserveAspectRatio="none"`, que estica o traço — e o raio do topo da barra
 * viraria uma elipse achatada em tela larga. Com caixas de CSS o raio é sempre
 * 4px de verdade, e ainda ganhamos foco de teclado e tooltip sem matemática.
 *
 * Rótulo direto SÓ na última coluna (o período corrente) — número em cima de
 * toda barra vira ruído e ninguém lê. As outras contam pelo tooltip (mouse ou
 * teclado) e pela tabela oculta que o leitor de tela recebe.
 */
export interface BarDatum {
  /** Rótulo do eixo X: "Seg", "Jan", "25/08"… */
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Formatação do valor no tooltip e no eixo Y. Padrão: pt-BR sem casas. */
  formatValue?: (value: number) => string;
  /** Altura da área de plotagem. O eixo X e o rótulo do topo ficam fora dela. */
  height?: number;
  /** Descrição para leitor de tela — o gráfico em si é `aria-hidden`. */
  caption: string;
  /** Escreve o valor em cima da última coluna quando nada está em foco. */
  labelLast?: boolean;
  className?: string;
}

const defaultFormat = (v: number) => v.toLocaleString("pt-BR");

/**
 * Teto do eixo em número "redondo" acima do maior valor.
 *
 * Sem isto a barra mais alta encosta no topo do quadro, e cada refetch muda a
 * escala — o gráfico "pula" sem que o dado tenha mudado de forma. Arredondar
 * para 1/2/5 × potência de dez mantém a escala estável entre atualizações.
 */
function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function BarChart({
  data,
  formatValue = defaultFormat,
  height = 200,
  caption,
  labelLast = true,
  className,
}: BarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  const ceiling = useMemo(
    () => niceCeiling(Math.max(0, ...data.map((d) => d.value))),
    [data],
  );

  // Quatro faixas = cinco linhas (0 incluído). Mais que isso vira grade densa;
  // menos deixa de dar referência de leitura.
  const ticks = useMemo(
    () => [1, 0.75, 0.5, 0.25, 0].map((f) => ceiling * f),
    [ceiling],
  );

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-text-muted">
        Sem dados no período.
      </p>
    );
  }

  const lastIndex = data.length - 1;

  return (
    <div className={cn("w-full", className)}>
      {/* `pt-6` reserva a faixa do rótulo em cima da coluna mais alta: uma
          coluna a 100% do teto escreveria o número fora do card. */}
      <div className="flex gap-3 pt-6" aria-hidden>
        {/* Eixo Y — `justify-between` sobre a MESMA altura da área de plotagem
            é o que mantém rótulo e linha na mesma régua. */}
        <div
          className="flex w-8 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-text-subtle tabular"
          style={{ height }}
        >
          {ticks.map((t, i) => (
            <span key={i}>{formatValue(Math.round(t))}</span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Grade: fio de cabelo um tom acima da superfície, só organiza o olho. */}
          <div
            className="absolute inset-x-0 top-0 flex flex-col justify-between"
            style={{ height }}
          >
            {ticks.map((_, i) => (
              <span key={i} className="h-px w-full bg-chart-grid" />
            ))}
          </div>

          <div
            className="relative flex items-end gap-1.5 sm:gap-2"
            style={{ height }}
          >
            {data.map((d, i) => {
              const pct = ceiling === 0 ? 0 : (d.value / ceiling) * 100;
              const isActive = active === i;
              const dimmed = active !== null && !isActive;
              const showCapLabel =
                labelLast && i === lastIndex && active === null && d.value > 0;
              return (
                <div
                  key={`${d.label}-${i}`}
                  tabIndex={0}
                  className="group relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  <div
                    className="relative w-full max-w-[24px]"
                    style={{
                      // `minHeight: 2` para o zero não sumir: barra de altura 0
                      // é indistinguível de "esta categoria não existe".
                      height: `${pct}%`,
                      minHeight: d.value > 0 ? 4 : 2,
                    }}
                  >
                    {showCapLabel && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold leading-none text-text tabular">
                        {formatValue(d.value)}
                      </span>
                    )}
                    <div
                      className={cn(
                        "h-full w-full rounded-t-[4px] transition-opacity duration-fast",
                        d.value > 0 ? "bg-accent" : "bg-border-strong",
                        dimmed && "opacity-35",
                      )}
                    />
                    {isActive && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-control bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-50 shadow-lg">
                        <span className="font-semibold tabular">{formatValue(d.value)}</span>
                        <span className="ml-1.5 text-neutral-200">{d.label}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Eixo X: só os rótulos, SEM linha de base desenhada — a linha do
              zero da grade já é o chão. O `gap` casa com o das colunas. */}
          <div className="mt-2.5 flex gap-1.5 sm:gap-2">
            {data.map((d, i) => (
              <span
                key={`${d.label}-label-${i}`}
                className={cn(
                  "min-w-0 flex-1 truncate text-center text-[10px] tabular",
                  active === i ? "font-semibold text-text" : "text-text-subtle",
                )}
              >
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* O gráfico é decoração para leitor de tela; o DADO é esta tabela.
          `sr-only` e não `display:none` — o segundo esconde de todo mundo. */}
      <table id={tableId} className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d, i) => (
            <tr key={`${d.label}-sr-${i}`}>
              <th scope="row">{d.label}</th>
              <td>{formatValue(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
