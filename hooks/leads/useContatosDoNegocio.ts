"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
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
 */
export function useVincularContato(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: VincularContatoVars) => {
      const r = await apiClient.post<{
        data: { contatos: ContatoDoNegocio[]; ja_estava: boolean; contact_id: string };
      }>(`/api/v1/leads/${leadId}/contatos`, {
        telefone: vars.telefone,
        nome: vars.nome,
        papel: vars.papel,
        origem: vars.origem,
        ...(vars.messageId ? { message_id: vars.messageId } : {}),
      });
      return r.data;
    },
    onSuccess: (data) => {
      qc.setQueryData([CONTATOS_DO_NEGOCIO_KEY, leadId], data.contatos);
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
