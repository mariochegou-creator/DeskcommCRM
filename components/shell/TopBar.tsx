"use client";
import Link from "next/link";
import { Gear } from "@/lib/ui/icons";

import { cn } from "@/lib/utils";
import { AlertsBell } from "./AlertsBell";
import { MencoesBell } from "./MencoesBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";
import { TOPBAR_ICON_BUTTON } from "./icon-button";

/**
 * TopBar — busca à esquerda, controles à direita, nada no meio.
 *
 * `h-14` casa com a altura do cabeçalho da Sidebar, para a régua do topo
 * atravessar a tela sem degrau. O fundo é `bg-bg` translúcido com blur — a
 * topbar é o topo da página, não um card; quem a separa é a borda de baixo.
 *
 * A data saiu daqui (redesign 2026-09): ela mora na saudação do Painel, que é
 * onde alguém lê "que dia é hoje" junto com "o que eu faço hoje".
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SearchTrigger />
        <TenantSwitcher />
      </div>

      <div className="flex items-center gap-1">
        <Link
          href="/app/settings"
          aria-label="Configurações"
          className={cn(TOPBAR_ICON_BUTTON, "hidden sm:inline-flex")}
        >
          <Gear size={18} aria-hidden />
        </Link>
        <MencoesBell />
        <AlertsBell />
        <span aria-hidden className="mx-1.5 hidden h-5 w-px bg-border sm:block" />
        <UserMenu />
      </div>
    </header>
  );
}
