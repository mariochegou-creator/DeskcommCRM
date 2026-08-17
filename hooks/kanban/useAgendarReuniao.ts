"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { liberarEcoLocal, marcarEcoLocal } from "@/lib/kanban/local-echo";
import type { Reuniao, TipoDeReuniao } from "@/lib/agendamento/reuniao";

export interface AgendarArgs {
  leadId: string;
  /** YYYY-MM-DD civil da Bahia. */
  data: string;
  /** HH:MM civil da Bahia. */
  hora: string;
  tipo?: TipoDeReuniao;
  /**
   * Quem recebe o convite do Google Agenda. Ausente NÃO é "ninguém": a rota
   * cai no e-mail cadastrado do contato do lead.
   */
  convidados?: string[];
}

export interface RespostaDoAgendamento {
  reuniao: Reuniao;
  confirmacao: { enviada: true } | { enviada: false; motivo: string };
  agenda:
    | { criada: true; link: string | null; convidados: string[] }
    | { criada: false; motivo: string; link_manual: string; configurada: boolean };
  /** A ligação de preparo: nasceu agora, teve o prazo movido, ou não coube. */
  tarefa_de_ligar: "criada" | "remarcada" | null;
}

/**
 * Marca a reunião do card. Não é otimista de propósito: o retorno traz se a
 * confirmação saiu no WhatsApp e se o evento entrou na agenda — dois fatos que
 * a tela precisa mostrar e que só o servidor conhece.
 */
export function useAgendarReuniao(pipelineId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, ...body }: AgendarArgs) => {
      marcarEcoLocal(leadId);
      const res = await apiClient.post<{ data: RespostaDoAgendamento }>(
        `/api/v1/leads/${leadId}/meeting`,
        body,
        // Google Agenda + WhatsApp na mesma chamada passam do timeout padrão
        // de 10s com folga curta; 25s cobre os dois com margem.
        { timeoutMs: 25_000 },
      );
      return res.data;
    },
    onError: showApiError,
    onSettled: (_data, _err, { leadId }) => {
      liberarEcoLocal(leadId);
      qc.invalidateQueries({ queryKey: ["board", pipelineId] });
    },
  });
}
