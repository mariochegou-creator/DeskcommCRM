"use client";
import { useEffect, useState } from "react";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useConversationTagVocabulary } from "@/hooks/inbox/useConversationTags";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import { useOrgStages } from "@/hooks/pipelines/useOrgStages";
import type { Role, VisibilityMode } from "@/lib/auth/types";
import type { OrgStage } from "@/lib/kanban/types";

export type InboxTab = "unassigned" | "mine" | "all" | "closed" | "ai";

const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: "unassigned", label: "Fila" },
  { value: "mine", label: "Minhas" },
  { value: "all", label: "Todas" },
  { value: "closed", label: "Fechadas" },
  { value: "ai", label: "IA" },
];

/**
 * Visões visíveis por papel + escopo (G4-02, acceptance 1). 'Todas' fica oculta
 * para `agent` quando visibility_mode ≠ 'all'; viewer/manager/admin sempre veem.
 * É apenas cosmético — a RLS (G4-01) é quem garante o escopo mesmo via ?filter=all.
 */
export function visibleInboxTabs(role: Role, mode: VisibilityMode | undefined): InboxTab[] {
  const hideAll = role === "agent" && mode !== "all";
  return INBOX_TABS.filter((t) => !(t.value === "all" && hideAll)).map((t) => t.value);
}

export interface InboxFiltersValue {
  tab: InboxTab;
  search: string;
  onlyUnread: boolean;
  channel_session_id?: string;
  tag?: string;
  /** Etapa do Kanban (crm_stages.id) — ver o join em conversations/_handler.ts. */
  stage_id?: string;
}

/**
 * Agrupa as etapas por funil PRESERVANDO a ordem em que chegaram — a rota já
 * devolve funil por funil, coluna por coluna. Reordenar aqui (por nome, por
 * exemplo) desalinharia o select do quadro que o usuário tem na cabeça.
 */
function porFunil(stages: OrgStage[]): Array<{ id: string; nome: string; etapas: OrgStage[] }> {
  const grupos: Array<{ id: string; nome: string; etapas: OrgStage[] }> = [];
  for (const s of stages) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.id === s.pipeline_id) ultimo.etapas.push(s);
    else grupos.push({ id: s.pipeline_id, nome: s.pipeline_name, etapas: [s] });
  }
  return grupos;
}

interface Props {
  value: InboxFiltersValue;
  onChange: (next: InboxFiltersValue) => void;
}

export function InboxFilters({ value, onChange }: Props) {
  const [searchInput, setSearchInput] = useState(value.search);
  const { data: channels } = useChannelSessions({ refetchInterval: 30_000 });
  const { activeOrg } = useAuth();
  const { data: tagVocabulary } = useConversationTagVocabulary(activeOrg?.orgId ?? null);
  const { data: counts } = useConversationCounts(activeOrg?.orgId ?? null);
  const { data: stages } = useOrgStages(activeOrg?.orgId ?? null);
  const gruposDeEtapa = porFunil(stages ?? []);

  const tabs = activeOrg
    ? visibleInboxTabs(activeOrg.role, activeOrg.visibility_mode)
    : INBOX_TABS.map((t) => t.value);
  const countFor: Partial<Record<InboxTab, number>> = {
    unassigned: counts?.unassigned,
    mine: counts?.mine,
    all: counts?.all,
  };
  // Alternador só aparece com 2+ números — com um só não há o que alternar.
  const showChannelSwitch = (channels?.length ?? 0) >= 2;

  // Debounce search input → propagate to parent.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== value.search) {
        onChange({ ...value, search: searchInput });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  return (
    <div className="space-y-3 border-b border-border bg-background px-3 py-3">
      <div className="relative">
        <MagnifyingGlass
          size={14}
          weight="regular"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar mensagens…"
          className="h-8 pl-8 text-sm"
          aria-label="Buscar conversas"
        />
      </div>

      {showChannelSwitch && (
        <Select
          value={value.channel_session_id ?? "all"}
          onValueChange={(v) =>
            onChange({ ...value, channel_session_id: v === "all" ? undefined : v })
          }
        >
          <SelectTrigger className="h-8 text-sm" aria-label="Filtrar por número de WhatsApp">
            <SelectValue placeholder="Todos os números" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os números</SelectItem>
            {channels?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.display_name || c.phone_number || c.waha_session_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {(tagVocabulary?.length ?? 0) > 0 && (
        <Select
          value={value.tag ?? "all"}
          onValueChange={(v) => onChange({ ...value, tag: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="h-8 text-sm" aria-label="Filtrar por tag">
            <SelectValue placeholder="Todas as tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as tags</SelectItem>
            {tagVocabulary?.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {gruposDeEtapa.length > 0 && (
        <Select
          value={value.stage_id ?? "all"}
          onValueChange={(v) => onChange({ ...value, stage_id: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="h-8 text-sm" aria-label="Filtrar por etapa do funil">
            <SelectValue placeholder="Todas as etapas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {gruposDeEtapa.map((g) => (
              <SelectGroup key={g.id}>
                {/* O nome do funil só aparece quando há mais de um — com um só
                    ele é ruído, e é o caso da maioria das orgs. */}
                {gruposDeEtapa.length > 1 && <SelectLabel>{g.nome}</SelectLabel>}
                {g.etapas.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      )}

      <Tabs
        value={value.tab}
        onValueChange={(v) => onChange({ ...value, tab: v as InboxTab })}
      >
        <TabsList
          className="grid h-8 w-full"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => {
            const meta = INBOX_TABS.find((t) => t.value === tab)!;
            const count = countFor[tab];
            return (
              <TabsTrigger key={tab} value={tab} className="gap-1 text-[11px]">
                {meta.label}
                {typeof count === "number" && count > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="flex items-center justify-between">
        <Label htmlFor="only-unread" className="text-xs text-muted-foreground">
          Apenas não lidos
        </Label>
        <Switch
          id="only-unread"
          checked={value.onlyUnread}
          onCheckedChange={(v) => onChange({ ...value, onlyUnread: v })}
        />
      </div>
    </div>
  );
}
