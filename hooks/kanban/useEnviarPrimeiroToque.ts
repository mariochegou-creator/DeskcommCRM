"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

interface Envio {
  leadId: string;
  contactId: string | null;
  body: string;
}

interface RespostaDoToque {
  conversation_id: string;
  message_id: string;
  status: string;
}

/**
 * Manda o gancho de abertura e leva o SDR para a conversa no inbox.
 *
 * A NAVEGAÇÃO É PARTE DO GESTO, não um extra: o pedido do Mario foi "cair
 * direto no inbox em vez de abrir o WhatsApp Web". Um toast de sucesso que
 * deixa a pessoa parada na gaveta reproduz exatamente o problema — ela ainda
 * teria que achar a conversa.
 *
 * O timeout é generoso porque o caminho inclui o WAHA falando com o WhatsApp;
 * o padrão do apiClient cortaria envios lentos que na verdade deram certo.
 */
export function useEnviarPrimeiroToque(pipelineId: string) {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async ({ leadId, body }: Envio) => {
      const res = await apiClient.post<{ data: RespostaDoToque }>(
        `/api/v1/leads/${leadId}/primeiro-toque`,
        { body },
        { timeoutMs: 30_000 },
      );
      return res.data;
    },
    onError: showApiError,
    onSuccess: (data, vars) => {
      // A gaveta lê a conversa por contato para escolher entre "abrir no inbox"
      // e "iniciar no WhatsApp". Sem invalidar, voltar ao card mostraria de novo
      // o caminho do WhatsApp Web para uma conversa que já existe.
      if (vars.contactId) {
        qc.invalidateQueries({ queryKey: ["contact-conversation", vars.contactId] });
      }
      qc.invalidateQueries({ queryKey: ["board", pipelineId] });
      toast.success("Mensagem enviada. Abrindo a conversa…");
      router.push(`/app/inbox?id=${data.conversation_id}`);
    },
  });
}
