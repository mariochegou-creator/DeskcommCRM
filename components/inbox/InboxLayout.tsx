"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import {
  useConversationsRealtime,
  type ConversationsFilters,
  type ConversationWithContact,
} from "@/hooks/inbox/useConversationsRealtime";
import { useConversation, isNotFound } from "@/hooks/inbox/useConversation";
import { CaretLeft } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { ConversationList } from "./ConversationList";
import {
  InboxFilters,
  visibleInboxTabs,
  type InboxFiltersValue,
  type InboxTab,
} from "./InboxFilters";
import { ChatThread } from "./ChatThread";
import { Composer, type ComposerHandle } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { NumeroDeSaida } from "./NumeroDeSaida";
import { RetentionNotice } from "./RetentionNotice";
import { CRMSidePanel } from "./CRMSidePanel";
import { InboxKeyboardShortcuts } from "./InboxKeyboardShortcuts";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";

function tabToFilter(tab: InboxFiltersValue["tab"]): Partial<ConversationsFilters> {
  switch (tab) {
    case "unassigned":
      return { assigned_to: "unassigned", status: "open" };
    case "mine":
      return { assigned_to: "me" };
    case "closed":
      return { status: "closed" };
    case "ai":
      return { status: "ai_handling" };
    case "all":
    default:
      return {};
  }
}

const FILTER_TABS: InboxTab[] = ["unassigned", "mine", "all", "closed", "ai"];

/**
 * Lê ?filter= (G4-02, deep-link). ?filter=all é HONRADO mesmo para agent — a
 * lista volta RLS-scoped (a tab só some cosmeticamente). O default é "all"
 * (comportamento WhatsApp: mais recente no topo) — exceto para quem não vê a
 * aba Todas, que cai na fila.
 */
function parseFilterParam(v: string | null, fallback: InboxTab): InboxTab {
  return v && FILTER_TABS.includes(v as InboxTab) ? (v as InboxTab) : fallback;
}

interface InboxLayoutProps {
  initialSelectedId?: string | null;
}

