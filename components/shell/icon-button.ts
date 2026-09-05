/**
 * Classes dos controles da topbar (redesign 2026-09).
 *
 * Botão "fantasma": sem borda circular, só um quadrado macio que ganha fundo
 * no hover. Quatro círculos com borda enfileirados viravam uma moldura; agora
 * a topbar é silenciosa e o que chama atenção é o contador vermelho, que só
 * existe quando há o que ver.
 *
 * Constante compartilhada (e não componente) porque os três consumidores são
 * elementos diferentes — <Link>, <PopoverTrigger>, <button> — e um wrapper
 * teria de fingir cada um.
 */
export const TOPBAR_ICON_BUTTON =
  "relative inline-flex h-9 w-9 items-center justify-center rounded-control text-text-muted transition-colors duration-fast hover:bg-surface-elevated hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** O contador vermelho no canto do ícone. O anel na cor do fundo o descola do ícone. */
export const TOPBAR_BADGE =
  "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-bg";
