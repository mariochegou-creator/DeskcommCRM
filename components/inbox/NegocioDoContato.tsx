"use client";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagsEditor } from "@/components/ui/tags-editor";
import { AgendarReuniaoDialog } from "@/components/kanban/AgendarReuniaoDialog";
import { LeadDossier } from "@/components/kanban/LeadDossier";
import { OwnerBadge } from "@/components/kanban/OwnerBadge";
import { ScoreSlot } from "@/components/kanban/ScoreSlot";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useEditLead } from "@/hooks/kanban/useUpdateLead";
import { useMoveCard } from "@/hooks/kanban/useMoveCard";
import { tipoDeReuniaoDaEtapa } from "@/lib/agendamento/etapa";
import { lerReuniao, type Reuniao, type TipoDeReuniao } from "@/lib/agendamento/reuniao";
import { midpoint } from "@/lib/kanban/fractional-indexing";
import { resolveLeadOwner } from "@/lib/kanban/owner";
import type { Pipeline, StageComTopo } from "@/lib/kanban/types";
import { extractGoogleMapsUrl } from "@/lib/leads/ganchos";
import { MapPin, ArrowRight } from "@/lib/ui/icons";
import type { Lead } from "@/lib/types/leads";

interface Props {
  /** Negócios do contato, mais recente primeiro. Nunca vazio — o pai decide isso. */
  leads: Lead[];
  lead: Lead;
  onEscolher: (leadId: string) => void;
  stages: StageComTopo[];
  pipelines: Pipeline[];
}

