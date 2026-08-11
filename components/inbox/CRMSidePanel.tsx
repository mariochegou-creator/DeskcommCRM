"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Receipt, ArrowRight } from "@/lib/ui/icons";
import { useCrmSummary } from "@/hooks/inbox/useCrmSummary";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { activityLabel, actorLabel, actorShape } from "@/lib/leads/activity-vocabulary";
import { extractExtras, extractGanchos } from "@/lib/leads/ganchos";
import { LeadExtrasList } from "@/components/leads/LeadExtrasList";
import { ConversationTagsEditor } from "./ConversationTagsEditor";
import { NegocioDoContato } from "./NegocioDoContato";
import { cn } from "@/lib/utils";

interface Props {
  conversation: ConversationWithContact | null;
}

function formatMoney(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const cur = currency ?? "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}

function shortDate(iso: string): string {
  return format(new Date(iso), "dd/MM/yy HH:mm", { locale: ptBR });
}

/**
 * O que cada seção mostra quando não tem lista para mostrar.
 *
 * Peça única porque são VÁRIAS seções tomando a MESMA decisão — e foi por essa
 * decisão viver repetida em três lugares que as três mentiam juntas.
 *
 * Fora do componente de propósito: declarada dentro do corpo, ela vira um tipo
 * novo a cada render e o React remonta a peça inteira. O linter reprovou, com
 * razão — e eu tinha notado o cheiro e seguido em frente.
 *
 * Erro sem saída também é beco, por isso o botão.
 */
function SemLista({
  vazio,
  erro,
  onTentarDeNovo,
}: {
  vazio: string;
  erro: boolean;
  onTentarDeNovo: () => void;
}) {
  if (!erro) return <p className="mt-2 text-xs text-muted-foreground">{vazio}</p>;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-error-fg">Não consegui ler estes dados.</p>
      <Button size="sm" variant="outline" onClick={onTentarDeNovo}>
        Tentar de novo
      </Button>
    </div>
  );
}

