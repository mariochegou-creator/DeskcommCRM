"use client";
import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Sparkline — a linha de tendência miniatura que mora dentro de um StatCard.
 *
 * Um traço de 2px no accent, uma lavagem de área a ~15% que some até o chão e
 * o ponto final com anel na cor da superfície (para ler por cima da linha).
 * Sem eixo, sem grade, sem rótulo: o número grande ao lado é o rótulo. Ela
 * responde só "isso está subindo ou caindo?" — quem quer o valor de cada
 * ponto tem o gráfico de barras logo abaixo.
 *
 * Desenhada em px reais (não em `viewBox` esticado) para o traço ter sempre
 * 2px de verdade em qualquer largura.
 */
export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Descrição para leitor de tela. Sem ela o desenho é decorativo (`aria-hidden`). */
  label?: string;
}

export function Sparkline({
  data,
  width = 96,
  height = 32,
  className,
  label,
}: SparklineProps) {
  // `useId` traz caracteres que não servem em `url(#…)`; só letras e dígitos.
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  // Folga nas bordas para o ponto final (r=4) não ser cortado.
  const padX = 4;
  const padY = 5;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points = data.map((v, i) => ({
    x: padX + (i / (data.length - 1)) * innerW,
    y: padY + innerH - ((v - min) / span) * innerH,
  }));
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const floor = (height - padY).toFixed(1);
  const area = `${line} L${last.x.toFixed(1)} ${floor} L${first.x.toFixed(1)} ${floor} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last.x} cy={last.y} r="4.5" fill="var(--color-surface)" />
      <circle cx={last.x} cy={last.y} r="2.5" fill="var(--color-accent)" />
    </svg>
  );
}
