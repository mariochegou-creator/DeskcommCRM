"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface HorariosDoDia {
  data: string;
  /** Slots (HH:MM, Bahia) que já têm dono nesse dia. */
  ocupados: string[];
  /** `false` = o Google Agenda não respondeu; só o que o CRM marcou está aqui. */
  agenda_lida: boolean;
}

/**
 * O que já está tomado no dia escolhido.
 *
 * `staleTime` curto de propósito: entre abrir o dialog e escolher a hora, outra
 * pessoa do time pode ter marcado — e o cache longo mostraria livre um horário
 * que acabou de ser tomado. `leadId` sai da conta do servidor (é o lead que
 * está sendo remarcado), mas entra na chave: dois cards abertos no mesmo dia
 * têm respostas diferentes.
 */
export function useHorariosDoDia(data: string, leadId?: string) {
  return useQuery({
    queryKey: ["horarios-do-dia", data, leadId ?? null],
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(data),
    staleTime: 30_000,
    queryFn: () => {
      const params = new URLSearchParams({ data });
      if (leadId) params.set("lead_id", leadId);
      return apiClient
        .get<{ data: HorariosDoDia }>(`/api/v1/leads/horarios?${params.toString()}`)
        .then((r) => r.data);
    },
  });
}
