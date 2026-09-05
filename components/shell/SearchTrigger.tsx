"use client";
import { useHotkeys } from "react-hotkeys-hook";
import { MagnifyingGlass } from "@/lib/ui/icons";

/**
 * Busca da topbar — com cara de campo (borda fina, fundo branco, atalho no
 * canto), porque é assim que se procura um campo de busca.
 *
 * É um <button> e não um <input> de propósito: ele abre a paleta de comandos
 * (Cmd+K), não digita no lugar. O `aria-label` diz "Buscar" e o elemento se
 * anuncia como botão para quem usa leitor de tela.
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
      className="inline-flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-text-subtle shadow-xs transition-colors duration-fast hover:border-border-strong hover:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:w-64"
    >
      <MagnifyingGlass size={16} aria-hidden />
      <span className="hidden md:inline">Buscar…</span>
      <kbd className="ml-auto hidden rounded-[4px] border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-subtle md:inline">
        ⌘K
      </kbd>
    </button>
  );
}
