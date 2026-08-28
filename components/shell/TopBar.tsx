"use client";
import Link from "next/link";
import { Gear } from "@/lib/ui/icons";

import { AlertsBell } from "./AlertsBell";
import { MencoesBell } from "./MencoesBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";
import { TodayDate } from "./TodayDate";

/**
 * TopBar — busca à esquerda, data ao centro, controles circulares à direita.
 *
 * `h-14` casa com a altura do cabeçalho da Sidebar, para a régua do topo
 * atravessar a tela sem degrau. O fundo é `bg-bg` (o mesmo da página), e não
 * `bg-surface`: no escuro a topbar não é um card, é o topo da página — pintá-la
 * de surface criaria uma faixa que compete com o primeiro card do conteúdo.
 * Quem a separa é a borda de baixo.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-bg/95 px-4 backdrop-blur md:px-6">
      <div className="flex flex-1 items-center gap-3">
        <SearchTrigger />
        <TenantSwitcher />
      </div>

      <TodayDate />

      <div className="flex flex-1 items-center justify-end gap-2">
        <Link
          href="/app/settings"
          aria-label="Configurações"
          className="hidden h-9 w-9 items-center justify-center rounded-pill border border-border text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text sm:inline-flex"
        >
          <Gear size={18} aria-hidden />
        </Link>
        <MencoesBell />
        <AlertsBell />
        <UserMenu />
      </div>
    </header>
  );
}
