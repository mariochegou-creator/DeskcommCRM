"use client";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PERIOD_OPTIONS, type PeriodId } from "@/lib/dashboard/period";

/**
 * As três peças de composição do Painel (redesign 2026-09).
 *
 * `SectionHeading` abre uma seção da página (título + linha de apoio + ação
 * à direita). `CardHeading` faz o mesmo DENTRO de um card, um degrau menor.
 * `PeriodSegmented` é o seletor de período: quatro opções cabem numa régua
 * segmentada, e uma régua se lê inteira de relance — o dropdown escondia três
 * das quatro atrás de um clique.
 */

export function SectionHeading({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-text">
          {title}
        </h2>
        {subtitle && <p className="text-xs text-text-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-sm font-semibold leading-tight text-text">{title}</h3>
        {subtitle && <p className="text-xs text-text-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Rótulo curto de cada período — o longo (`PERIOD_OPTIONS`) fica no `title`. */
const SHORT_LABEL: Record<PeriodId, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Este mês",
  quarter: "Trimestre",
};

export function PeriodSegmented({
  value,
  onChange,
}: {
  value: PeriodId;
  onChange: (id: PeriodId) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="inline-flex h-9 items-center gap-0.5 rounded-control border border-border bg-surface p-0.5 shadow-xs"
    >
      {PERIOD_OPTIONS.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            title={opt.label}
            onClick={() => onChange(opt.id)}
            className={cn(
              "h-full rounded-[6px] px-3 text-xs font-medium transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
              // `bg-text`/`text-bg` invertem JUNTOS: grafite com texto claro no
              // claro, claro com texto grafite no escuro. Nenhum literal misturado.
              active
                ? "bg-text text-bg shadow-sm"
                : "text-text-muted hover:bg-surface-elevated hover:text-text",
            )}
          >
            {SHORT_LABEL[opt.id]}
          </button>
        );
      })}
    </div>
  );
}
