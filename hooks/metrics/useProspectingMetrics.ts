"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { PeriodRange } from "@/lib/dashboard/period";

export interface ProspectingFunnelStage {
  stage_id: string;
  name: string;
  slug: string | null;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  /** Leads que ENTRARAM na etapa dentro da janela (fluxo). */
  entered: number;
  entered_prev: number | null;
  /** Leads abertos na etapa AGORA (estoque, sem janela). */
  open_now: number;
}

export interface ProspectingResponseMetric {
  contacted: number;
  replied: number;
  prev_contacted: number | null;
  prev_replied: number | null;
}

export interface ProspectingFollowupMetric {
  live_total: number;
  by_day: Array<{ day: string; count: number }>;
  vacuo: number;
}

export interface ProspectingMetrics {
  window: { from: string; to: string };
  pipeline: { id: string; name: string };
  funnel: ProspectingFunnelStage[];
  response: ProspectingResponseMetric;
  followup: ProspectingFollowupMetric;
}

/**
 * Métricas de prospecção do Painel (fn_prospecting_metrics via
 * /api/v1/metrics/prospecting). As datas entram na queryKey já serializadas —
 * o range chega congelado do render (ver DashboardClient) e trocar o período
 * gera outra key, não um refetch da mesma.
 */
export function useProspectingMetrics(
  pipelineId: string | null,
  range: PeriodRange,
) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const prevFrom = range.prevFrom.toISOString();
  const prevTo = range.prevTo.toISOString();

  const qs = new URLSearchParams({
    pipeline_id: pipelineId ?? "",
    from,
    to,
    prev_from: prevFrom,
    prev_to: prevTo,
  });

  return useQuery({
    queryKey: ["metrics", "prospecting", pipelineId, from, to],
    queryFn: async () =>
      apiClient.get<{ data: ProspectingMetrics }>(
        `/api/v1/metrics/prospecting?${qs.toString()}`,
      ),
    enabled: pipelineId !== null,
    staleTime: 30_000,
  });
}
