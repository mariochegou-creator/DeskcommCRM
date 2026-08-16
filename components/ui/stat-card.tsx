import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "@/lib/ui/icons";

import { cn } from "@/lib/utils";
import { DeltaPill, type DeltaIntent } from "@/components/ui/delta-pill";

/**
 * StatCard — o card de métrica do painel, e o molde de que o resto da tela
 * herda a forma: raio 20px, borda de 1px, respiro de 24px, e o botão circular
 * ↗ no canto superior direito.
 *
 * A hierarquia é por TAMANHO, não por cor: rótulo 12px secundário → valor 32px
 * primário → apoio 12px secundário. Nenhum desses três é ciano. É o salto de
 * 12 para 32 que diz o que importa; se a cor tivesse que dizer, o card
 * pararia de funcionar no dia em que houvesse dois.
 *
 * ── `featured` — o card de destaque
 * Fundo ciano com texto navy. É o único bloco grande de ciano da tela e SÓ UM
 * card por tela pode tê-lo (a métrica principal). Dois cards em destaque não
 * destacam nada — viram um par, e o olho volta a ter que procurar.
 * O glow (`shadow-glow`, 6% de opacidade) só existe nesta variante.
 */
export interface StatCardProps {
  /** Rótulo curto: "Valor do pipeline". 12px, secundário. */
  label: string;
  /** Já formatado para pt-BR pelo chamador — o card não sabe se é R$, % ou contagem. */
  value: string;
  /** Variação percentual vs. período anterior. Omitir quando não há base de comparação. */
  delta?: number;
  /** Ver DeltaIntent: define se subir é bom, ruim ou neutro nesta métrica. */
  deltaIntent?: DeltaIntent;
  /** Linha de apoio: "este mês vs. anterior". */
  hint?: string;
  /** Destino do botão ↗. Sem href o botão não é renderizado — ver nota abaixo. */
  href?: string;
  /** O card de destaque da tela. No máximo um. */
  featured?: boolean;
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
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between gap-4 rounded-card border p-5",
        featured
          ? "border-transparent bg-accent text-accent-foreground shadow-glow"
          : "border-border bg-surface text-text",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <span
          className={cn(
            "text-xs font-medium",
            featured ? "text-accent-foreground-muted" : "text-text-muted",
          )}
        >
          {label}
        </span>

        {/* Botão ↗ — a assinatura do layout. Só aparece quando HÁ para onde ir:
            um botão presente em todo card mas inerte em metade deles ensina que
            ele não faz nada, e aí ele para de funcionar nos que fazem. */}
        {href && (
          <Link
            href={href}
            aria-label={`Abrir ${label}`}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border",
              "transition-colors duration-fast ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              featured
                ? // Inversão dupla: o fundo do botão é o próprio `accent-fg`
                  // (navy no escuro, branco no claro) e a seta é o `accent`.
                  // Escrever #050e1f aqui acertaria o escuro e deixaria o claro
                  // com um botão navy dentro de um card teal.
                  "border-transparent bg-accent-foreground text-accent hover:opacity-90 focus-visible:ring-accent-foreground focus-visible:ring-offset-accent"
                : "border-border text-text-muted hover:border-border-strong hover:text-text focus-visible:ring-accent-500 focus-visible:ring-offset-surface",
            )}
          >
            <ArrowUpRight size={16} aria-hidden />
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {/* -0.5px de tracking: em display o Inter abre demais e o número
              perde a leitura de bloco único. `tabular` trava a largura do
              dígito para a coluna não dançar a cada refetch. */}
          <span className="text-[28px] font-bold leading-none tracking-[-0.5px] tabular">
            {value}
          </span>
          {delta !== undefined && (
            <DeltaPill value={delta} intent={deltaIntent} onAccent={featured} />
          )}
        </div>
        {hint && (
          <span
            className={cn(
              "text-xs",
              featured ? "text-accent-foreground/70" : "text-text-subtle",
            )}
          >
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
