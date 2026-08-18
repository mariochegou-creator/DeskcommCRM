"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { CRM_SUMMARY_KEY } from "@/hooks/inbox/useCrmSummary";
import type { ContatoDoNegocio } from "@/app/api/v1/leads/[id]/contatos/route";
import type { PapelDoContato } from "@/lib/leads/papel-do-contato";

export type { ContatoDoNegocio };

/** A chave — quem vincula/desvincula invalida por aqui. */
export const CONTATOS_DO_NEGOCIO_KEY = "contatos-do-negocio";

/**
 * Quem se chama neste negócio: o contato de origem + os vinculados (0103).
 *
 * Pela ROTA, não pelo supabase-js do navegador, pelo mesmo motivo do
 * `useCrmSummary`: o cookie de sessão é httpOnly e a consulta sairia como
 * `anon`.
 *
 * `enabled` pelo id: o dossiê monta com o negócio já escolhido, mas a gaveta
 * fechada não deve gastar uma requisição por card do board.
 */
export function useContatosDoNegocio(leadId: string | null) {
  return useQuery({
    queryKey: [CONTATOS_DO_NEGOCIO_KEY, leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const r = await apiClient.get<{ data: { contatos: ContatoDoNegocio[] } }>(
        `/api/v1/leads/${leadId}/contatos`,
      );
      return r.data.contatos;
    },
  });
}

export interface VincularContatoVars {
  telefone: string;
  nome: string;
  papel: PapelDoContato;
  origem: "vcard" | "manual";
  messageId?: string;
}

/**
 * Vincula um contato ao negócio.
 *
 * A rota devolve a LISTA JÁ ATUALIZADA e o cache recebe essa lista direto, sem
 * refetch: entre a resposta e a volta ao servidor o contador do dossiê mostraria
 * o número antigo, e é o contador que a pessoa está olhando quando clica.
 *
 * SEM NEGÓCIO NÃO É BECO: com `leadId` nulo e o contato da conversa em mãos, o
 * hook cria o negócio primeiro (a rota devolve o aberto se já existir — nunca
 * duplica) e vincula nele. Era isso que o diálogo do inbox fazia a pessoa
 * resolver à mão, saindo do atendimento para criar um card no kanban.
 */
export function useVincularContato(
  leadId: string | null,
  contactIdDaConversa?: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: VincularContatoVars) => {
      let id = leadId;
      if (!id) {
        if (!contactIdDaConversa) {
          throw new Error("Conversa sem contato — não há onde criar o negócio.");
        }
        const novo = await apiClient.post<{ data: { lead: { id: string } } }>(
          `/api/v1/contacts/${contactIdDaConversa}/negocio`,
          {},
        );
        id = novo.data.lead.id;
      }
      const r = await apiClient.post<{
        data: { contatos: ContatoDoNegocio[]; ja_estava: boolean; contact_id: string };
      }>(`/api/v1/leads/${id}/contatos`, {
        telefone: vars.telefone,
        nome: vars.nome,
        papel: vars.papel,
        origem: vars.origem,
        ...(vars.messageId ? { message_id: vars.messageId } : {}),
      });
      return { ...r.data, lead_id: id };
    },
    onSuccess: (data) => {
      qc.setQueryData([CONTATOS_DO_NEGOCIO_KEY, data.lead_id], data.contatos);
      // O negócio pode ter acabado de nascer, e o vínculo muda em quais negócios
      // o contato aparece — o painel da conversa relê (invalidar todos custa
      // nada; ver lib/leads/invalidar.ts).
      void qc.invalidateQueries({ queryKey: [CRM_SUMMARY_KEY] });
    },
  });
}

export function useDesvincularContato(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      await apiClient.delete(`/api/v1/leads/${leadId}/contatos/${linkId}`);
      return linkId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CONTATOS_DO_NEGOCIO_KEY, leadId] });
    },
  });
}
