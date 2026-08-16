"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Kanban, Users, UsersThree, Gear, CaretDoubleLeft, CaretDoubleRight, CaretDown, Inbox, ScalesSimple, Robot, Brain, PlugsConnected, ChartBar, ChartLineUp, WebhooksLogo, FlowArrow, FileText, ClockCountdown, PuzzlePiece, Signpost, Sparkle, Gauge, Target, VideoCamera, Checks } from "@/lib/ui/icons";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toggleSidebar } from "@/app/actions/shell/toggleSidebar";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { ConnectionHealthDot } from "@/components/connections/ConnectionHealthDot";
import { TarefasBadge } from "@/components/tarefas/TarefasBadge";
import { branding } from "@/lib/branding";

type NavSection = "CRM" | "IA" | "Gestão";

interface NavItem {
  href: string;
  label: string;
  icon: PhosphorIcon;
  permission?: string;
  healthDot?: boolean;
  /** Contador de tarefas vencidas (0101) — ver components/tarefas/TarefasBadge. */
  tarefasBadge?: boolean;
  /**
   * Grupo no menu (redesign 2026-08). Sem `section` = topo solto. A lista
   * continua UMA só — `useVisibleNavItems` e a MobileNav não mudam; o
   * agrupamento é só apresentação do rail.
   */
  section?: NavSection;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/app/dashboard", label: "Painel", icon: Gauge },
  // NEXO IA — preenche o CRM com dados fictícios para avaliar o produto cheio.
  // No topo de propósito, pra ficar visível durante a avaliação. Remover junto
  // com app/app/demo-nexo/ e lib/nexo-demo/ quando não precisar mais.
  { href: "/app/demo-nexo", label: "Demonstração", icon: Sparkle },

  { href: "/app/inbox", label: "Inbox", icon: Inbox, section: "CRM" },
  // Tarefas (0101) logo abaixo do Inbox porque é de lá que quase toda tarefa
  // nasce — o relógio do cabeçalho da conversa — e é aqui que se confere se o
  // combinado aconteceu.
  { href: "/app/tarefas", label: "Tarefas", icon: Checks, tarefasBadge: true, section: "CRM" },
  { href: "/app/leads", label: "Negócios", icon: Target, section: "CRM" },
  { href: "/app/kanban", label: "Kanban", icon: Kanban, section: "CRM" },
  { href: "/app/contacts", label: "Contatos", icon: Users, section: "CRM" },
  { href: "/app/radar", label: "Radar", icon: ClockCountdown, section: "CRM" },
  // Sala de Reuniões (0098) — transcrições, coaching e métricas do copiloto do
  // Meet. Perto de Negócios de propósito: reunião é o momento decisivo do funil.
  { href: "/app/sala-de-reunioes", label: "Sala de Reuniões", icon: VideoCamera, section: "CRM" },

  { href: "/app/ai/agents", label: "Agentes IA", icon: Robot, permission: "ai.agents.view", section: "IA" },
  { href: "/app/ai/routers", label: "Roteadores", icon: Signpost, permission: "ai.routers.view", section: "IA" },
  { href: "/app/ai/followups", label: "Follow-ups", icon: FlowArrow, permission: "ai.agents.view", section: "IA" },
  { href: "/app/ai/memory", label: "Memória da IA", icon: Brain, permission: "ai.memory.view", section: "IA" },
  { href: "/app/ai/skills", label: "Skills da IA", icon: PuzzlePiece, permission: "ai.skills.view", section: "IA" },
  { href: "/app/ai/evolution", label: "Evolução da IA", icon: ChartLineUp, permission: "ai.evolution.view", section: "IA" },

  { href: "/app/team", label: "Equipe", icon: UsersThree, section: "Gestão" },
  { href: "/app/metrics", label: "Desempenho", icon: ChartBar, section: "Gestão" },
  { href: "/app/templates", label: "Templates", icon: FileText, section: "Gestão" },
  { href: "/app/connections", label: "Conexões", icon: PlugsConnected, healthDot: true, section: "Gestão" },
  { href: "/app/webhooks", label: "Webhooks", icon: WebhooksLogo, permission: "webhooks.manage", section: "Gestão" },
  { href: "/app/lgpd/requests", label: "LGPD", icon: ScalesSimple, permission: "lgpd.execute_redact", section: "Gestão" },
  { href: "/app/settings", label: "Configurações", icon: Gear, section: "Gestão" },
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
const NAV_SECTIONS_KEY = "deskcomm-nav-sections";

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const items = useVisibleNavItems();
  const brand = branding();

  // Grupos na ordem da lista. Seção cujos itens foram todos filtrados por
  // permissão simplesmente não entra — sem cabeçalho órfão.
  const groups = useMemo(() => {
    const acc: Array<{ section: NavSection | null; items: NavItem[] }> = [];
    for (const item of items) {
      const sec = item.section ?? null;
      const last = acc[acc.length - 1];
      if (last && last.section === sec) last.items.push(item);
      else acc.push({ section: sec, items: [item] });
    }
    return acc;
  }, [items]);

  // Colapso por seção, só no modo expandido. Carrega DEPOIS do mount para o
  // HTML do servidor (tudo aberto) bater com o primeiro render do cliente —
  // ler localStorage no initializer causaria hydration mismatch.
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAV_SECTIONS_KEY);
      if (raw) setClosedSections(JSON.parse(raw));
    } catch {
      // storage indisponível — seções ficam abertas.
    }
  }, []);

  function toggleSection(name: string) {
    setClosedSections((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      try {
        window.localStorage.setItem(NAV_SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface md:flex",
        "transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-60",
      )}
    >
      {/* Marca — a inicial no quadrado accent. No rail é só a inicial;
          expandido, o logo do tenant se houver. `h-14` casa com a altura da
          topbar para que a régua horizontal do topo atravesse a tela inteira
          sem degrau. */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
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
        {groups.map((group, gi) => {
          const containsActive = group.items.some((i) =>
            isNavItemActive(pathname, i.href),
          );
          // Seção com o item ATIVO nunca fica fechada: esconder o "você está
          // aqui" atrás de um colapso é pedir desorientação.
          const isClosed =
            group.section !== null &&
            !!closedSections[group.section] &&
            !containsActive;

          const renderedItems = group.items.map((item) => {
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
                  collapsed ? "h-11 w-11 justify-center" : "h-10 gap-3 px-3",
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
                {item.tarefasBadge && (
                  <TarefasBadge
                    className={cn(collapsed ? "absolute -right-0.5 -top-0.5" : "ml-auto")}
                  />
                )}
              </Link>
            );
          });

          return (
            <div key={group.section ?? `solto-${gi}`} className={gi > 0 ? "mt-2" : undefined}>
              {/* Rail: sem cabeçalho — um separador fino marca o grupo. */}
              {group.section && collapsed && (
                <div className="mx-2 mb-2 border-t border-border" aria-hidden />
              )}
              {group.section && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleSection(group.section as string)}
                  aria-expanded={!isClosed}
                  className={cn(
                    "flex h-7 w-full items-center justify-between rounded-control px-3",
                    "text-[11px] font-medium uppercase tracking-wide text-text-subtle",
                    "transition-colors duration-fast hover:text-text",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
                  )}
                >
                  {group.section}
                  <CaretDown
                    size={10}
                    className={cn("transition-transform duration-fast", isClosed && "-rotate-90")}
                    aria-hidden
                  />
                </button>
              )}
              {(collapsed || !isClosed) && (
                <div className="space-y-1">{renderedItems}</div>
              )}
            </div>
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
