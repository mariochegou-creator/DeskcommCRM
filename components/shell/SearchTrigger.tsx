"use client";
import { useHotkeys } from "react-hotkeys-hook";
import { MagnifyingGlass } from "@/lib/ui/icons";

/**
 * Busca da topbar — pill sobre `surface-elevated`, SEM borda visível.
 *
 * É um <button> e não um <input> de propósito: ele abre a paleta de comandos
 * (Cmd+K), não digita no lugar. Campo que parece campo mas não aceita texto é
 * pior do que botão com cara de campo — por isso o `aria-label` diz "Buscar" e
 * o elemento se anuncia como botão para quem usa leitor de tela.
 */
export function SearchTrigger() {
  useHotkeys("mod+k", () => {
    // Placeholder; cmd-k palette comes in EPIC-03 / EPIC-12
    console.info("[search] Cmd+K trigger — UI not yet implemented");
  }, { preventDefault: true });

  return (
    <button
      type="button"
      aria-label="Buscar"
      className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-elevated px-4 text-sm text-text-muted transition-colors duration-fast hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:w-72"
    >
      <MagnifyingGlass size={16} aria-hidden />
      <span className="hidden md:inline">Buscar…</span>
      <kbd className="ml-auto hidden rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-subtle md:inline">
        ⌘K
      </kbd>
    </button>
  );
}
