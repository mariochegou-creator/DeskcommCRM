"use client";
import { X } from "@/lib/ui/icons";

/**
 * Chips de filtro ativo — pill em `surface-elevated` com "×" para remover, mais
 * "Limpar tudo (n)".
 *
 * Existe porque filtro escondido dentro de um menu é a causa número um de
 * "sumiram meus negócios": a pessoa filtra, esquece, e a lista fica mentindo
 * pelo resto da sessão. O chip põe o filtro na tela, ao lado do resultado, e
 * torna desfazer um clique — não uma caça ao menu que o aplicou.
 */
export interface ActiveFilter {
  id: string;
  label: string;
  onRemove: () => void;
}

export function FilterChips({
  filters,
  onClearAll,
}: {
  filters: ActiveFilter[];
  onClearAll: () => void;
}) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-center gap-1.5 rounded-pill bg-surface-elevated py-1 pl-3 pr-1.5 text-xs text-text"
        >
          {f.label}
          <button
            type="button"
            onClick={f.onRemove}
            aria-label={`Remover filtro ${f.label}`}
            className="flex h-5 w-5 items-center justify-center rounded-pill text-text-muted transition-colors duration-fast hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <X size={11} weight="bold" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-accent transition-opacity duration-fast hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Limpar tudo ({filters.length})
      </button>
    </div>
  );
}
