"use client";
import Link from "next/link";
import { CaretLeft, ChatCircle, MapPin, Users } from "@/lib/ui/icons";

import { useBoard } from "@/hooks/kanban/useBoard";
import { useMoveCard } from "@/hooks/kanban/useMoveCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MonoLabel } from "@/components/ui/mono-label";
import { EditableStagePill } from "@/components/kanban/StagePill";
import { OwnerBadge } from "@/components/kanban/OwnerBadge";
import { formatBRL } from "@/lib/dashboard/metrics";
import { extractExtras, extractGanchos, extractGoogleMapsUrl } from "@/lib/leads/ganchos";
import { LeadExtrasList } from "@/components/leads/LeadExtrasList";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Uma linha de "rótulo → valor" do painel de detalhes.
 *
 * Rótulo à esquerda em secundário, valor à direita em primário — a mesma
 * hierarquia por tamanho/peso dos cards de KPI, em escala de leitura.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <span className="min-w-0 text-right text-sm text-text">{children}</span>
    </div>
  );
}

export function LeadDetailClient({
  leadId,
  pipelineId,
}: {
  leadId: string;
  pipelineId: string;
}) {
  const board = useBoard(pipelineId);
  const move = useMoveCard(pipelineId);

  const lead = board.data?.leads.find((l) => l.id === leadId) ?? null;
  const stages = board.data?.stages ?? [];
  const stage = lead ? stages.find((s) => s.id === lead.stage_id) ?? null : null;

  if (board.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-[280px] rounded-card lg:col-span-2" />
          <Skeleton className="h-[280px] rounded-card" />
        </div>
      </div>
    );
  }

  // O board é a fonte, e ele traz o pipeline INTEIRO — se o negócio não está
  // aqui, ou ele foi arquivado/movido de pipeline enquanto a página estava
  // aberta, ou o filtro do servidor mudou. Um vazio explícito é melhor que uma
  // tela de campos em branco que parece um erro de carregamento.
  if (!lead || !stage) {
    return (
      <Card className="flex flex-col items-center gap-4 p-10 text-center">
        <p className="text-sm text-text-muted">
          Este negócio não está mais neste funil.
        </p>
        <Button asChild variant="secondary">
          <Link href="/app/leads">Voltar para Negócios</Link>
        </Button>
      </Card>
    );
  }

  const ownerName =
    lead.owner_kind === "ai" ? lead.owner_agent?.name ?? "Agente" : null;

  // Ganchos da lista de prospecção importada — é o que se lê ANTES de clicar
  // em Conversar, por isso o card vem primeiro na coluna lateral.
  const ganchos = extractGanchos(lead.custom_fields);
  const mapsUrl = extractGoogleMapsUrl(lead.custom_fields);
  // O resto do dossiê da prospecção (Dores, Score, Nota Google…) — tudo que a
  // importação gravou em custom_fields além dos ganchos e do link do Maps.
  const extras = extractExtras(lead.custom_fields);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/app/leads"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text"
        >
          <CaretLeft size={12} aria-hidden />
          Negócios
        </Link>

        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <MonoLabel>negócio</MonoLabel>
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.5px] text-text">
              {lead.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <EditableStagePill
                stage={stage}
                stages={stages}
                onSelect={(stageId) =>
                  move.mutate({
                    leadId: lead.id,
                    stageId,
                    positionInStage: 0,
                    expectedUpdatedAt: lead.updated_at,
                  })
                }
                disabled={move.isPending}
              />
              {lead.status === "won" && <Badge variant="success">Ganho</Badge>}
              {lead.status === "lost" && <Badge variant="error">Perdido</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {lead.contact_id && (
              <>
                <Button asChild variant="secondary" className="gap-2">
                  <Link href={`/app/contacts/${lead.contact_id}`}>
                    <Users size={16} aria-hidden />
                    Ver contato
                  </Link>
                </Button>
                <Button asChild className="gap-2">
                  <Link href="/app/inbox">
                    <ChatCircle size={16} aria-hidden />
                    Conversar
                  </Link>
                </Button>
              </>
            )}
            {/* Caminho de volta pro anúncio (custom_fields da importação) —
                é por aqui que se investiga número fora do WhatsApp. */}
            {mapsUrl && (
              <Button asChild variant="secondary" className="gap-2">
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                  <MapPin size={16} aria-hidden />
                  Ver no Google Maps
                </a>
              </Button>
            )}
          </div>
        </header>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-4 p-6 lg:col-span-2">
          <div className="flex flex-col gap-1">
            <MonoLabel>detalhes</MonoLabel>
            <h2 className="text-base font-semibold text-text">Dados do negócio</h2>
          </div>

          <div className="flex flex-col">
            <Field label="Valor">
              {lead.value_cents ? (
                <span className="text-base font-semibold tabular">
                  {formatBRL(lead.value_cents)}
                </span>
              ) : (
                <span className="text-text-subtle">Sem valor definido</span>
              )}
            </Field>
            <Field label="Responsável">
              <span className="inline-flex justify-end">
                <OwnerBadge
                  ownerKind={lead.owner_kind}
                  ownerName={ownerName}
                  agentVersion={lead.owner_agent?.version_number}
                />
              </span>
            </Field>
            <Field label="Criado em">{formatDate(lead.created_at)}</Field>
            <Field label="Última atividade">{formatDate(lead.last_activity_at)}</Field>
            <Field label="Previsão de fechamento">
              {formatDate(lead.expected_close_date)}
            </Field>
            {lead.closed_at && (
              <Field label="Fechado em">{formatDate(lead.closed_at)}</Field>
            )}
            {lead.lost_reason && (
              <Field label="Motivo da perda">{lead.lost_reason}</Field>
            )}
            <Field label="Origem">{lead.source || "—"}</Field>
          </div>

          {lead.description && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-xs text-text-muted">Descrição</span>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
                {lead.description}
              </p>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {ganchos.length > 0 && (
            <Card className="flex flex-col gap-3 border-warning/40 bg-warning-bg p-6">
              <MonoLabel>ganchos de abertura</MonoLabel>
              <ul className="flex flex-col gap-2">
                {ganchos.map((g) => (
                  <li
                    key={g}
                    className="whitespace-pre-wrap text-sm leading-relaxed text-warning-fg"
                  >
                    {g}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {extras.length > 0 && (
            <Card className="flex flex-col gap-3 p-6">
              <MonoLabel>dossiê de prospecção</MonoLabel>
              <LeadExtrasList extras={extras} />
            </Card>
          )}

          {lead.score && (
            <Card className="flex flex-col gap-3 p-6">
              <MonoLabel>score</MonoLabel>
              <div className="flex items-baseline gap-2">
                <span className="text-[32px] font-bold leading-none tracking-[-0.5px] text-text tabular">
                  {Math.round(lead.score.probability * 100)}%
                </span>
                <span className="text-xs text-text-muted">de chance</span>
              </div>
              <p className="text-sm leading-relaxed text-text-muted">
                {lead.score.reason}
              </p>
            </Card>
          )}

          {lead.next_action && (
            <Card className="flex flex-col gap-2 p-6">
              <MonoLabel>próxima ação</MonoLabel>
              <p className="text-sm leading-relaxed text-text">
                {lead.next_action.label}
              </p>
            </Card>
          )}

          {lead.tags.length > 0 && (
            <Card className="flex flex-col gap-3 p-6">
              <MonoLabel>tags</MonoLabel>
              <div className="flex flex-wrap gap-2">
                {lead.tags.map((t) => (
                  <Badge key={t} variant="neutral">
                    {t}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
