"use client";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

/**
 * DonutChart — anel de espessura média, fatias separadas por um vão pequeno,
 * percentual dentro da fatia e legenda à direita (bolinha de 8px + nome).
 *
 * Aqui SVG é o certo (ao contrário do BarChart): o desenho é radial, o
 * `viewBox` quadrado nunca distorce, e um arco em CSS exigiria máscaras
 * cônicas que não dão o vão entre fatias.
 *
 * As fatias saem da paleta de gráfico na ORDEM FIXA (ciano, azul, âmbar,
 * vermelho, verde). Com mais de 5 fatias a paleta se repete — por isso o
 * chamador deve agrupar a cauda em "Outros" antes de passar os dados: duas
 * fatias da mesma cor no mesmo anel é um gráfico que mente.
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
// anel, não da borda externa — o traço cresce metade para cada lado.
const R = 38;
const STROKE = 16;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** Vão entre fatias, em unidades de comprimento de arco. */
const GAP = 1.6;

export function DonutChart({
  data,
  caption,
  centerValue,
  centerLabel,
  className,
}: DonutChartProps) {
  const total = useMemo(() => data.reduce((a, d) => a + d.value, 0), [data]);

  const slices = useMemo(() => {
    const lengths = data.map((d) =>
      total === 0 ? 0 : (d.value / total) * CIRCUMFERENCE,
    );

    // Prefixos calculados em UM laço próprio, e não com um acumulador mutável
    // dentro do `.map` abaixo: reatribuir uma variável de fora dentro de um
    // callback é o padrão que o `react-hooks/immutability` proíbe, porque o
    // callback pode sobreviver ao render e ler um valor de outra passagem.
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
        // navegador renderiza como ANEL INTEIRO — uma fatia de 0,3% pintaria
        // o círculo todo.
        dash: Math.max(0, length - GAP),
        offset: -start,
        // Ângulo do meio da fatia, para posicionar o rótulo de percentual.
        midAngle: ((start + length / 2) / CIRCUMFERENCE) * 360 - 90,
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

  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="h-[180px] w-[180px]" aria-hidden>
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
                strokeWidth={STROKE}
                strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
                strokeDashoffset={s.offset}
              />
            ))}
          </g>
          {slices.map((s, i) => {
            // Só rotula fatia com folga para o texto caber dentro do traço.
            // Abaixo de ~7% o número encosta nas bordas do anel e fica ilegível
            // — a legenda continua dizendo quem é aquela fatia.
            if (s.fraction < 0.07) return null;
            const rad = (s.midAngle * Math.PI) / 180;
            return (
              <text
                key={`${s.label}-pct-${i}`}
                x={50 + R * Math.cos(rad)}
                y={50 + R * Math.sin(rad)}
                textAnchor="middle"
                dominantBaseline="central"
                className="text-[7px] font-semibold"
                fill="var(--chart-label)"
              >
                {Math.round(s.fraction * 100)}%
              </text>
            );
          })}
        </svg>

        {centerValue && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-xl font-bold leading-none text-text tabular">
              {centerValue}
            </span>
            {centerLabel && (
              <span className="text-[10px] text-text-muted">{centerLabel}</span>
            )}
          </div>
        )}
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-3">
        {slices.map((s, i) => (
          <li key={`${s.label}-legend-${i}`} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-pill"
              style={{ backgroundColor: s.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-text">
              {s.label}
            </span>
            <span className="shrink-0 text-[13px] text-text-muted tabular">
              {s.value.toLocaleString("pt-BR")}
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
