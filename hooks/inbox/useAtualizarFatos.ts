"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { CRM_SUMMARY_KEY } from "@/hooks/inbox/useCrmSummary";
import { apiClient } from "@/lib/api/client";

interface Resposta {
  mudou: boolean;
  lead_id: string;
  fatos: Record<string, unknown>;
}

/**
 * O botão "Atualizar agora" de "O que o cliente contou": manda a IA reler a
 * conversa e gravar no negócio, sem esperar o resumo das 7h.
 *
 * Invalida o board junto com o painel porque o dossiê mora em
 * `crm_leads.custom_fields` — o mesmo negócio que o card do Kanban desenha.
 *
 * O aviso separa "achei coisa nova" de "reli e não tinha nada": as duas são
 * sucesso, e sem distingui-las o segundo caso parece o botão não ter feito nada
 * — que é exatamente quando alguém clica de novo e gasta outra chamada de IA.
 */
export function useAtualizarFatos(conversationId: string | null) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error("sem conversa");
      return apiClient.post<{ data: Resposta }>(
        `/api/v1/conversations/${conversationId}/fatos`,
        {},
      );
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [CRM_SUMMARY_KEY] });
      qc.invalidateQueries({ queryKey: ["board"] });
      toast.success(
        res.data.mudou
          ? "Dossiê atualizado com o que o cliente contou."
          : "Reli a conversa — nada novo além do que já estava no dossiê.",
      );
    },
    onError: (err) => showApiError(err),
  });
}
