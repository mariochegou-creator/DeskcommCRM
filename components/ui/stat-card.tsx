import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "@/lib/ui/icons";

import { cn } from "@/lib/utils";
import { DeltaPill, type DeltaIntent } from "@/components/ui/delta-pill";
import { Sparkline } from "@/components/charts/Sparkline";

/**
 * StatCard — o card de métrica do painel (redesign 2026-09).
 *
 * A hierarquia é por TAMANHO, não por cor: rótulo 13px secundário → valor 28px
 * primário → apoio 12px terciário. O valor usa algarismos PROPORCIONAIS (sem
 * `tabular`): em tamanho de display os dígitos de largura fixa deixam "121"
 * frouxo. Largura fixa é para coluna de tabela, não para número solto.
 *
 * ── `href` — o card inteiro é o link
 * Sem botão ↗ separado: o card todo vira alvo, a seta aparece no hover como
 * confirmação. Card sem `href` é só leitura e não sugere clique.
 *
 * ── `featured` — o card-herói
 * Um por tela. Valor a 40-44px e uma mancha de accent desfocada no canto —
 * a única cor grande da tela, e por isso ela destaca. Fundo continua branco:
 * um bloco azul sólido gritava mais que o número que devia carregar.
 *
 * ── `trend` — sparkline
 * Série curta (8-12 pontos) ao lado do valor. Diz só a direção; o gráfico
 * grande de baixo diz o valor de cada ponto.
 *
 * ── `variant="flat"`
 * Sem borda, sem fundo, sem sombra — para quando o card de FORA emoldura uma
 * grade de métricas com divisórias de 1px (o Plano 60 dias faz isso).
 */
export interface StatCardProps {
  /** Rótulo curto: "Valor do pipeline". */
  label: string;
  /** Já formatado para pt-BR pelo chamador — o card não sabe se é R$, % ou contagem. */
  value: string;
  /** Variação percentual vs. período anterior. Omitir quando não há base de comparação. */
  delta?: number;
  /** Ver DeltaIntent: define se subir é bom, ruim ou neutro nesta métrica. */
  deltaIntent?: DeltaIntent;
  /** Linha de apoio: "este mês vs. anterior". */
  hint?: string;
  /** Destino do card inteiro. Sem href o card não é clicável. */
  href?: string;
  /** O card-herói da tela. No máximo um. */
  featured?: boolean;
  /** Série curta para a sparkline ao lado do valor. */
  trend?: number[];
  variant?: "card" | "flat";
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  deltaIntent = "up-is-good",
  hint,
  href,
  featured = false,
  trend,
  variant = "card",
  className,
}: StatCardProps) {
  const interactive = Boolean(href);

  const classes = cn(
    "group relative flex flex-col justify-between gap-5 overflow-hidden text-text",
    variant === "card"
      ? "rounded-card border border-border bg-surface p-5 shadow-xs"
      : "justify-start gap-4 bg-surface p-5",
    interactive &&
      variant === "card" &&
      "transition-[border-color,box-shadow] duration-fast ease-out hover:border-border-strong hover:shadow-md",
    interactive &&
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    className,
  );

  const content = (
    <>
      {featured && (
        // A mancha usa `accent-soft`, que existe nos DOIS temas (hex no claro,
        // rgba no escuro). `accent-100` não serviria: é claro nos dois temas e
        // viraria um farol no grafite.
        <span
          aria-hidden
          className="pointer-events-none absolute -right-14 -top-14 h-48 w-48 rounded-full bg-accent-soft blur-3xl"
        />
      )}

      <div className="relative flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] font-medium text-text-muted">
          {featured && (
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
          )}
          {label}
        </span>
        {interactive && (
          <ArrowUpRight
            size={16}
            aria-hidden
            className="shrink-0 text-text-subtle opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </div>

      <div className="relative flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={cn(
                "font-semibold leading-none tracking-[-0.02em]",
                featured ? "text-[40px] sm:text-[44px]" : "text-[28px]",
              )}
            >
              {value}
            </span>
            {delta !== undefined && <DeltaPill value={delta} intent={deltaIntent} />}
          </div>
          {hint && <span className="text-xs text-text-subtle">{hint}</span>}
        </div>
        {trend && trend.length > 1 && <Sparkline data={trend} width={80} height={30} className="mb-0.5" />}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return <div className={classes}>{content}</div>;
}
