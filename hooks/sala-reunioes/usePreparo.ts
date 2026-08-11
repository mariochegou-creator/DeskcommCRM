"use client";
/**
 * React Query do preparo — as reuniões que ainda vão acontecer e o dossiê de
 * cada uma. Irmão de `useMeetings.ts`, que cuida das que já aconteceram.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Reuniao } from "@/lib/agendamento/reuniao";
import { apiClient } from "@/lib/api/client";
import type { MeetingOutcome, MeetingStatus, MeetingType } from "@/lib/sala-reunioes/vocabulary";

export interface ContatoDoPreparo {
  id: string;
  nome: string | null;
  telefone: string | null;
}

export interface ProximaReuniao {
  lead_id: string;
  lead_title: string | null;
  etapa: string | null;
  contato: ContatoDoPreparo | null;
  reuniao: Reuniao;
}

export interface NotaDoPreparo {
  id: string;
  body: string;
  created_by_name: string | null;
  created_at: string;
}

export interface TarefaDoPreparo {
  id: string;
  title: string;
  kind: string;
  notes: string | null;
  due_at: string;
  status: string;
  assigned_to_user_id: string;
}

export interface ReuniaoAnterior {
  id: string;
  meeting_type: MeetingType;
  status: MeetingStatus;
  started_at: string;
  score: number | null;
  outcome: MeetingOutcome | null;
  summary: string | null;
}

export interface Preparo {
  lead: {
    id: string;
    title: string | null;
    etapa: string | null;
    value_cents: number | null;
    currency: string | null;
    tags: string[];
    custom_fields: unknown;
  };
  contato: ContatoDoPreparo | null;
  conversa: { id: string; last_inbound_at: string | null } | null;
  reuniao: Reuniao | null;
  notas: NotaDoPreparo[];
  tarefas: TarefaDoPreparo[];
  reunioes_anteriores: ReuniaoAnterior[];
}

/**
 * 60s de poll: o que muda sozinho aqui é o carimbo de lembrete que o cron
 * grava (18h da véspera, 1h antes) — mudança de hora em hora, não de segundo em
 * segundo. Poll curto seria varredura de banco à toa.
 */
export function useProximasReunioes(dias = 21) {
  return useQuery({
    queryKey: ["meetings", "proximas", dias],
    queryFn: async () =>
      apiClient.get<{ data: { proximas: ProximaReuniao[] } }>(
        `/api/v1/meetings/proximas?dias=${dias}`,
      ),
    refetchInterval: 60_000,
  });
}

export function usePreparo(leadId: string | null) {
  return useQuery({
    queryKey: ["meetings", "preparo", leadId],
    queryFn: async () => apiClient.get<{ data: Preparo }>(`/api/v1/meetings/preparo/${leadId}`),
    enabled: leadId !== null,
  });
}

export function useToggleItemPreparo(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { item: string; feito: boolean }) =>
      apiClient.patch<{ data: { reuniao: Reuniao } }>(
        `/api/v1/meetings/preparo/${leadId}`,
        vars,
      ),
    onSettled: () => {
      // As duas listas leem o mesmo `reuniao`: o painel mostra os itens e a
      // lista da esquerda mostra "faltam N". Invalidar só uma deixaria o
      // contador mentindo até o próximo poll.
      void qc.invalidateQueries({ queryKey: ["meetings", "preparo", leadId] });
      void qc.invalidateQueries({ queryKey: ["meetings", "proximas"] });
    },
  });
}
