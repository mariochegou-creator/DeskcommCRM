"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DotsThree } from "@/lib/ui/icons";

import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useVisibleNavItems, isNavItemActive } from "./Sidebar";

/**
 * MobileNav — no celular o rail vira barra INFERIOR, na faixa que o polegar
 * alcança. Só aparece abaixo de `md`; acima disso quem navega é a Sidebar.
 *
 * Grafite como o rail (tokens `sidebar-*`, literais nos dois temas): a
 * navegação é a mesma peça nos dois tamanhos de tela, só muda de lugar.
 *
 * A barra mostra QUATRO destinos, não os dezoito. Dezoito ícones de 20px numa
 * tela de 360px dariam alvos de toque menores que o mínimo acessível (44px), e
 * cortar a lista em "os quatro primeiros do array" faria a navegação do celular
 * mudar toda vez que alguém reordenasse o menu do desktop. Por isso os quatro
 * são declarados aqui por href: são as telas de trabalho diário. O resto — e a
 * lista é sempre a lista INTEIRA, já filtrada por permissão — sai no "Mais".
 */
// Tarefas (0101) entrou no lugar de Contatos: no celular o que se faz é
// executar o combinado do dia — a busca de um contato específico continua a um
// toque, dentro do "Mais". Continuam sendo QUATRO pela razão acima.
const PRIMARY_HREFS = [
  "/app/dashboard",
  "/app/inbox",
  "/app/tarefas",
  "/app/leads",
] as const;

export function MobileNav() {
  const pathname = usePathname();
  const items = useVisibleNavItems();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = PRIMARY_HREFS.map((href) =>
    items.find((i) => i.href === href),
  ).filter((i): i is NonNullable<typeof i> => Boolean(i));

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-sidebar-border bg-sidebar md:hidden",
        // `pb-[env(safe-area-inset-bottom)]`: no iPhone a barra de gestos come
        // a faixa de baixo. Sem isto o último ícone fica sob a barra do sistema
        // e vira um alvo que não dá para tocar.
        "pb-[env(safe-area-inset-bottom)]",
      )}
      aria-label="Navegação principal"
    >
      {primary.map((item) => {
        const isActive = isNavItemActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium"
          >
            <span
              className={cn(
                "flex h-8 w-12 items-center justify-center rounded-pill transition-colors duration-fast",
                isActive ? "bg-sidebar-active text-sidebar-active-fg" : "text-sidebar-muted",
              )}
            >
              <Icon size={20} weight={isActive ? "fill" : "regular"} aria-hidden />
            </span>
            <span className={isActive ? "text-sidebar-fg" : "text-sidebar-muted"}>
              {item.label}
            </span>
          </Link>
        );
      })}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium text-sidebar-muted"
          >
            <span className="flex h-8 w-12 items-center justify-center rounded-pill">
              <DotsThree size={20} aria-hidden />
            </span>
            <span>Mais</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Navegação</SheetTitle>
          </SheetHeader>
          <ul className="mt-4 grid grid-cols-3 gap-2 pb-6">
            {items.map((item) => {
              const isActive = isNavItemActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex h-[86px] flex-col items-center justify-center gap-2 rounded-card border p-2 text-center text-[11px] font-medium transition-colors duration-fast",
                      isActive
                        ? "border-transparent bg-accent-soft text-accent"
                        : "border-border bg-surface text-text-muted hover:bg-surface-elevated",
                    )}
                  >
                    <Icon size={20} weight={isActive ? "fill" : "regular"} aria-hidden />
                    <span className="leading-tight">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
