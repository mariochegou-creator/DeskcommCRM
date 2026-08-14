"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { corDeTag, type CorDeTag, type TagDoCliente } from "@/lib/tags/cores";

/**
 * O catálogo de tags do cliente (0105) e a aplicação delas num contato.
 *
 * A chave `["client-tags"]` é UMA para o app inteiro — o catálogo é da
 * organização, e a lista do inbox, o card do Kanban e a tela de Configurações
 * leem exatamente o mesmo. Chaves por tela fariam a cor demorar a mudar em duas
 * das três depois de uma edição.
 */
const CHAVE = ["client-tags"] as const;

/**
 * `staleTime` alto de propósito: vocabulário muda uma vez por mês, e este hook
 * é montado por CADA linha da lista do inbox. Sem ele, rolar a lista dispararia
 * um refetch atrás do outro para uma resposta que não muda.
 */
const VALIDADE = 5 * 60_000;

export function useClientTags(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: CHAVE,
    enabled: opts?.enabled ?? true,
    staleTime: VALIDADE,
    queryFn: async (): Promise<TagDoCliente[]> => {
      const res = await apiClient.get<{ data: { tags: TagDoCliente[] } }>("/api/v1/client-tags");
      // A cor é normalizada na ENTRADA, uma vez: assim nenhum componente
      // precisa lembrar de tratar cor desconhecida (banco novo, código velho).
      return (res.data.tags ?? []).map((t) => ({ ...t, color: corDeTag(t.color) }));
    },
  });
}

export function useCriarClientTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { name: string; color: CorDeTag }) =>
      apiClient.post<{ data: TagDoCliente }>("/api/v1/client-tags", args),
    onError: showApiError,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
  });
}

export function useEditarClientTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      name?: string;
      color?: CorDeTag;
      position?: number;
    }) => {
      const { id, ...patch } = args;
      return apiClient.patch<{ data: TagDoCliente }>(
        `/api/v1/client-tags/${encodeURIComponent(id)}`,
        patch,
      );
    },
    onError: showApiError,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
      // Renomear reescreve `contacts.tags` — a lista do inbox e o board mostram
      // o nome antigo até refazerem a leitura.
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

export function useApagarClientTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiClient.delete<{ data: { id: string; clientes_atualizados: number } }>(
        `/api/v1/client-tags/${encodeURIComponent(id)}`,
      ),
    onError: showApiError,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

/**
 * Aplica o conjunto FINAL de tags num cliente.
 *
 * Reusa `PATCH /api/v1/contacts/[id]`, que já aceita `tags` desde a EPIC-05 —
 * uma rota nova só para isto seria um segundo caminho de escrita para a mesma
 * coluna, e o dia em que um deles ganhasse uma regra (auditoria, limite) o
 * outro continuaria sem ela.
 */
export function useAplicarTagsNoCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { contactId: string; tags: string[] }) =>
      apiClient.patch<{ data: { id: string; tags: string[] } }>(
        `/api/v1/contacts/${encodeURIComponent(args.contactId)}`,
        { tags: args.tags },
      ),
    onError: (err) => {
      // O otimismo da tela precisa ser desfeito pelo servidor, não pela tela:
      // ela não sabe se o PATCH chegou a gravar.
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      showApiError(err);
    },
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["contact", args.contactId] });
      void qc.invalidateQueries({ queryKey: ["crm-summary", args.contactId] });
      void qc.invalidateQueries({ queryKey: ["board"] });
    },
  });
}
