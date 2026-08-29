"use client";
/**
 * React Query da Sala de Reuniões — a aba lê por aqui (modelo:
 * hooks/plan/useSixtyDayPlan.ts). A extensão NÃO usa estes hooks: ela fala com
 * a mesma API por Bearer token, direto do service worker.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type {
  MeetingOutcome,
  MeetingPhase,
  MeetingStatus,
  MeetingTurn,
  MeetingType,
} from "@/lib/sala-reunioes/vocabulary";

export interface MeetingListItem {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  meeting_type: MeetingType;
  status: MeetingStatus;
  started_at: string;
  ended_at: string | null;
  meet_code: string | null;
  turn_count: number;
  summary: string | null;
  outcome: MeetingOutcome | null;
  score: number | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingSuggestion {
  id: string;
  at_seconds: number;
  phase_detected: MeetingPhase;
  suggestion: string;
  alert: string | null;
  was_followed: boolean | null;
  created_at: string;
}

export interface MeetingDetail extends MeetingListItem {
  transcript: MeetingTurn[];
  notes: string | null;
  spin_scores: Record<string, { nota: number; comentario: string }> | null;
  coaching: {
    acertos?: string[];
    melhorias?: string[];
    perguntas_que_faltaram?: string[];
    raw?: string;
  } | null;
  analysis_error: string | null;
}

export function useMeetings(filters?: { status?: string; meeting_type?: MeetingType }) {
  const qs = new URLSearchParams();
  if (filters?.status) qs.set("status", filters.status);
  if (filters?.meeting_type) qs.set("meeting_type", filters.meeting_type);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  return useQuery({
    queryKey: ["meetings", "list", filters?.status ?? "all", filters?.meeting_type ?? "all"],
    queryFn: async () =>
      apiClient.get<{ data: { meetings: MeetingListItem[] } }>(`/api/v1/meetings${suffix}`),
    // 15s: uma reunião "analisando" vira "concluída" sem a pessoa recarregar —
    // a tabela está fora do realtime de propósito (migration 0098), poll barato
    // é o contrato de leitura dela.
    refetchInterval: 15_000,
  });
}

export function useMeeting(id: string | null) {
  return useQuery({
    queryKey: ["meetings", "detail", id],
    queryFn: async () =>
      apiClient.get<{ data: { meeting: MeetingDetail; suggestions: MeetingSuggestion[] } }>(
        `/api/v1/meetings/${id}`,
      ),
    enabled: id !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.data.meeting.status;
      // Só pulsa enquanto há pipeline andando; concluída é imutável.
      return status === "ao_vivo" || status === "analisando" ? 5_000 : false;
    },
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { meeting_type: MeetingType; lead_id?: string }) =>
      apiClient.post<{ data: { meeting: MeetingListItem } }>("/api/v1/meetings", input),
    onSettled: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export function useUpdateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      lead_id?: string | null;
      notes?: string | null;
      meeting_type?: MeetingType;
    }) => apiClient.patch<{ data: { meeting: MeetingListItem } }>(`/api/v1/meetings/${id}`, patch),
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: ["meetings", "list"] });
      void qc.invalidateQueries({ queryKey: ["meetings", "detail", vars.id] });
    },
  });
}

export function useFinishMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ data: { meeting: MeetingListItem } }>(`/api/v1/meetings/${id}/finish`, {}),
    onSettled: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

/**
 * Salvar o resultado do Guia da Reunião / Quadro Branco no card do lead (e na
 * reunião, quando houver). Invalida "meetings" inteiro: a nota aparece no
 * preparo da próxima reunião e no dossiê — as duas pontas leem daqui.
 */
export function useSalvarGuia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      meeting_id?: string;
      lead_id?: string;
      headline: string;
      body: string;
    }) =>
      apiClient.post<{ data: { salvo_no_lead: boolean; salvo_na_reuniao: boolean } }>(
        "/api/v1/meetings/guia",
        input,
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ["meetings"] }),
  });
}

export interface MeetingMetrics {
  days: number;
  total_reunioes: number;
  r1_concluidas: number;
  r2_concluidas: number;
  taxa_avanco_r1: number | null;
  taxa_fechamento_r2: number | null;
  nota_media: number | null;
  nota_por_fase: Partial<Record<MeetingPhase, number>>;
  sugestoes_avaliadas: number;
  pct_sugestoes_seguidas: number | null;
}

export function useMeetingMetrics(days = 30) {
  return useQuery({
    queryKey: ["meetings", "metrics", days],
    queryFn: async () =>
      apiClient.get<{ data: MeetingMetrics }>(`/api/v1/meetings/metrics?days=${days}`),
    staleTime: 60_000,
  });
}
