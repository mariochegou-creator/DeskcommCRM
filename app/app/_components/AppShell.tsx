"use client";
import type { ReactNode } from "react";
import { LigacoesEmVooProvider } from "@/components/calls/LigacoesEmVoo";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileNav } from "@/components/shell/MobileNav";
import { TopBar } from "@/components/shell/TopBar";
import { cn } from "@/lib/utils";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

/**
 * AppShell — rail à esquerda no desktop, barra inferior no celular.
 *
 * A margem esquerda acompanha o rail (72px recolhido / 240px expandido) e só
 * existe a partir de `md`: abaixo disso a Sidebar não é renderizada e uma
 * margem fantasma comeria metade da tela do celular.
 *
 * `pb-20` no <main> reserva a faixa da MobileNav. Sem ele o último card de
 * cada página fica atrás da barra e não há como rolar até ele — o conteúdo
 * termina exatamente onde a barra começa.
 *
 * O `LigacoesEmVooProvider` envolve o shell INTEIRO, e não a tela de Ligações,
 * porque é justamente o ponto: quem acabou de desligar vai para o kanban, para
 * o inbox, para outro contato. Uma ligação sendo analisada tem de continuar
 * visível em qualquer uma dessas telas, senão a espera volta a prender o SDR
 * onde ela começou.
 */
export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  return (
    <LigacoesEmVooProvider>
      <div className="flex min-h-screen w-full bg-bg">
        <Sidebar collapsed={sidebarCollapsed} />
        <MobileNav />
        <div
          className={cn(
            "flex min-h-screen flex-1 flex-col transition-[margin] duration-200",
            sidebarCollapsed ? "md:ml-[72px]" : "md:ml-60",
          )}
        >
          <TopBar />
          <main className="flex-1 overflow-auto p-4 pb-20 md:p-6 md:pb-6">
            {children}
          </main>
        </div>
      </div>
    </LigacoesEmVooProvider>
  );
}
