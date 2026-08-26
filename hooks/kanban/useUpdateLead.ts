"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { liberarEcoLocal, marcarEcoLocal } from "@/lib/kanban/local-echo";
import { invalidaLeitoresDeLead } from "@/lib/leads/invalidar";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Lead } from "@/lib/types/leads";
import type { UpdateLeadInput } from "@/lib/schemas/leads";

interface WinArgs {
  leadId: string;
}
interface LoseArgs {
  leadId: string;
  lostReason: string;
}

export function useWinLead(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId }: WinArgs) => {
      marcarEcoLocal(leadId);
      return apiClient.post<{ data: Lead }>(`/api/v1/leads/${leadId}/win`, {});
    },
    onError: showApiError,
    onSettled: (_data, _err, { leadId }) => {
      liberarEcoLocal(leadId);
      invalidaLeitoresDeLead(qc, pipelineId);
    },
  });
}

export function useLoseLead(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, lostReason }: LoseArgs) => {
      marcarEcoLocal(leadId);
      return apiClient.post<{ data: Lead }>(`/api/v1/leads/${leadId}/lose`, {
        lost_reason: lostReason,
      });
    },
    onError: showApiError,
    onSettled: (_data, _err, { leadId }) => {
      liberarEcoLocal(leadId);
      invalidaLeitoresDeLead(qc, pipelineId);
    },
  });
}

interface EditArgs {
  leadId: string;
  patch: UpdateLeadInput;
}

export function useEditLead(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, patch }: EditArgs) => {
      // Minha própria ação não pulsa: o feedback dela já é a mudança na tela.
      marcarEcoLocal(leadId);
      return apiClient.patch<{ data: Lead }>(`/api/v1/leads/${leadId}`, patch);
    },
    onError: showApiError,
    onSettled: (_data, _err, { leadId }) => {
      liberarEcoLocal(leadId);
      invalidaLeitoresDeLead(qc, pipelineId);
    },
  });
}

/**
 * Apaga o negócio. Sem eco local de propósito: eco existe para a MINHA ação não
 * pulsar o card duas vezes, e aqui não sobra card para pulsar — marcar liberaria
 * depois um id que já não existe.
 */
export function useDeleteLead(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId }: { leadId: string }) =>
      apiClient.delete<{ data: { id: string } }>(`/api/v1/leads/${leadId}`),
    onError: showApiError,
    onSettled: () => {
      invalidaLeitoresDeLead(qc, pipelineId);
    },
  });
}
