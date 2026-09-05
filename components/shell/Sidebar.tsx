"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Kanban, Users, UsersThree, Gear, CaretDoubleLeft, CaretDoubleRight, CaretDown, Inbox, ScalesSimple, Robot, Brain, PlugsConnected, ChartBar, ChartLineUp, WebhooksLogo, FlowArrow, FileText, ClockCountdown, PuzzlePiece, Signpost, Sparkle, Gauge, Target, VideoCamera, Checks, Phone, PaperPlaneTilt } from "@/lib/ui/icons";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { toggleSidebar } from "@/app/actions/shell/toggleSidebar";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { ConnectionHealthDot } from "@/components/connections/ConnectionHealthDot";
import { TarefasBadge } from "@/components/tarefas/TarefasBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  // Ligações (0100/0106) logo abaixo da Sala de Reuniões: são os dois lugares
  // onde a IA ouve uma conversa e devolve coaching. Sem esta entrada a análise
  // da ligação só existia dentro do contato, e quem coordena o time não acha
  // pelo caminho do contato — a pergunta dele é "como foram as ligações".
  { href: "/app/calls", label: "Ligações", icon: Phone, section: "CRM" },

  { href: "/app/ai/agents", label: "Agentes IA", icon: Robot, permission: "ai.agents.view", section: "IA" },
  { href: "/app/ai/routers", label: "Roteadores", icon: Signpost, permission: "ai.routers.view", section: "IA" },
  { href: "/app/ai/followups", label: "Follow-ups", icon: FlowArrow, permission: "ai.agents.view", section: "IA" },
  { href: "/app/ai/memory", label: "Memória da IA", icon: Brain, permission: "ai.memory.view", section: "IA" },
  { href: "/app/ai/skills", label: "Skills da IA", icon: PuzzlePiece, permission: "ai.skills.view", section: "IA" },
  { href: "/app/ai/evolution", label: "Evolução da IA", icon: ChartLineUp, permission: "ai.evolution.view", section: "IA" },

  // Disparos (0108) no topo da Gestão: é a operação com maior alcance e maior
  // risco do produto (uma campanha fala com centenas de leads pelo número da
  // empresa), e quem opera precisa achar o botão de pausar sem procurar.
  { href: "/app/disparos", label: "Disparos", icon: PaperPlaneTilt, section: "Gestão" },
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
 * Sidebar — o rail de navegação (redesign 2026-09).
 *
 * O estado PADRÃO é o rail de 72px só com ícone (ver app/app/layout.tsx: o
 * cookie precisa dizer "0" explicitamente para expandir). No rail cada item
 * ganha um tooltip à direita com o nome — 20 destinos sem rótulo é muita coisa
 * para memorizar por desenho, e o tooltip resolve isso sem obrigar a expandir.
 *
 * Item ativo = fundo `accent-soft` com ícone preenchido em `accent`. É o
 * "você está aqui" em tinta leve: o quadrado azul sólido de antes competia com
 * o card-herói do Painel e com o botão primário de cada tela, e três coisas
 * azuis sólidas na mesma vista fazem nenhuma delas ser a principal.
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
      {/* Marca — a inicial no quadrado accent e, expandido, o nome ao lado.
          `h-14` casa com a altura da topbar para que a régua horizontal do
          topo atravesse a tela inteira sem degrau. */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center",
          collapsed ? "justify-center" : "gap-2.5 px-4",
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
        ) : (
          <>
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent text-sm font-bold text-accent-foreground shadow-sm"
            >
              {brand.initial}
            </span>
            {!collapsed && (
              <span className="truncate text-[15px] font-semibold tracking-tight text-text">
                {brand.name}
              </span>
            )}
          </>
        )}
        {collapsed && <span className="sr-only">{brand.name}</span>}
      </div>

      {/* `min-h-0` + `overflow-y-auto` porque o <aside> tem a altura da janela e
          a lista passa de 18 itens. Sem isso, em tela de notebook os últimos
          ficam cortados e inalcançáveis — sem rolagem e sem aviso. (`min-h-0` é
          obrigatório: item de flex-column não encolhe abaixo do conteúdo.) */}
      <TooltipProvider delayDuration={120}>
        <nav
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1"
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
              const link = (
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex items-center rounded-control text-[13px] font-medium transition-colors duration-fast ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    isActive
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-elevated hover:text-text",
                    collapsed ? "mx-auto h-10 w-10 justify-center" : "h-9 gap-2.5 px-2.5",
                  )}
                >
                  <Icon
                    size={20}
                    weight={isActive ? "fill" : "regular"}
                    aria-hidden
                    className="shrink-0"
                  />
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <span className="truncate">{item.label}</span>
                  )}
                  {item.healthDot && (
                    <ConnectionHealthDot
                      className={cn(collapsed ? "absolute right-1.5 top-1.5" : "ml-auto")}
                    />
                  )}
                  {item.tarefasBadge && (
                    <TarefasBadge
                      className={cn(collapsed ? "absolute -right-0.5 -top-0.5" : "ml-auto")}
                    />
                  )}
                </Link>
              );

              if (!collapsed) {
                return <div key={item.href}>{link}</div>;
              }
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            });

            return (
              <div
                key={group.section ?? `solto-${gi}`}
                className={cn(
                  gi > 0 && (collapsed ? "mt-2 border-t border-border pt-2" : "mt-4"),
                )}
              >
                {group.section && !collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleSection(group.section as string)}
                    aria-expanded={!isClosed}
                    className={cn(
                      "mb-1 flex h-6 w-full items-center justify-between rounded-control px-2.5",
                      "text-[11px] font-semibold uppercase tracking-[0.08em] text-text-subtle",
                      "transition-colors duration-fast hover:text-text-muted",
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
                  <div className="flex flex-col gap-0.5">{renderedItems}</div>
                )}
              </div>
            );
          })}
        </nav>
      </TooltipProvider>

      <div className="shrink-0 border-t border-border p-3">
        <button
          type="button"
          onClick={() => startTransition(() => toggleSidebar(collapsed))}
          disabled={isPending}
          className={cn(
            "flex items-center rounded-control text-xs font-medium text-text-muted transition-colors duration-fast",
            "hover:bg-surface-elevated hover:text-text",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            "disabled:pointer-events-none disabled:opacity-50",
            collapsed ? "mx-auto h-10 w-10 justify-center" : "h-9 w-full gap-2 px-2.5",
          )}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <CaretDoubleRight size={16} aria-hidden /> : <CaretDoubleLeft size={16} aria-hidden />}
          {!collapsed && <span>Recolher menu</span>}
        </button>
      </div>
    </aside>
  );
}