export function CRMSidePanel({ conversation }: Props) {
  const contact = conversation?.contacts ?? null;
  const contactId = contact?.id ?? null;

  /**
   * A leitura vive em react-query (ver o hook): mover a etapa ou trocar uma tag
   * pelo painel precisa REFAZER esta busca, e quem muta invalida pela chave.
   *
   * `isError` é o TERCEIRO ESTADO, e ele é o motivo de este painel existir do
   * jeito que existe: antes a falha de leitura era traduzida para lista vazia,
   * virando "Sem leads." — uma afirmação sobre o NEGÓCIO feita em cima de um
   * erro de permissão. Distinguir "não tem" de "não consegui ler" é a diferença
   * entre informar e mentir.
   */
  const resumo = useCrmSummary(contactId);
  const erro = resumo.isError;
  const carregando = !!contactId && resumo.isPending;

  const leads = useMemo(() => resumo.data?.leads ?? [], [resumo.data]);

  /**
   * Qual negócio o painel está mostrando. O padrão é o mais recente (a rota
   * ordena por `updated_at`).
   *
   * A escolha guarda DE QUEM ela é, e não só o id do negócio: sem o contato
   * junto, trocar de conversa herdaria a escolha da anterior e — no instante
   * entre a nova lista chegar e o efeito de limpeza rodar — o painel mostraria
   * o negócio de outra pessoa. Comparar aqui resolve na renderização, sem
   * efeito nenhum.
   */
  const [escolha, setEscolha] = useState<{ contato: string; lead: string } | null>(null);
  const escolhidoId = escolha?.contato === contactId ? escolha.lead : null;
  const lead = leads.find((l) => l.id === escolhidoId) ?? leads[0] ?? null;

  // O que o atendente precisa ler ANTES de responder: os ganchos vêm da lista
  // de prospecção importada e vivem nos custom_fields DO NEGÓCIO escolhido —
  // juntar os de vários leads misturaria a abertura de negócios distintos.
  const ganchos = useMemo(() => extractGanchos(lead?.custom_fields ?? null), [lead]);
  const extras = useMemo(() => extractExtras(lead?.custom_fields ?? null), [lead]);

  const tags = contact?.tags ?? [];
  const displayName =
    contact?.display_name?.trim() ||
    contact?.name?.trim() ||
    contact?.phone_number ||
    "—";

  if (!conversation) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-border p-4 text-center text-xs text-muted-foreground">
        Selecione uma conversa para ver detalhes do contato.
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contato
        </h3>
        <Card className="mt-2 space-y-2 p-3 text-sm">
          <div className="font-medium">{displayName}</div>
          {contact?.phone_number && (
            <div className="text-xs text-muted-foreground">{contact.phone_number}</div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {contactId && (
            <div className="pt-1">
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link href={`/app/contacts/${contactId}`}>
                  Ver contato
                  <ArrowRight size={12} className="ml-1" weight="regular" aria-hidden />
                </Link>
              </Button>
            </div>
          )}
        </Card>
      </section>

      <Separator />

      {/* O NEGÓCIO — etapa, valor, dono, probabilidade e tags, mexíveis daqui.
          Antes o painel mostrava título e status e nada mais, o que é menos do
          que o card do Kanban entrega de longe: manter o funil em dia custava
          trocar de tela no meio da conversa. */}
      <section>
        {carregando ? (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Negócio
            </h3>
            <Skeleton className="mt-2 h-40 w-full" />
          </>
        ) : lead ? (
          <NegocioDoContato
            leads={leads}
            lead={lead}
            onEscolher={(leadId) =>
              setEscolha(contactId ? { contato: contactId, lead: leadId } : null)
            }
            stages={resumo.data?.stages ?? []}
            pipelines={resumo.data?.pipelines ?? []}
          />
        ) : (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Negócio
            </h3>
            <SemLista
              vazio="Este contato não tem negócio no funil."
              erro={erro}
              onTentarDeNovo={() => void resumo.refetch()}
            />
          </>
        )}
      </section>

      {ganchos.length > 0 && (
        <>
          <Separator />
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ganchos de abertura
            </h3>
            {/* Âmbar como a nota interna do thread — mesmo significado: só o
                time vê, e é o que se lê antes de puxar a conversa. Sem estado
                vazio: gancho é enriquecimento da prospecção; a ausência não
                informa nada. */}
            <ul className="mt-2 space-y-1.5">
              {ganchos.map((g) => (
                <li
                  key={g}
                  className="whitespace-pre-wrap break-words rounded-md border border-warning/40 bg-warning-bg p-2 text-xs leading-snug text-warning-fg"
                >
                  {g}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {extras.length > 0 && (
        <>
          <Separator />
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Dossiê de prospecção
            </h3>
            {/* Sem estado vazio, como os ganchos: dossiê é enriquecimento da
                prospecção e a ausência não informa nada. */}
            <div className="mt-2">
              <LeadExtrasList extras={extras} dense />
            </div>
          </section>
        </>
      )}

      <Separator />

      <ConversationTagsEditor
        conversationId={conversation.id}
        orgId={conversation.organization_id}
        tags={conversation.tags ?? []}
      />

      <Separator />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pedidos recentes
        </h3>
        {carregando ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : resumo.data && resumo.data.orders.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {resumo.data.orders.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1 truncate font-medium">
                    <Receipt size={11} weight="regular" aria-hidden />
                    {o.external_id ?? o.id.slice(0, 8)}
                  </div>
                  <div className="text-muted-foreground">
                    {o.status ?? "—"} · {formatMoney(o.total_cents, o.currency)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SemLista
            vazio="Sem pedidos."
            erro={erro}
            onTentarDeNovo={() => void resumo.refetch()}
          />
        )}
      </section>

      <Separator />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Atividade
        </h3>
        {carregando ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : resumo.data && resumo.data.activities.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {resumo.data.activities.map((a) => (
              <li key={a.id} className="rounded-md border border-border p-2 text-xs">
                {/* Rótulo do vocabulário único (activity-vocabulary), nunca o
                    tipo cru: a tela e o banco divergiram justamente por manter
                    duas listas. Marcador por ator, forma e não cor (§5). */}
                <div className="flex items-center gap-1.5 font-medium">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0",
                      actorShape(a.actor_kind) === "filled" && "rounded-full bg-accent",
                      actorShape(a.actor_kind) === "ring" &&
                        "rounded-full border border-accent bg-surface",
                      actorShape(a.actor_kind) === "dashed" &&
                        "rounded-full border border-dashed border-border-strong",
                    )}
                    aria-hidden
                  />
                  {activityLabel(a.type)}
                </div>
                {a.reason && <div className="mt-0.5 truncate text-muted-foreground">{a.reason}</div>}
                <div className="text-muted-foreground">
                  {actorLabel(a.actor_kind)} · {shortDate(a.performed_at)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SemLista
            vazio="Sem atividade."
            erro={erro}
            onTentarDeNovo={() => void resumo.refetch()}
          />
        )}
      </section>
    </aside>
  );
}
