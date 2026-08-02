import * as React from "react";
import { ArrowUp, ArrowDown } from "@/lib/ui/icons";

import { cn } from "@/lib/utils";

/**
 * DeltaPill — variação percentual entre dois períodos, sempre em pill.
 *
 * Regra do sistema: TODA variação é pill (fundo translúcido + texto saturado),
 * nunca texto solto colorido. Fundo translúcido em vez de sólido porque o pill
 * aparece tanto sobre `surface` (#081422) quanto sobre o card ciano de
 * destaque — cor sólida teria que ser escolhida duas vezes; a translúcida
 * pega o fundo de baixo e funciona nos dois.
 *
 * SUBIR NÃO É BOM POR SI SÓ. "Negócios perdidos +30%" é uma piora, e pintar
 * essa seta de verde mente para quem bate o olho. Por isso a cor sai de
 * `intent`, e não do sinal do número:
 *   - "up-is-good" (padrão): receita, conversão, negócios ganhos
 *   - "up-is-bad": perdidos, tempo de resposta, churn, custo
 *   - "neutral": contagem sem juízo de valor
 * A SETA continua seguindo o número (↑ para positivo), porque ela informa
 * direção, não julgamento.
 */
export type DeltaIntent = "up-is-good" | "up-is-bad" | "neutral";

export interface DeltaPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Variação em pontos percentuais. Negativo = queda. */
  value: number;
  intent?: DeltaIntent;
  /** Rótulo lido por leitor de tela no lugar do "↑ 12,4%" cru. */
  srLabel?: string;
  /** Sobre o card de destaque (fundo ciano) as cores de estado se invertem. */
  onAccent?: boolean;
}

function toneFor(value: number, intent: DeltaIntent): "good" | "bad" | "flat" {
  // Zero é "sem mudança" e não merece cor de estado — verde em cima de 0,0%
  // sugere um ganho que não houve.
  if (value === 0) return "flat";
  if (intent === "neutral") return "flat";
  const rose = value > 0;
  const good = intent === "up-is-good" ? rose : !rose;
  return good ? "good" : "bad";
}

export function DeltaPill({
  value,
  intent = "up-is-good",
  srLabel,
  onAccent = false,
  className,
  ...props
}: DeltaPillProps) {
  const tone = toneFor(value, intent);
  const Arrow = value >= 0 ? ArrowUp : ArrowDown;

  // pt-BR: vírgula decimal e sinal explícito. `Math.abs` porque o sinal já é a
  // seta — "↓ -8,2%" leria como dupla negação.
  const formatted = `${Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5",
        "text-xs font-medium leading-5 tabular",
        onAccent
          ? // Sobre o accent sólido os tokens de estado (calibrados contra o
            // navy) perderiam contraste. Aqui o pill usa o par `-fg-*`, que
            // existe nos dois temas: no escuro é navy sobre ciano, no claro é
            // branco sobre teal. A legibilidade vem do fundo, não da matiz —
            // e é por isso que o pill de destaque NÃO distingue alta de queda
            // por cor: sobre o accent, a seta é que carrega a direção.
            "bg-accent-foreground-soft text-accent-foreground"
          : tone === "good"
            ? "bg-success-bg text-success-fg"
            : tone === "bad"
              ? "bg-error-bg text-error-fg"
              : "bg-surface-elevated text-text-muted",
        className,
      )}
      {...props}
    >
      <Arrow size={12} weight="bold" aria-hidden />
      <span aria-hidden>{formatted}</span>
      <span className="sr-only">
        {srLabel ?? `${value >= 0 ? "alta" : "queda"} de ${formatted}`}
      </span>
    </span>
  );
}
