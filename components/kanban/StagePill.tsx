"use client";
import { CaretDown } from "@/lib/ui/icons";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Stage } from "@/lib/kanban/types";
import {
  STAGE_PILL_CLASS,
  STAGE_SOLID_VAR,
  openStagesOf,
  stageTone,
} from "@/lib/kanban/stage-tone";

/**
 * StagePill — a etapa do negócio como pill colorido.
 *
 * Fundo translúcido a 12% + texto na cor cheia. É o par que a regra do sistema
 * pede para TODO status, e o motivo de ser translúcido e não sólido é que o
 * mesmo pill aparece na linha da tabela (sobre `surface`) e no card de detalhe
 * (sobre `surface-elevated`): translúcido pega o fundo de baixo e serve os dois
 * sem escolher cor duas vezes.
 */
export function StagePill({
  stage,
  stages,
  className,
}: {
  stage: Stage;
  stages: Stage[];
  className?: string;
}) {
  const tone = stageTone(stage, openStagesOf(stages));
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-pill px-3 py-1 text-xs font-medium",
        STAGE_PILL_CLASS[tone],
        className,
      )}
    >
      <span className="truncate">{stage.name}</span>
    </span>
  );
}

/**
 * EditableStagePill — o mesmo pill, com caret ▾, editável ali mesmo.
 *
 * Mover de etapa é a ação mais frequente da lista, e mandar a pessoa abrir o
 * negócio para trocar um campo que ela já está lendo é o atrito que o Kanban
 * existe para evitar. O pill é o alvo: ele já diz onde o negócio está, então é
 * onde se espera clicar para mudar.
 *
 * A etapa ATUAL aparece no menu marcada e desabilitada, em vez de omitida: uma
 * lista que muda de tamanho conforme onde você está obriga a reler o menu toda
 * vez para achar o item — e some com a confirmação visual de onde você estava.
 */
export function EditableStagePill({
  stage,
  stages,
  onSelect,
  disabled = false,
  className,
}: {
  stage: Stage;
  stages: Stage[];
  onSelect: (stageId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const open = openStagesOf(stages);
  const tone = stageTone(stage, open);
  // Fechamento (ganho/perdido) entra no menu depois das abertas, na ordem do
  // funil — é para onde o negócio vai no fim.
  const selectable = [
    ...open,
    ...stages
      .filter((s) => (s.is_won || s.is_lost) && !s.is_archived)
      .sort((a, b) => a.position - b.position),
  ];

  if (disabled) {
    return <StagePill stage={stage} stages={stages} className={className} />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Etapa: ${stage.name}. Alterar`}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-pill px-3 py-1 text-xs font-medium",
            "transition-opacity duration-fast hover:opacity-80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            STAGE_PILL_CLASS[tone],
            className,
          )}
        >
          <span className="truncate">{stage.name}</span>
          <CaretDown size={10} weight="bold" aria-hidden className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {selectable.map((s) => {
          const isCurrent = s.id === stage.id;
          return (
            <DropdownMenuItem
              key={s.id}
              disabled={isCurrent}
              onClick={() => !isCurrent && onSelect(s.id)}
              className="flex items-center gap-2"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-pill"
                style={{
                  backgroundColor: STAGE_SOLID_VAR[stageTone(s, open)],
                }}
              />
              <span className="truncate">{s.name}</span>
              {isCurrent && (
                <span className="ml-auto shrink-0 text-xs text-text-subtle">
                  atual
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
