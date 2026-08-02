"use client";
import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * BarChart — barras ciano de topo arredondado, grade horizontal quase
 * invisível, sem eixo X desenhado.
 *
 * Feito em CSS (flex + altura percentual) e NÃO em SVG com viewBox: para o
 * gráfico acompanhar a largura do card, um SVG precisaria de
 * `preserveAspectRatio="none"`, que estica o traço — e o raio de 6px do topo da
 * barra viraria uma elipse achatada em tela larga. Com caixas de CSS o raio é
 * sempre 6px de verdade, em qualquer largura, e ainda ganhamos foco de teclado
 * e tooltip sem matemática de coordenadas.
 *
 * O ciano aqui é permitido (o briefing lista "barras de gráfico" entre os usos
 * do accent) — é o dado que ele está pintando, não decoração.
 */
export interface BarDatum {
  /** Rótulo do eixo X: "Seg", "Jan", "S1"… */
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Formatação do valor no tooltip e no eixo Y. Padrão: pt-BR sem casas. */
  formatValue?: (value: number) => string;
  /** Altura da área de plotagem. O eixo X fica fora dela. */
  height?: number;
  /** Descrição para leitor de tela — o gráfico em si é `aria-hidden`. */
  caption: string;
  className?: string;
}

const defaultFormat = (v: number) => v.toLocaleString("pt-BR");

/**
 * Teto do eixo em número "redondo" acima do maior valor.
 *
 * Sem isto a barra mais alta encosta no topo do quadro e some contra a borda,
 * e cada refetch muda a escala — o gráfico "pula" sem que o dado tenha mudado
 * de forma. Arredondar para 1/2/5 × potência de dez mantém a escala estável
 * entre atualizações pequenas.
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
  height = 220,
  caption,
  className,
}: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const tableId = useId();

  const ceiling = useMemo(
    () => niceCeiling(Math.max(0, ...data.map((d) => d.value))),
    [data],
  );

  // Quatro faixas = cinco linhas (0 incluído). Mais que isso vira grade densa;
  // menos deixa de dar referência de leitura.
  const ticks = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((f) => ceiling * f).reverse(),
    [ceiling],
  );

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-text-muted">
        Sem dados no período.
      </p>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex gap-3" aria-hidden>
        {/* Eixo Y — rótulos pequenos, secundários, alinhados ao topo de cada
            linha de grade. `justify-between` sobre a MESMA altura da área de
            plotagem é o que mantém rótulo e linha na mesma régua. */}
        <div
          className="flex w-10 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-text-subtle tabular"
          style={{ height }}
        >
          {ticks.map((t, i) => (
            <span key={i}>{formatValue(Math.round(t))}</span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Grade: `chart-grid` é o próprio surface-elevated, então a linha
              some no fundo e só organiza o olho. */}
          <div
            className="absolute inset-0 flex flex-col justify-between"
            style={{ height }}
          >
            {ticks.map((_, i) => (
              <span key={i} className="h-px w-full bg-chart-grid" />
            ))}
          </div>

          {/* Barras. `items-end` para crescerem do chão para cima. */}
          <div
            className="relative flex items-end justify-between gap-2"
            style={{ height }}
          >
            {data.map((d, i) => {
              const pct = ceiling === 0 ? 0 : (d.value / ceiling) * 100;
              return (
                <div
                  key={`${d.label}-${i}`}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    className={cn(
                      "w-full max-w-[44px] rounded-t-[6px] bg-accent transition-opacity duration-fast",
                      hovered !== null && hovered !== i && "opacity-40",
                    )}
                    style={{
                      // `minHeight: 2` para o zero não sumir: uma barra de
                      // altura 0 é indistinguível de "esta categoria não
                      // existe", e as duas coisas são diferentes.
                      height: `${pct}%`,
                      minHeight: d.value > 0 ? 4 : 2,
                    }}
                  />
                  {hovered === i && (
                    <div className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-control bg-surface-elevated px-3 py-2 text-xs shadow-lg">
                      <span className="font-bold text-text tabular">
                        {formatValue(d.value)}
                      </span>
                      <span className="ml-2 text-text-muted">{d.label}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Eixo X: só os rótulos, SEM linha de base desenhada — a linha do
              zero da grade já é o chão. */}
          <div className="mt-3 flex justify-between gap-2">
            {data.map((d, i) => (
              <span
                key={`${d.label}-label-${i}`}
                className="min-w-0 flex-1 truncate text-center text-[10px] text-text-subtle"
              >
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* O gráfico é decoração para leitor de tela; o DADO é esta tabela.
          `sr-only` e não `display:none` — o segundo esconde de todo mundo,
          inclusive de quem depende dela. */}
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
