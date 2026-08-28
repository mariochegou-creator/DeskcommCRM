"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface Mencao {
  id: string;
  conversation_id: string;
  body: string;
  autor: string;
  cliente: string | null;
  created_at: string;
}

const MENCOES_KEY = ["mencoes"] as const;

/**
 * O sino de @ do topo (0110).
 *
 * `refetchInterval` de 60s pelo mesmo motivo do badge de tarefas: quem deixa a
 * aba aberta a manhã inteira só veria a menção ao trocar de página. 60s e não
 * 10s porque "olha isso aqui" não é alarme de incêndio, e um poll agressivo
 * custaria uma consulta por operador por aba para adiantar segundos.
 */
export function useMencoes() {
  return useQuery({
    queryKey: MENCOES_KEY,
    queryFn: async () => apiClient.get<{ data: Mencao[] }>("/api/v1/mencoes"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    select: (res) => res.data,
  });
}

/** Vi essa. Some do sino — não existe em outro lugar para continuar acesa. */
export function useMarcarMencaoVista() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) => apiClient.post("/api/v1/mencoes", { note_id: noteId }),
    // Otimista: o clique já leva pra conversa, e esperar a resposta deixaria o
    // número vermelho na tela nova por um instante — parecendo que não funcionou.
    onMutate: async (noteId) => {
      await qc.cancelQueries({ queryKey: MENCOES_KEY });
      const antes = qc.getQueryData<{ data: Mencao[] }>(MENCOES_KEY);
      qc.setQueryData<{ data: Mencao[] }>(MENCOES_KEY, (old) =>
        old ? { ...old, data: old.data.filter((m) => m.id !== noteId) } : old,
      );
      return { antes };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.antes) qc.setQueryData(MENCOES_KEY, ctx.antes);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MENCOES_KEY }),
  });
}