function formatBRL(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const code = currency ?? "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

function dataCurta(iso: string | null): string | null {
  if (!iso) return null;
  const [ano, mes, dia] = iso.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/** As tags que o funil trata como canônicas — sugestão de um clique, nada mais. */
function tagsCanonicas(pipeline: Pipeline | undefined): string[] {
  const raw = pipeline?.settings?.canonical_tags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
}

/**
 * O negócio do contato, dentro do inbox — o mesmo que o card do Kanban mostra,
 * e mexível daqui.
 *
 * POR QUE EXISTE: quem atende via inbox estava atendendo às cegas. Etapa,
 * valor, responsável e probabilidade só existiam no board, então manter o funil
 * em dia custava trocar de tela no meio da conversa — e o que custa isso não é
 * feito. O painel mostrava só título e status do lead, o que é menos do que o
 * cartãozinho do quadro mostra de longe.
 *
 * **Não é uma segunda verdade sobre o negócio.** Etapa, dono e score saem das
 * MESMAS peças do board (`OwnerBadge`, `ScoreSlot`, `resolveLeadOwner`), as
 * mutações são os MESMOS hooks (`useMoveCard`, `useEditLead`) e o dossiê
 * completo é o MESMO componente (`LeadDossier`). Reescrever qualquer um deles
 * aqui produziria duas telas que discordam sobre o mesmo lead — que é o defeito
 * que este bloco veio corrigir, não um que ele pode se dar ao luxo de criar.
 *
 * Mover a etapa manda o negócio para o TOPO da coluna de destino, como o
 * arrasto entre colunas do board — e, se a coluna for de reunião marcada, abre
 * o mesmo diálogo de agendamento. Sem isso, mover pelo inbox pularia calado os
 * lembretes de véspera que existem para derrubar o no-show.
 */
export function NegocioDoContato({ leads, lead, onEscolher, stages, pipelines }: Props) {
  const [dossieAberto, setDossieAberto] = useState(false);
  /** O agendamento que a última mudança de etapa abriu (dia + hora da reunião). */
  const [agendar, setAgendar] = useState<{ tipo: TipoDeReuniao; atual: Reuniao | null } | null>(
    null,
  );

  const move = useMoveCard(lead.pipeline_id);
  const edit = useEditLead(lead.pipeline_id);
  const { data: members } = useAssignableMembers(true);
  const ownerNames = useMemo(
    () => new Map((members ?? []).map((m) => [m.user_id, m.full_name])),
    [members],
  );

  const doFunil = useMemo(
    () => stages.filter((s) => s.pipeline_id === lead.pipeline_id),
    [stages, lead.pipeline_id],
  );
  const etapaAtual = doFunil.find((s) => s.id === lead.stage_id) ?? null;
  const pipeline = pipelines.find((p) => p.id === lead.pipeline_id);
  const owner = resolveLeadOwner(lead, ownerNames);
  const mapsUrl = extractGoogleMapsUrl(lead.custom_fields);
  const fechamento = dataCurta(lead.expected_close_date);
  const ocupado = move.isPending || edit.isPending;

  function mover(stageId: string) {
    if (stageId === lead.stage_id) return;
    const destino = doFunil.find((s) => s.id === stageId);
    if (!destino) return;

    // Topo da coluna, como o arrasto entre colunas: o negócio que acabou de se
    // mover é justamente o que precisa ficar à vista de quem abrir o board.
    const posicao = midpoint(null, destino.top_position);
    if (Number.isNaN(posicao)) return;

    move.mutate(
      {
        leadId: lead.id,
        stageId,
        positionInStage: posicao,
        expectedUpdatedAt: lead.updated_at,
      },
      {
        onSuccess: () => {
          const tipo = tipoDeReuniaoDaEtapa(destino);
          if (tipo) setAgendar({ tipo, atual: lerReuniao(lead.custom_fields) });
        },
      },
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Negócio
        </h3>
        <button
          type="button"
          onClick={() => setDossieAberto(true)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Abrir dossiê
          <ArrowRight size={11} weight="regular" aria-hidden />
        </button>
      </div>

      <Card className="mt-2 space-y-2.5 p-3">
        {/* Um contato pode ter mais de um negócio aberto, e responder no inbox
            sem saber de QUAL deles se está falando é como o funil se desalinha.
            Com um só, o seletor não aparece — escolher entre uma coisa é ruído. */}
        {leads.length > 1 ? (
          <Select value={lead.id} onValueChange={onEscolher}>
            <SelectTrigger className="h-8 text-xs" aria-label="Escolher negócio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {leads.map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-sm font-medium leading-snug">{lead.title}</div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="font-medium tabular-nums">
            {formatBRL(lead.value_cents, lead.currency)}
          </span>
          {lead.score && (
            <ScoreSlot
              probability={lead.score.probability}
              band={lead.score.band}
              reason={lead.score.reason}
              factors={lead.score.factors.slice(0, 3)}
            />
          )}
        </div>

        <OwnerBadge
          ownerKind={owner.kind}
          ownerName={owner.name}
          agentVersion={owner.agentVersion}
        />

        {/* A etapa é um CONTROLE, não um rótulo: era a informação que obrigava a
            trocar de tela no meio do atendimento. */}
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Etapa do funil</span>
          {doFunil.length > 0 ? (
            <Select value={lead.stage_id} onValueChange={mover} disabled={ocupado}>
              <SelectTrigger className="h-8 text-xs" aria-label="Etapa do negócio">
                <SelectValue placeholder={etapaAtual?.name ?? "—"} />
              </SelectTrigger>
              <SelectContent>
                {doFunil.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">{etapaAtual?.name ?? "—"}</p>
          )}
        </div>

        {fechamento && (
          <div className="text-[11px] text-muted-foreground">
            Fechamento previsto: <span className="tabular-nums">{fechamento}</span>
          </div>
        )}

        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Tags do negócio</span>
          {/* As tags do NEGÓCIO, que são as do card do Kanban — não as da
              conversa, que ficam mais abaixo e servem ao atendimento. Os dois
              blocos usam o mesmo editor para não parecerem controles
              diferentes; o que muda é o dono da lista. */}
          <TagsEditor
            tags={lead.tags ?? []}
            alvo="ao negócio"
            vazio="Sem tags no negócio."
            sugestoes={tagsCanonicas(pipeline)}
            disabled={ocupado}
            onChange={(proximas) =>
              edit.mutate({ leadId: lead.id, patch: { tags: proximas } })
            }
          />
        </div>

        {mapsUrl && (
          <Button asChild size="sm" variant="outline" className="h-7 w-full gap-1.5 text-xs">
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
              <MapPin size={12} weight="fill" aria-hidden />
              Ver no Google Maps
            </a>
          </Button>
        )}
      </Card>

      {/* O dossiê inteiro (linha do tempo + campos) é o MESMO do board. O atalho
          "abrir conversa no inbox" fica de fora: aqui já se está nela. */}
      <LeadDossier
        open={dossieAberto}
        onOpenChange={setDossieAberto}
        lead={lead}
        pipelineId={lead.pipeline_id}
        stageName={etapaAtual?.name ?? "—"}
        ownerNames={ownerNames}
        esconderAtalhoDeConversa
      />

      {agendar && (
        <AgendarReuniaoDialog
          open
          onOpenChange={(v) => !v && setAgendar(null)}
          leadId={lead.id}
          leadTitulo={lead.title}
          pipelineId={lead.pipeline_id}
          tipo={agendar.tipo}
          reuniaoAtual={agendar.atual}
        />
      )}
    </section>
  );
}
