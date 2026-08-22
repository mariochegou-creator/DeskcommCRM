"use client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { actorName, actorShape } from "@/lib/leads/activity-vocabulary";
import { Kanban } from "@/lib/ui/icons";
import type { TimelineItemView } from "@/lib/types/contacts";

/**
 * "O card mudou de coluna" dito DENTRO da conversa, no instante em que
 * aconteceu.
 *
 * Existe porque o card andando sozinho é a única mudança do CRM que o atendente
 * precisa saber ENQUANTO digita: ele está prometendo uma reunião para um lead
 * que o agente acabou de marcar como perdido, ou repetindo uma pergunta que já
 * qualificou o negócio. O painel lateral tem a informação — e só aparece em tela
 * larga, num canto que ninguém olha no meio de um atendimento.
 *
 * ⚠️ NÃO É MENSAGEM, e por isso não é bolha: não foi para o cliente, não tem
 * lado, não tem status de entrega. Desenhar como bolha faria o atendente
 * procurar no WhatsApp uma frase que o WhatsApp nunca viu. É o mesmo desenho
 * centrado da nota interna, com a cor neutra — a nota é âmbar porque é conteúdo
 * de gente, isto aqui é o sistema narrando um fato.
 *
 * ⚠️ O NOME DE QUEM MOVEU VEM DE `actorName`, a mesma função da timeline do
 * dossiê. Um segundo vocabulário aqui ("Robô", "Automático") faria a mesma
 * mudança de etapa ter dois nomes em duas telas do mesmo produto.
 */
export function StageEventCard({ evento }: { evento: TimelineItemView }) {
  const hora = format(new Date(evento.performed_at), "HH:mm", { locale: ptBR });
  const quem = actorName(evento.actor_kind ?? null, {
    agente: evento.actor_agent_name,
    usuario: evento.actor_user_name,
  });
  // `reason` é escrito pelo emissor ("Movido de Contatado para Respondeu") e é o
  // MESMO texto dos quatro caminhos que mexem em etapa. O fallback cobre a linha
  // antiga, gravada antes de `reason` existir.
  const oQue = evento.reason?.trim() || "Mudou de etapa no funil";
  const forma = actorShape(evento.actor_kind ?? null);

  return (
    <div className="flex w-full justify-center px-4 py-1">
      <div
        className="flex max-w-[85%] items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-[11px] leading-snug text-muted-foreground"
        data-testid="evento-de-etapa"
      >
        <Kanban size={13} weight="regular" className="shrink-0" aria-hidden />
        <span
          // O marcador do ator, igual ao do card e ao da timeline: cheio = gente,
          // anel = agente, tracejado = nem um nem outro. A forma carrega a
          // leitura rápida; o nome ao lado carrega a exata.
          className={
            forma === "filled"
              ? "size-1.5 shrink-0 rounded-full bg-current"
              : forma === "ring"
                ? "size-1.5 shrink-0 rounded-full border border-current"
                : "size-1.5 shrink-0 rounded-full border border-dashed border-current"
          }
          aria-hidden
        />
        <span className="min-w-0 break-words">
          <span className="font-semibold">{quem}</span>
          {": "}
          {oQue}
        </span>
        <span className="shrink-0 opacity-70">{hora}</span>
      </div>
    </div>
  );
}
