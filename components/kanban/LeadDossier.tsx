"use client";
import { useRef } from "react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WhatsappLogo, ChatCircle, MapPin } from "@/lib/ui/icons";
import { extractGoogleMapsUrl } from "@/lib/leads/ganchos";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import { useContact } from "@/hooks/contacts/useContact";
import { useContactConversation } from "@/hooks/inbox/useContactConversation";
import { whatsappLink } from "@/lib/contacts/whatsapp";
import type { Lead } from "@/lib/types/leads";
import { LeadFieldsForm } from "./LeadFieldsForm";
import { ScoreSlot } from "./ScoreSlot";
import { LeadTimeline } from "./LeadTimeline";
import { OwnerBadge } from "./OwnerBadge";
import { resolveLeadOwner } from "@/lib/kanban/owner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
  stageName: string;
  ownerNames?: Map<string, string | null>;
}

function formatBRL(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency ?? "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

/**
 * O dossiê do negócio: cabeçalho vivo → timeline → campos.
 *
 * A ORDEM É a mudança em relação ao diálogo de edição: quem abre um lead quer
 * primeiro saber O QUE ACONTECEU, e só depois mexer. O formulário íntegro fica
 * por último, e o cabeçalho tem um atalho para ele — ordem preservada, custo de
 * rolagem resolvido.
 *
 * SALVAR NÃO FECHA. Quem edita precisa ver a atividade que acabou de gerar
 * entrar na timeline; fechar esconderia o registro justamente de quem o
 * produziu, e a funcionalidade que prova "sua ação fica registrada" provaria
 * isso para todo mundo menos para o autor.
 */
export function LeadDossier({
  open,
  onOpenChange,
  lead,
  pipelineId,
  stageName,
  ownerNames,
}: Props) {
  const campos = useRef<HTMLDivElement | null>(null);
  const timeline = useLeadTimeline(open ? lead.id : null, lead.contact_id);
  const owner = resolveLeadOwner(lead, ownerNames);
  const score = lead.score ?? null;

  // Só busca quando o dossiê está aberto E existe contato: lead sem contato é
  // estado legítimo (prospecção importada antes de alguém atender), e disparar
  // uma requisição por card do board para descobrir isso seria caro à toa.
  const contato = useContact(open && lead.contact_id ? lead.contact_id : "");
  const whatsapp = whatsappLink(contato.data?.data.phone_number);
  const mapsUrl = extractGoogleMapsUrl(lead.custom_fields);

  // O atendimento pertence ao inbox; o WhatsApp é só a porta de entrada quando
  // ela ainda não foi aberta. Conversa nasce de mensagem RECEBIDA, então um lead
  // importado não tem nenhuma até responder — daí o primeiro contato sair pelo
  // WhatsApp e todos os seguintes ficarem dentro do CRM, sem ninguém trocar nada.
  const conversa = useContactConversation(open && lead.contact_id ? lead.contact_id : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
        // Observável pelo mesmo motivo do board: "a assinatura morreu" e "nada
        // aconteceu" têm a mesma aparência, que é silêncio.
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        // Observável como no board: "a entrega morreu" e "nada aconteceu"
        // têm a mesma aparência, e no dossiê a segunda é ainda mais crível —
        // negócio sem novidade é um estado normal.
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base leading-6">{lead.title}</SheetTitle>
        </SheetHeader>

        {/* Conversar vem ANTES do resto: quem abre um lead de prospecção fria
            veio para falar com o negócio, não para ler o histórico — que num
            lead recém-importado está vazio de qualquer forma.

            DOIS destinos, e o rótulo diz qual: com conversa aberta o atendimento
            é no inbox (histórico, transferência, IA, tudo registrado); sem
            conversa, o WhatsApp é o único caminho que existe. O botão nunca
            promete o inbox quando ele ainda não tem nada para mostrar.

            O do WhatsApp só aparece com número utilizável: um botão sempre
            visível que às vezes não funciona treina o SDR a desconfiar dele, e
            aí ele para de usar o atalho justamente nos casos em que presta. */}
        {conversa.data ? (
          <Button asChild variant="primary" size="sm" className="mb-3 w-full gap-2">
            <Link href={`/app/inbox?id=${conversa.data.id}`}>
              <ChatCircle size={16} weight="fill" />
              Abrir conversa no inbox
            </Link>
          </Button>
        ) : (
          whatsapp && (
            <Button asChild variant="primary" size="sm" className="mb-3 w-full gap-2">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <WhatsappLogo size={16} weight="fill" />
                Iniciar no WhatsApp
              </a>
            </Button>
          )
        )}

        {/* O caminho de volta pro anúncio: quando o número não está no WhatsApp
            (Maps desatualizado acontece), é AQUI que o SDR investiga — sem este
            link ele tem que caçar o negócio no Google de novo. Vem da lista de
            prospecção (custom_fields), então só aparece quando existe. */}
        {mapsUrl && (
          <Button asChild variant="outline" size="sm" className="mb-3 w-full gap-2">
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
              <MapPin size={16} weight="fill" />
              Ver no Google Maps
            </a>
          </Button>
        )}

        {/* ① cabeçalho vivo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-3 text-xs">
          <span className="font-medium tabular-nums text-text">
            {formatBRL(lead.value_cents, lead.currency)}
          </span>
          <span className="text-text-muted">{stageName}</span>
          <OwnerBadge
            ownerKind={owner.kind}
            ownerName={owner.name}
            agentVersion={owner.agentVersion}
          />
          {score && (
            // O MESMO componente do card, não uma cópia do medidor.
            // "Superfície nova herda as decisões da antiga" só vale como
            // mecanismo: herdar por cópia é como as duas listas do evidence —
            // funciona hoje e diverge no mês em que alguém mudar um dos dois.
            // De brinde, o rótulo honesto da âncora ("registro que sustenta",
            // nunca "momento da conversa") vem junto, sem eu reescrever nada.
            <ScoreSlot
              probability={score.probability}
              band={score.band}
              reason={score.reason}
              factors={score.factors.slice(0, 3)}
            />
          )}

          <button
            type="button"
            onClick={() => campos.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="ml-auto text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Editar campos
          </button>
        </div>

        {/* O score NÃO aparece na timeline: recálculo é telemetria e não emite
            atividade (silêncio para telemetria, pulso para mudança de estado).
            Sem esta linha, quem visse o número mudando no cabeçalho e nunca na
            timeline concluiria que a timeline está incompleta. */}
        {score?.at && (
          <p className="pt-2 text-[11px] text-text-muted">
            Probabilidade recalculada automaticamente · {new Date(score.at).toLocaleString("pt-BR")}
          </p>
        )}

        {/* ② timeline */}
        <section className="flex-1 py-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Linha do tempo
          </h3>
          <LeadTimeline
            itens={timeline.itens}
            chegouAoVivo={timeline.chegouAoVivo}
            isLoading={timeline.isLoading}
            isError={timeline.isError}
          />
        </section>

        {/* ③ campos, por último */}
        <div ref={campos} className="border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Dados do negócio
          </h3>
          <LeadFieldsForm
            lead={lead}
            pipelineId={pipelineId}
            phoneNumber={contato.data?.data.phone_number}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
