"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { Pipeline, StageComTopo } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

export interface OrderRow {
  id: string;
  external_id: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  created_at: string;
}

export interface ActivityRow {
  id: string;
  type: string;
  source_module: string;
  performed_at: string;
  payload: Record<string, unknown> | null;
  /** 0071 — o porquê legível e quem agiu. */
  reason: string | null;
  actor_kind: string | null;
}

export interface CrmSummary {
  /** Os negócios do contato, colunas completas — o painel mostra o mesmo que o card. */
  leads: Lead[];
  /** Etapas ativas dos funis desses negócios, com o topo de cada coluna. */
  stages: StageComTopo[];
  pipelines: Pipeline[];
  orders: OrderRow[];
  activities: ActivityRow[];
}

/** A chave — quem muta um lead invalida por aqui (ver lib/leads/invalidar.ts). */
export const CRM_SUMMARY_KEY = "crm-summary";

/**
 * O CRM do contato aberto no inbox.
 *
 * Pela ROTA, não pelo cliente de navegador: o cookie de sessão é httpOnly,
 * então o supabase-js do browser não vê a sessão e consultaria como `anon`
 * (medido: role=anon com gerente logado). Ver o cabeçalho da rota.
 *
 * Em react-query, e não em `useState` + `useEffect`, por um motivo concreto:
 * mover a etapa ou trocar uma tag pelo painel precisa REFAZER esta leitura, e
 * com estado local cada mutação teria que carregar um callback de recarga até
 * aqui. Com a chave, quem muta invalida — e o painel se atualiza sozinho.
 */
export function useCrmSummary(contactId: string | null) {
  return useQuery({
    queryKey: [CRM_SUMMARY_KEY, contactId],
    enabled: !!contactId,
    queryFn: async () => {
      const r = await apiClient.get<{ data: CrmSummary }>(
        `/api/v1/contacts/${contactId}/crm-summary`,
      );
      return r.data;
    },
  });
}
