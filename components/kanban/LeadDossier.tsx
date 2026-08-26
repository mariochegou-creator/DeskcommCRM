"use client";
import { useRef } from "react";

import { ContactActions } from "@/components/contacts/ContactActions";
import { ContatosDoNegocio } from "@/components/leads/ContatosDoNegocio";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChatCircle, MapPin } from "@/lib/ui/icons";
import { extractExtras, extractGoogleMapsUrl, listarGanchos } from "@/lib/leads/ganchos";
import { extractFatos } from "@/lib/leads/fatos-do-cliente";
import { DecisorDoCliente, FatosDoCliente } from "@/components/leads/FatosDoCliente";
import { LeadExtrasList } from "@/components/leads/LeadExtrasList";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import { useContact } from "@/hooks/contacts/useContact";
import { useContactConversation } from "@/hooks/inbox/useContactConversation";
import { whatsappLink } from "@/lib/contacts/whatsapp";
import type { Lead } from "@/lib/types/leads";
import { PrimeiroToque } from "./PrimeiroToque";
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
  /**
   * Some com o atalho "abrir conversa no inbox".
   *
   * Existe porque o dossiê passou a ser usado DE DENTRO do inbox (painel
   * lateral): oferecer ali um botão que leva à conversa já aberta é um caminho
   * que não vai a lugar nenhum — e quem clica e não sai do lugar aprende a
   * desconfiar do botão, inclusive no board, onde ele presta.
   */
  esconderAtalhoDeConversa?: boolean;
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
  esconderAtalhoDeConversa = false,
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

  /**
   * A caixa de primeiro toque ocupa o lugar do antigo botão do WhatsApp Web.
   *
   * `isLoading` importa: sem ele a caixa pisca por um instante em TODO lead que
   * já tem conversa, e piscar um formulário de envio é o tipo de coisa que faz
   * a pessoa clicar no que estava ali antes de a tela decidir.
   */
  const mostrarPrimeiroToque =
    !esconderAtalhoDeConversa && !conversa.data && !conversa.isLoading;

  // Ganchos + dossiê da prospecção. A gaveta é onde o SDR trabalha — era a
  // única superfície que NÃO mostrava os ganchos (só a página /leads/[id]
  // mostrava); quem operava pelo kanban abria conversa sem ver o gancho.
  const ganchos = listarGanchos(lead.custom_fields);
  const extras = extractExtras(lead.custom_fields);
  // O que a IA colheu da conversa — decisor e fatos que valem para sempre.
  const fatos = extractFatos(lead.custom_fields);

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
          {/* Quem decide, colado no nome do negócio — mesma decisão do painel do
              inbox: o título é a empresa, e quem atende o WhatsApp dela quase
              nunca é quem assina. */}
          <DecisorDoCliente fatos={fatos} className="pt-1" />
        </SheetHeader>

        {/* Conversar vem ANTES do resto: quem abre um lead de prospecção fria
            veio para falar com o negócio, não para ler o histórico — que num
            lead recém-importado está vazio de qualquer forma.

            DOIS estados, e a peça diz qual: com conversa aberta o atendimento
            é no inbox (histórico, transferência, IA, tudo registrado); sem
            conversa, a caixa de primeiro toque manda o gancho e ABRE a conversa
            — o inbox deixa de ser uma promessa vazia porque o próprio envio o
            preenche.

            O que existia aqui antes era um botão para o `wa.me`: o SDR lia o
            gancho na tela, ia para o WhatsApp Web e colava o texto à mão, e o
            CRM só via a conversa se o lead respondesse. O link do WhatsApp
            continua existindo dentro da caixa, como saída de emergência. */}
        {conversa.data ? (
          !esconderAtalhoDeConversa && (
            <Button asChild variant="primary" size="sm" className="mb-3 w-full gap-2">
              <Link href={`/app/inbox?id=${conversa.data.id}`}>
                <ChatCircle size={16} weight="fill" />
                Abrir conversa no inbox
              </Link>
            </Button>
          )
        ) : (
          mostrarPrimeiroToque && (
            <PrimeiroToque
              leadId={lead.id}
              contactId={lead.contact_id}
              pipelineId={pipelineId}
              ganchos={ganchos}
              whatsappHref={whatsapp}
            />
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

        {/* Ganchos antes de tudo: quem abre a gaveta veio conversar, e o
            gancho é o que se lê antes do primeiro toque. Âmbar como no inbox
            e na página — mesmo significado, só o time vê. Sem estado vazio.

            Somem quando a caixa de primeiro toque está na tela: lá o gancho já
            está escrito e editável. Mostrar os dois seria a mesma frase duas
            vezes, e a de cima — a que não se edita — é a que o olho pega. */}
        {ganchos.length > 0 && !mostrarPrimeiroToque && (
          <ul className="mb-3 space-y-1.5">
            {ganchos.map((g) => (
              <li
                key={g.chave}
                className="whitespace-pre-wrap break-words rounded-md border border-warning/40 bg-warning-bg p-2 text-xs leading-snug text-warning-fg"
              >
                {g.texto}
              </li>
            ))}
          </ul>
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

        {/* ① bis — falar com a pessoa. Fica ACIMA da timeline porque a pergunta
            "como falo com este contato agora" é a que traz o SDR ao dossiê; a
            timeline responde "o que já aconteceu", que vem depois.

            Com MAIS DE UM contato (0103), a lista "Quem chamar (2)" toma o
            lugar dos botões soltos — e é ela que responde a pergunta de quem
            abre o negócio depois de o cliente ter mandado o cartão do sócio.
            Com um contato só, nada muda: o `fallback` é exatamente o que a
            gaveta mostrava antes. A decisão de qual dos dois aparece vive
            DENTRO da peça, nunca aqui (ver o cabeçalho dela). */}
        {open && (
          <ContatosDoNegocio
            leadId={lead.id}
            tituloDoNegocio={lead.title}
            origin="deal"
            className="border-b border-border py-3"
            fallback={
              lead.contact_id && contato.data && !contato.data.data.is_anonymized ? (
                <ContactActions
                  contactId={lead.contact_id}
                  contactName={
                    contato.data.data.display_name ?? contato.data.data.name ?? lead.title
                  }
                  phoneNumber={contato.data.data.phone_number}
                  company={lead.title}
                  origin="deal"
                />
              ) : null
            }
          />
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

        {/* ②¼ o que o cliente contou — vem ANTES do dossiê de prospecção de
            propósito: aquele é o que a lista comprada sabia sobre o negócio,
            este é o que o dono falou por conta própria. Na hora de preparar a
            reunião, o segundo vale mais. */}
        {/* A borda vai na condição junto com a peça: a seção some quando não há
            fato guardado NEM conversa para reler, e um `<div>` com borda solta
            desenharia uma linha anunciando uma seção que não existe. */}
        {(fatos.fatos.length > 0 || conversa.data) && (
          <div className="border-t border-border py-3">
            <FatosDoCliente fatos={fatos} conversationId={conversa.data?.id ?? null} />
          </div>
        )}

        {/* ②½ dossiê de prospecção — o que a lista enriquecida gravou além dos
            ganchos (Dores, Score, Nota Google…). Leitura, não edição: por isso
            fica antes do formulário, junto do que se consulta. */}
        {extras.length > 0 && (
          <section className="border-t border-border py-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              Dossiê de prospecção
            </h3>
            <LeadExtrasList extras={extras} dense />
          </section>
        )}

        {/* ③ campos, por último */}
        <div ref={campos} className="border-t border-border pt-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Dados do negócio
          </h3>
          <LeadFieldsForm
            lead={lead}
            pipelineId={pipelineId}
            phoneNumber={contato.data?.data.phone_number}
            // Apagado o negócio, a gaveta FECHA — ao contrário do salvar, que a
            // deixa aberta de propósito. Não há timeline para mostrar o que
            // acabou de acontecer: ela foi junto.
            onDeleted={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
