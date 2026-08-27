"use client";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Robot } from "@/lib/ui/icons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ChipsDeTag } from "@/components/tags/ChipsDeTag";
import { cn } from "@/lib/utils";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

interface Props {
  conversation: ConversationWithContact;
  isSelected: boolean;
  onSelect: (id: string) => void;
  /** Posição 1-based na fila (G5-03). Presente só na visão Fila. */
  queuePosition?: number;
}

/**
 * A bolinha no avatar quer dizer UMA coisa: "este lead falou e ninguém viu".
 *
 * Era colorida por STATUS da conversa (azul = `claimed`, roxo = `ai_handling`,
 * cinza = `open`), e isso mentia justamente na leitura de relance, que é como
 * a lista é usada: das 8 conversas `claimed` desta base, 7 não tinham UMA
 * mensagem por ler e mesmo assim apareciam marcadas de azul — enquanto 49
 * conversas `open` com mensagem do cliente esperando ficavam com o cinza
 * apagado. Marca no avatar é lida como "tem coisa nova aqui", e ela dizia
 * outra coisa.
 *
 * O status não some da tela: as abas (Fila / Minhas / Fechadas) recortam por
 * ele, e o robô ao lado do texto marca a conversa que a IA está tocando. O que
 * some é a legenda de cores que ninguém tinha para decorar.
 *
 * `unread_count_for_assignee` é o contador certo e se apaga sozinho:
 * `fn_mark_conversation_message` (migration 0099) soma no inbound e ZERA em
 * qualquer resposta — inclusive a digitada no celular do operador — e abrir a
 * conversa zera pelo handler de mensagens.
 */
const BOLINHA_NAO_LIDA = "bg-accent-500";

function initials(name: string | null | undefined, fallback: string): string {
  const v = (name ?? "").trim();
  if (!v) return fallback.slice(0, 2).toUpperCase();
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return format(d, "HH:mm");
  const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 7) return formatDistanceToNowStrict(d, { addSuffix: false, locale: ptBR });
  return format(d, "dd/MM");
}

/** "Aguardando há 5 min" — desde a última mensagem do cliente (fallback: criação). */
function waitingLabel(conversation: ConversationWithContact): string {
  const since = conversation.last_inbound_at ?? conversation.created_at;
  if (!since) return "Aguardando";
  return `Aguardando ${formatDistanceToNowStrict(new Date(since), { addSuffix: true, locale: ptBR })}`;
}

export function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
  queuePosition,
}: Props) {
  const c = conversation.contacts ?? null;
  // Grupo tem nome próprio. Sem esta linha ele apareceria com o nome do LEAD —
  // a mesma pessoa duas vezes na lista, uma delas sendo um grupo, sem nada que
  // distinga as duas. O `contact_id` do grupo é o do lead porque a coluna é
  // NOT NULL (ver `lib/agendamento/grupo-criar.ts`), não porque a conversa é dele.
  const nomeDoGrupo =
    conversation.is_group
      ? (typeof conversation.metadata?.group_name === "string"
          ? conversation.metadata.group_name.trim()
          : "") || "Grupo"
      : null;
  const displayName =
    nomeDoGrupo ||
    c?.display_name?.trim() ||
    c?.name?.trim() ||
    c?.phone_number ||
    "Sem nome";
  const phoneFallback = c?.phone_number ?? "??";
  const tags = c?.tags ?? [];
  const preview = conversation.last_message_preview?.trim() || "Sem mensagens";
  const truncated = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
  const time = relativeTime(conversation.last_message_at);
  const unread = conversation.unread_count_for_assignee ?? 0;
  const isAi = conversation.status === "ai_handling";
  // Conversa aberta na tela já está lida — o servidor zera no fetch, mas
  // esconder aqui evita a bolinha fantasma até o refetch chegar.
  const temNaoLida = unread > 0 && !isSelected;

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={cn(
        // `accent/40`/`accent/60` eram tinta translúcida calibrada pro ciano
        // sobre navy; com o azul do redesign sobre fundo claro viravam um
        // bloco saturado ilegível. Hover neutro, selecionado em `accent-soft`
        // — o mesmo par da tabela.
        "group flex w-full items-start gap-3 border-b border-border px-3 py-2 text-left transition-colors hover:bg-surface-elevated",
        isSelected && "bg-accent-soft hover:bg-accent-soft",
      )}
      aria-current={isSelected ? "true" : undefined}
    >
      <div className="relative shrink-0">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="text-xs">
            {initials(displayName, phoneFallback)}
          </AvatarFallback>
        </Avatar>
        {temNaoLida && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-background",
              BOLINHA_NAO_LIDA,
            )}
            aria-hidden
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {queuePosition !== undefined && (
          <div className="mb-1 flex items-center gap-1.5">
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-medium tabular-nums text-primary"
              aria-label={`Posição ${queuePosition} na fila`}
            >
              {queuePosition}º
            </span>
            <span className="text-[10px] text-muted-foreground">
              {waitingLabel(conversation)}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              c?.is_anonymized && "italic text-muted-foreground",
            )}
          >
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {time}
          </span>
        </div>

        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {isAi ? <Robot size={10} weight="duotone" className="mr-1 inline" aria-hidden /> : null}
          {truncated}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {/* A COR da tag é o pedido inteiro desta faixa (0105): a lista é
              varrida com o olho, e um chip cinza atrás do outro não distingue
              "Cliente" de "Não perturbar" sem parar para ler. O chip sabe casar
              o nome com o catálogo e cair para cinza no que não casa — texto
              livre e importação de prospecção continuam aparecendo. */}
          <ChipsDeTag nomes={tags} max={2} tamanho="xs" />
          {c?.is_blocked && (
            <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
              Bloqueado
            </Badge>
          )}
          {c?.is_anonymized && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              Anonimizado
            </Badge>
          )}
          {temNaoLida && (
            <Badge className="ml-auto h-4 min-w-4 px-1.5 text-[10px]">{unread}</Badge>
          )}
        </div>
      </div>
    </button>
  );
}
