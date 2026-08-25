"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { LeadChannelsPayload } from "@/app/api/v1/metrics/lead-channels/route";

export type { LeadChannelsPayload, NumeroDoPainel } from "@/app/api/v1/metrics/lead-channels/route";

/**
 * De qual número de WhatsApp é cada negócio do funil (seletor do Painel).
 *
 * `staleTime` alto de propósito: o mapa muda quando NASCE uma conversa, não a
 * cada mensagem — refazer a consulta junto com o quadro (que tem realtime)
 * custaria uma varredura de conversas por evento de card.
 */
export function useLeadChannels(pipelineId: string | null) {
  return useQuery({
    queryKey: ["metrics", "lead-channels", pipelineId],
    queryFn: async () =>
      apiClient.get<{ data: LeadChannelsPayload }>(
        `/api/v1/metrics/lead-channels?pipeline_id=${pipelineId ?? ""}`,
      ),
    enabled: pipelineId !== null,
    staleTime: 120_000,
  });
}
