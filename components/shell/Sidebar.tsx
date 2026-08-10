"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { Kanban, Users, UsersThree, Gear, CaretDoubleLeft, CaretDoubleRight, Inbox, ScalesSimple, Robot, Brain, PlugsConnected, ChartBar, ChartLineUp, WebhooksLogo, FlowArrow, FileText, ClockCountdown, PuzzlePiece, Signpost, Sparkle, Gauge, Target, VideoCamera } from "@/lib/ui/icons";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toggleSidebar } from "@/app/actions/shell/toggleSidebar";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { ConnectionHealthDot } from "@/components/connections/ConnectionHealthDot";
import { branding } from "@/lib/branding";

interface NavItem {
  href: string;
  label: string;
  icon: PhosphorIcon;
  permission?: string;
  healthDot?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/app/dashboard", label: "Painel", icon: Gauge },
  // NEXO IA — preenche o CRM com dados fictícios para avaliar o produto cheio.
  // No topo de propósito, pra ficar visível durante a avaliação. Remover junto
  // com app/app/demo-nexo/ e lib/nexo-demo/ quando não precisar mais.
  { href: "/app/demo-nexo", label: "Demonstração", icon: Sparkle },
  { href: "/app/inbox", label: "Inbox", icon: Inbox },
  { href: "/app/leads", label: "Negócios", icon: Target },
  // Sala de Reuniões (0098) — transcrições, coaching e métricas do copiloto do
  // Meet. Perto de Negócios de propósito: reunião é o momento decisivo do funil.
  { href: "/app/sala-de-reunioes", label: "Sala de Reuniões", icon: VideoCamera },
  { href: "/app/radar", label: "Radar", icon: ClockCountdown },
  { href: "/app/connections", label: "Conexões", icon: PlugsConnected, healthDot: true },
  { href: "/app/kanban", label: "Kanban", icon: Kanban },
  { href: "/app/contacts", label: "Contatos", icon: Users },
  { href: "/app/team", label: "Equipe", icon: UsersThree },
  { href: "/app/metrics", label: "Desempenho", icon: ChartBar },
  { href: "/app/templates", label: "Templates", icon: FileText },
  { href: "/app/lgpd/requests", label: "LGPD", icon: ScalesSimple, permission: "lgpd.execute_redact" },
  { href: "/app/ai/agents", label: "Agentes IA", icon: Robot, permission: "ai.agents.view" },
  { href: "/app/ai/routers", label: "Roteadores", icon: Signpost, permission: "ai.routers.view" },
  { href: "/app/ai/followups", label: "Follow-ups", icon: FlowArrow, permission: "ai.agents.view" },
  { href: "/app/ai/memory", label: "Memória da IA", icon: Brain, permission: "ai.memory.view" },
  { href: "/app/ai/skills", label: "Skills da IA", icon: PuzzlePiece, permission: "ai.skills.view" },
  { href: "/app/ai/evolution", label: "Evolução da IA", icon: ChartLineUp, permission: "ai.evolution.view" },
  { href: "/app/webhooks", label: "Webhooks", icon: WebhooksLogo, permission: "webhooks.manage" },
  { href: "/app/settings", label: "Configurações", icon: Gear },
];

/**
 * Hook de visibilidade da navegação — a MESMA regra serve o rail do desktop e
 * a barra inferior do mobile. Duplicar a lista de `usePermission` nos dois
 * componentes faria um item aparecer no celular e sumir no desktop no dia em
 * que alguém acrescentasse uma permissão em só um dos dois.
 */
