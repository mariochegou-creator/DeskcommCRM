"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { liberarEcoLocal, marcarEcoLocal } from "@/lib/kanban/local-echo";
import { invalidaLeitoresDeLead } from "@/lib/leads/invalidar";
import { TAREFAS_KEY } from "@/hooks/tarefas/useTarefas";
import { ApiError } from "@/lib/api/types";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Lead } from "@/lib/types/leads";
import type { BoardData } from "@/lib/kanban/types";

interface MoveArgs {
  leadId: string;
  stageId: string;
  positionInStage: number;
  expectedUpdatedAt: string;
}

export function useMoveCard(pipelineId: string) {
  const qc = useQueryClient();
  const queryKey = ["board", pipelineId] as const;

  return useMutation({
    mutationFn: async (args: MoveArgs) => {
      // Minha própria ação não pulsa: o card já se moveu sob o cursor.
      marcarEcoLocal(args.leadId);
      return apiClient.post<{ data: Lead }>(`/api/v1/leads/${args.leadId}/move`, {
        stage_id: args.stageId,
        position_in_stage: args.positionInStage,
        expected_updated_at: args.expectedUpdatedAt,
      });
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey });
      const snapshot = qc.getQueryData<BoardData>(queryKey);
      if (snapshot) {
        qc.setQueryData<BoardData>(queryKey, {
          ...snapshot,
          leads: snapshot.leads.map((l) =>
            l.id === args.leadId
              ? { ...l, stage_id: args.stageId, position_in_stage: args.positionInStage }
              : l,
          ),
        });
      }
      return { snapshot };
    },
    onError: (err, _args, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(queryKey, ctx.snapshot);
      if (err instanceof ApiError && err.status === 409) {
        // Reconcile authoritative state — server already gave new updated_at.
        qc.invalidateQueries({ queryKey });
      }
      showApiError(err);
    },
    onSettled: (_data, _err, args) => {
      // A marca fecha com a AÇÃO, não com o relógio: daqui em diante só a folga
      // curta do último evento da cascata (ver lib/kanban/local-echo.ts).
      liberarEcoLocal(args.leadId);
      invalidaLeitoresDeLead(qc, pipelineId);
      // A coluna de destino pode ter criado o checklist dela no servidor (ver
      // lib/tarefas/criar-da-etapa.ts). Sem esta linha o badge do menu e a aba
      // Tarefas só mostrariam as novas na próxima navegação — e o arrasto
      // pareceria não ter feito nada.
      qc.invalidateQueries({ queryKey: [TAREFAS_KEY] });
    },
  });
}
