"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { EscopoDeTarefa } from "@/lib/schemas/tarefas";
import type { StatusDaTarefa, TipoDeTarefa } from "@/lib/tarefas/tarefa";

export interface Tarefa {
  id: string;
  title: string;
  kind: TipoDeTarefa;
  notes: string | null;
  due_at: string;
  status: StatusDaTarefa;
  assigned_to_user_id: string;
  created_by_user_id: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  lead_id: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Raiz da chave: TODA mutação invalida por aqui, e as quatro telas se atualizam. */
export const TAREFAS_KEY = "tarefas";

export type FiltroDeStatus = "abertas" | "feitas" | "todas";

interface OpcoesDeLista {
  escopo?: EscopoDeTarefa;
  status?: FiltroDeStatus;
  conversationId?: string | null;
  enabled?: boolean;
}

export function useTarefas(opcoes: OpcoesDeLista = {}) {
  const { escopo = "minhas", status = "abertas", conversationId = null, enabled = true } = opcoes;

  const qs = new URLSearchParams({ escopo, status });
  if (conversationId) qs.set("conversation_id", conversationId);

  return useQuery({
    queryKey: [TAREFAS_KEY, escopo, status, conversationId],
    enabled,
    queryFn: async () =>
      apiClient.get<{ data: { tasks: Tarefa[] } }>(`/api/v1/tasks?${qs.toString()}`),
    staleTime: 20_000,
    select: (res) => res.data.tasks,
  });
}

/**
 * O alerta — pendentes JÁ VENCIDAS, minhas ou que eu pedi.
 *
 * `refetchInterval` de 60s porque este número é a única peça da tela que muda
 * sozinha: nada acontece no CRM quando um prazo vence, é a passagem do tempo
 * que torna a tarefa devida. Sem o intervalo, quem deixa a aba aberta a manhã
 * inteira (o caso normal aqui) só veria o aviso ao trocar de página.
 *
 * 60s e não 10s: o prazo tem resolução de minutos, e um poll agressivo custaria
 * uma consulta por operador por página aberta para adiantar em segundos um
 * aviso que a pessoa vai ler quando olhar.
 */
export function useAlertaDeTarefas() {
  return useQuery({
    queryKey: [TAREFAS_KEY, "alerta"],
    queryFn: async () =>
      apiClient.get<{ data: { tasks: Tarefa[] } }>("/api/v1/tasks?escopo=alerta"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    select: (res) => res.data.tasks,
  });
}

export interface NovaTarefa {
  title: string;
  kind: TipoDeTarefa;
  notes?: string;
  due_at: string;
  assigned_to_user_id?: string;
  conversation_id?: string;
  contact_id?: string;
  lead_id?: string;
}

export function useCriarTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nova: NovaTarefa) =>
      apiClient.post<{ data: { task: Tarefa } }>("/api/v1/tasks", nova),
    onError: showApiError,
    onSettled: () => qc.invalidateQueries({ queryKey: [TAREFAS_KEY] }),
  });
}

export interface PatchDeTarefa {
  id: string;
  status?: StatusDaTarefa;
  due_at?: string;
  assigned_to_user_id?: string;
  title?: string;
  notes?: string | null;
}

export function useAtualizarTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: PatchDeTarefa) =>
      apiClient.patch<{ data: { task: Tarefa } }>(`/api/v1/tasks/${id}`, patch),
    onError: showApiError,
    onSettled: () => qc.invalidateQueries({ queryKey: [TAREFAS_KEY] }),
  });
}