export function InboxLayout({ initialSelectedId = null }: InboxLayoutProps = {}) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId ?? null;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fallbackTab: InboxTab =
    !activeOrg || visibleInboxTabs(activeOrg.role, activeOrg.visibility_mode).includes("all")
      ? "all"
      : "unassigned";
  const tab = parseFilterParam(searchParams.get("filter"), fallbackTab);
  const channelParam = searchParams.get("channel") ?? undefined;
  const tagParam = searchParams.get("tag") ?? undefined;
  const stageParam = searchParams.get("stage") ?? undefined;

  // tab/número/tag/etapa vivem na URL (?filter=&channel=&tag=&stage=) —
  // sobrevivem ao botão voltar; busca e "não lidos" são estado local de sessão.
  const [aux, setAux] = useState<Pick<InboxFiltersValue, "search" | "onlyUnread">>({
    search: "",
    onlyUnread: false,
  });
  const filterValue: InboxFiltersValue = {
    tab,
    channel_session_id: channelParam,
    tag: tagParam,
    stage_id: stageParam,
    ...aux,
  };
  const setFilterValue = useCallback(
    (next: InboxFiltersValue) => {
      if (
        next.tab !== tab ||
        next.channel_session_id !== channelParam ||
        next.tag !== tagParam ||
        next.stage_id !== stageParam
      ) {
        const params = new URLSearchParams(searchParams);
        params.set("filter", next.tab);
        if (next.channel_session_id) params.set("channel", next.channel_session_id);
        else params.delete("channel");
        if (next.tag) params.set("tag", next.tag);
        else params.delete("tag");
        if (next.stage_id) params.set("stage", next.stage_id);
        else params.delete("stage");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
      setAux({ search: next.search, onlyUnread: next.onlyUnread });
    },
    [tab, channelParam, tagParam, stageParam, searchParams, router, pathname],
  );

  // Reentrada pelo menu chega em /app/inbox sem query — a URL só cobre o botão
  // voltar, então a última seleção (por org) fica também em sessionStorage.
  const restoredOrgRef = useRef<string | null>(null);
  useEffect(() => {
    if (!orgId || restoredOrgRef.current === orgId) return;
    restoredOrgRef.current = orgId;
    if (
      searchParams.get("filter") ||
      searchParams.get("channel") ||
      searchParams.get("tag") ||
      searchParams.get("stage")
    )
      return; // URL já traz filtros explícitos (deep-link) — respeita
    try {
      const raw = sessionStorage.getItem(`inbox-filters:${orgId}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        tab?: string;
        channel?: string | null;
        tag?: string | null;
        stage?: string | null;
      };
      const params = new URLSearchParams(searchParams);
      if (saved.tab && FILTER_TABS.includes(saved.tab as InboxTab))
        params.set("filter", saved.tab);
      if (saved.channel) params.set("channel", saved.channel);
      if (saved.tag) params.set("tag", saved.tag);
      if (saved.stage) params.set("stage", saved.stage);
      if (params.toString() !== searchParams.toString())
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    } catch {
      /* storage indisponível/corrompido — segue com defaults */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  useEffect(() => {
    if (!orgId || restoredOrgRef.current !== orgId) return;
    try {
      sessionStorage.setItem(
        `inbox-filters:${orgId}`,
        JSON.stringify({
          tab,
          channel: channelParam ?? null,
          tag: tagParam ?? null,
          stage: stageParam ?? null,
        }),
      );
    } catch {
      /* sem persistência */
    }
  }, [orgId, tab, channelParam, tagParam, stageParam]);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const composerRef = useRef<ComposerHandle | null>(null);

  const filters: ConversationsFilters = useMemo(
    () => ({
      ...tabToFilter(filterValue.tab),
      search: filterValue.search || undefined,
      channel_session_id: filterValue.channel_session_id,
      stage_id: filterValue.stage_id,
      tag: filterValue.tag,
    }),
    [
      filterValue.tab,
      filterValue.search,
      filterValue.channel_session_id,
      filterValue.stage_id,
      filterValue.tag,
    ],
  );

  const clientFilter = useMemo(
    () =>
      filterValue.onlyUnread
        ? (c: ConversationWithContact) => (c.unread_count_for_assignee ?? 0) > 0
        : undefined,
    [filterValue.onlyUnread],
  );

  // We need the selected conversation object for header / composer / side panel.
  // Source it from the same query the list uses to avoid an extra request.
  const listQ = useConversationsRealtime(filters, orgId, { comSeguranca: true });
  const inList = useMemo(() => {
    const all = listQ.data?.pages.flatMap((p) => p.data) ?? [];
    return all.find((c) => c.id === selectedId) ?? null;
  }, [listQ.data, selectedId]);

  // Deep-link para conversa fora do filtro atual (ou fora do escopo do agent):
  // busca única RLS-scoped. 404/vazio ⇒ inacessível ⇒ estado vazio claro (GAP D),
  // nunca stack trace. A RLS (G4-01) é quem garante o não-vazamento.
  const needsFetch = !!selectedId && !inList && !listQ.isLoading;
  const single = useConversation(selectedId, needsFetch);
  const selectedConversation: ConversationWithContact | null = inList ?? single.data ?? null;
  const selectionNotFound =
    needsFetch && !single.isPending && !single.data && isNotFound(single.error);

  const claim = useClaimConversation();
  const close = useCloseConversation();

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  // Celular: "voltar" é largar a conversa, não navegar. As duas colunas moram
  // na mesma rota; quem decide qual aparece é `selectedId`.
  const handleBack = useCallback(() => setSelectedId(null), []);
  const handleVisibleChange = useCallback((ids: string[]) => setVisibleIds(ids), []);
  const handleFocusReply = useCallback(() => composerRef.current?.focus(), []);
  const handleClaim = useCallback(() => {
    if (!selectedConversation) return;
    claim.mutate({
      conversation_id: selectedConversation.id,
      expected_assignee: selectedConversation.assigned_to_user_id,
    });
  }, [claim, selectedConversation]);
  const handleClose = useCallback(() => {
    if (!selectedConversation) return;
    close.mutate({ conversation_id: selectedConversation.id });
  }, [close, selectedConversation]);

  const lockedReason = selectedConversation?.contacts?.is_blocked
    ? "Contato bloqueado — envio de mensagens desabilitado."
    : selectedConversation?.contacts?.is_anonymized
      ? "Contato anonimizado — não é possível enviar mensagens."
      : selectedConversation?.status === "closed"
        ? "Conversa fechada — clique em Reabrir, no topo, para voltar a escrever."
        : null;

  return (
    /* A altura desconta a topbar (3.5rem) E o respiro do <main>: no celular
       p-4 em cima + pb-20 reservado para a barra inferior (9.5rem no total);
       no desktop p-6 dos dois lados (6.5rem). Sem esse desconto o composer
       nasce embaixo da barra de navegação e não há como rolar até ele.
       `dvh` e não `vh`: no Android a barra do Chrome some e volta, e com `vh`
       a conversa fica sempre uns 60px maior que a tela. */
    <div className="grid h-[calc(100dvh-9.5rem)] w-full grid-cols-1 grid-rows-1 md:h-[calc(100dvh-6.5rem)] md:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_320px]">
      <div
        className={cn(
          "flex h-full min-h-0 flex-col border-r border-border",
          // Mestre/detalhe: em 360px não cabem lista e conversa juntas — e
          // empilhadas a conversa nascia fora da tela, sem rolagem que a
          // alcançasse. Uma de cada vez; a partir de `md` voltam lado a lado.
          selectedId && "max-md:hidden",
        )}
      >
        <InboxFilters value={filterValue} onChange={setFilterValue} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationList
            filters={filters}
            orgId={orgId}
            selectedId={selectedId}
            onSelect={handleSelect}
            clientFilter={clientFilter}
            onVisibleChange={handleVisibleChange}
          />
        </div>
      </div>

      <div className={cn("flex h-full min-h-0 flex-col", !selectedId && "max-md:hidden")}>
        {/* Fica FORA do ramo de sucesso: se a conversa não carregar, o celular
            ainda precisa de uma saída de volta para a lista. */}
        {selectedId ? (
          <button
            type="button"
            onClick={handleBack}
            className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3 text-sm font-medium text-text-muted md:hidden"
          >
            <CaretLeft size={16} weight="bold" aria-hidden />
            Conversas
          </button>
        ) : null}
        {selectedConversation ? (
          <>
            <ConversationHeader conversation={selectedConversation} />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatThread
                conversationId={selectedConversation.id}
                contactId={selectedConversation.contacts?.id ?? null}
              />
            </div>
            <RetentionNotice conversationId={selectedConversation.id} />
            {/* Fica colado no composer porque é ali que a pergunta "por qual
                número isso vai sair?" aparece — no segundo antes de enviar. */}
            <NumeroDeSaida conversation={selectedConversation} onIrPara={handleSelect} />
            <Composer
              ref={composerRef}
              conversationId={selectedConversation.id}
              lockedReason={lockedReason}
              contactName={selectedConversation.contacts?.name ?? null}
            />
          </>
        ) : selectionNotFound ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Conversa não encontrada ou fora do seu acesso.
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Selecione uma conversa
          </div>
        )}
      </div>

      <div className="hidden h-full min-h-0 xl:block">
        <CRMSidePanel conversation={selectedConversation} />
      </div>

      <InboxKeyboardShortcuts
        visibleIds={visibleIds}
        selectedId={selectedId}
        onSelect={handleSelect}
        onFocusReply={handleFocusReply}
        onClaim={handleClaim}
        onClose={handleClose}
        onToggleHelp={() => setHelpOpen((v) => !v)}
      />
      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