export function useVisibleNavItems(): NavItem[] {
  const canLgpd = usePermission("lgpd.execute_redact");
  const canAiAgents = usePermission("ai.agents.view");
  const canAiRouters = usePermission("ai.routers.view");
  const canAiMemory = usePermission("ai.memory.view");
  const canAiSkills = usePermission("ai.skills.view");
  const canAiEvolution = usePermission("ai.evolution.view");
  const canWebhooks = usePermission("webhooks.manage");

  return NAV_ITEMS.filter((item) => {
    if (item.permission === "lgpd.execute_redact") return canLgpd;
    if (item.permission === "ai.agents.view") return canAiAgents;
    if (item.permission === "ai.routers.view") return canAiRouters;
    if (item.permission === "ai.memory.view") return canAiMemory;
    if (item.permission === "ai.skills.view") return canAiSkills;
    if (item.permission === "ai.evolution.view") return canAiEvolution;
    if (item.permission === "webhooks.manage") return canWebhooks;
    return true;
  });
}

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Sidebar — o rail de ícones da identidade Nexo IA.
 *
 * O estado PADRÃO é o rail de 72px só com ícone (ver app/app/layout.tsx: o
 * cookie precisa dizer "0" explicitamente para expandir). O modo expandido de
 * 240px continua existindo porque é funcionalidade que já estava no produto e
 * porque 18 destinos sem rótulo é muita coisa para memorizar por desenho — quem
 * quiser os nomes, expande uma vez e o cookie lembra.
 *
 * Item ativo = quadrado ciano de raio 12px com o ícone em navy. É o único lugar
 * do app onde um ícone é preenchido: em todo o resto o peso é `regular`
 * (contorno fino). O preenchimento aqui não é decoração — é o que diz "você
 * está aqui" num rail onde não há texto para dizer isso.
 *
 * No mobile este componente não aparece: quem navega lá é a MobileNav (barra
 * inferior). Ver components/shell/MobileNav.tsx.
 */
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const items = useVisibleNavItems();
  const brand = branding();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface md:flex",
        "transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-60",
      )}
    >
      {/* Marca — o "N" ciano. No rail é só a inicial; expandido, o logo do
          tenant se houver. `h-16` casa com a altura da topbar para que a régua
          horizontal do topo atravesse a tela inteira sem degrau. */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "justify-start px-5",
        )}
      >
        {brand.logoUrl && !collapsed ? (
          // <img> em vez de next/image de propósito: a URL vem do .env de quem
          // hospeda, e next/image exige allowlist de domínios fechada em build —
          // a imagem pré-buildada rejeitaria o domínio do self-hoster.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt={brand.name}
            className="h-7 w-auto max-w-[10rem] object-contain"
          />
        ) : collapsed ? (
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-control bg-accent text-base font-bold text-accent-foreground"
          >
            {brand.initial}
          </span>
        ) : (
          <span className="text-base font-bold tracking-tight text-text">
            {brand.name}
          </span>
        )}
        {collapsed && <span className="sr-only">{brand.name}</span>}
      </div>

      {/* `min-h-0` + `overflow-y-auto` porque o <aside> tem a altura da janela e
          a lista passa de 18 itens. Sem isso, em tela de notebook os últimos
          ficam cortados e inalcançáveis — sem rolagem e sem aviso. (`min-h-0` é
          obrigatório: item de flex-column não encolhe abaixo do conteúdo.) */}
      <nav
        className={cn(
          "min-h-0 flex-1 space-y-1 overflow-y-auto py-4",
          collapsed ? "px-3" : "px-3",
        )}
        aria-label="Navegação principal"
      >
        {items.map((item) => {
          const isActive = isNavItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex items-center rounded-control text-sm transition-colors duration-fast ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-text-muted hover:bg-surface-elevated hover:text-text",
                collapsed ? "h-11 w-11 justify-center" : "h-11 gap-3 px-3",
              )}
            >
              <Icon size={20} weight={isActive ? "fill" : "regular"} aria-hidden />
              {collapsed ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
              {item.healthDot && (
                <ConnectionHealthDot
                  className={cn(collapsed ? "absolute right-1 top-1" : "ml-auto")}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <button
          type="button"
          onClick={() => startTransition(() => toggleSidebar(collapsed))}
          disabled={isPending}
          className={cn(
            "flex items-center rounded-control text-xs text-text-muted transition-colors duration-fast",
            "hover:bg-surface-elevated hover:text-text",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            "disabled:pointer-events-none disabled:opacity-50",
            collapsed ? "h-11 w-11 justify-center" : "h-11 w-full gap-2 px-3",
          )}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <CaretDoubleRight size={16} aria-hidden /> : <CaretDoubleLeft size={16} aria-hidden />}
          {!collapsed && <span>Recolher</span>}
        </button>
      </div>
    </aside>
  );
}
