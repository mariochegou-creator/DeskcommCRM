"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { toast } from "sonner";

export interface RespostaDoGrupo {
  grupo:
    | { criado: true; nome: string; jaExistia: boolean; faltaram: string[] }
    | { criado: false; motivo: string };
  abertura_enviada?: boolean;
}

const MOTIVO: Record<string, string> = {
  sem_contato: "Este negócio não tem contato ligado.",
  sem_telefone: "O contato não tem telefone.",
  sem_sessao: "Nenhum número de WhatsApp conectado.",
  waha_desligado: "O serviço do WhatsApp não está no ar.",
  falhou: "O WhatsApp recusou a criação do grupo.",
};

/**
 * Cria o grupo do WhatsApp do card, fora do fluxo de marcar reunião.
 *
 * O aviso é dado aqui e não na tela porque não há tela: o clique sai de um item
 * de menu e o resultado precisa aparecer em algum lugar. E ele não é só
 * "pronto" — participante que ficou de fora por privacidade de grupo é o tipo
 * de falha que passa despercebida e só aparece no dia da reunião, quando o
 * David não está no grupo para responder.
 */
export function useCriarGrupo(pipelineId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (leadId: string) => {
      const res = await apiClient.post<{ data: RespostaDoGrupo }>(
        `/api/v1/leads/${leadId}/meeting/grupo`,
        {},
        { timeoutMs: 25_000 },
      );
      return res.data;
    },
    onError: showApiError,
    onSuccess: (data) => {
      if (!data.grupo.criado) {
        toast.error(MOTIVO[data.grupo.motivo] ?? "O grupo não foi criado.");
        return;
      }
      if (data.grupo.jaExistia) {
        toast.info(`O grupo "${data.grupo.nome}" já existia.`);
        return;
      }
      const fora = data.grupo.faltaram.length;
      if (fora > 0) {
        toast.error(
          `Grupo "${data.grupo.nome}" criado, mas ${fora} ${
            fora === 1 ? "pessoa não entrou" : "pessoas não entraram"
          } — adicione à mão pelo celular.`,
        );
        return;
      }
      toast.success(`Grupo "${data.grupo.nome}" criado no WhatsApp.`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["board", pipelineId] });
    },
  });
}
