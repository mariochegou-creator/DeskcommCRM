"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ProspectingMetrics } from "@/hooks/metrics/useProspectingMetrics";
import {
  bahiaStartOfDay,
  bahiaStartOfWeek,
  planStartInstant,
  previousBusinessDayWindow,
} from "@/lib/plan/dates";
import type { PlanOwner } from "@/lib/plan/sixty-day-plan";

export interface PlanTask {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  phase: number;
  owner: PlanOwner;
  due_date: string | null;
  position: number;
  status: "pending" | "done" | "skipped";
  resolved_at: string | null;
}

export function usePlanTasks() {
  return useQuery({
    queryKey: ["plan", "tasks"],
    queryFn: async () =>
      apiClient.get<{ data: { tasks: PlanTask[] } }>("/api/v1/plan/tasks"),
    staleTime: 30_000,
  });
}

export function useUpdatePlanTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: PlanTask["status"] }) =>
      apiClient.patch<{ data: { task: PlanTask } }>(`/api/v1/plan/tasks/${id}`, { status }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["plan", "tasks"] }),
  });
}

/**
 * Uma janela do plano na MESMA rota da prospecção (fn_prospecting_metrics).
 * A queryKey inclui as quatro pontas — a do hook da seção de prospecção omite o
 * prev porque lá ele deriva do período; aqui as janelas são independentes e
 * duas chamadas só diferem no prev.
 */
function usePlanWindow(
  pipelineId: string | null,
  label: string,
  from: Date,
  to: Date,
  prev?: { from: Date; to: Date },
  enabled = true,
) {
  const qs = new URLSearchParams({
    pipeline_id: pipelineId ?? "",
    from: from.toISOString(),
    to: to.toISOString(),
  });
  if (prev) {
    qs.set("prev_from", prev.from.toISOString());
    qs.set("prev_to", prev.to.toISOString());
  }

  return useQuery({
    queryKey: [
      "plan",
      "pace",
      label,
      pipelineId,
      from.toISOString(),
      to.toISOString(),
      prev?.from.toISOString() ?? "no-prev",
    ],
    queryFn: async () =>
      apiClient.get<{ data: ProspectingMetrics }>(
        `/api/v1/metrics/prospecting?${qs.toString()}`,
      ),
    enabled: enabled && pipelineId !== null,
    staleTime: 30_000,
  });
}

/**
 * As três janelas do ritmo: hoje, semana e o plano inteiro (10/08 → agora).
 *
 * Os "prev" comparam com o MESMO PONTO do período anterior — 10h de hoje vs.
 * o dia inteiro de sexta faria toda manhã parecer queda. Acumulado não tem
 * prev: não existe "plano anterior".
 */
export function usePlanPace(pipelineId: string | null, now: Date) {
  const dayStart = bahiaStartOfDay(now);
  const sinceDayStart = now.getTime() - dayStart.getTime();
  const prevDay = previousBusinessDayWindow(now);
  const prevDayTo = new Date(
    Math.min(prevDay.from.getTime() + sinceDayStart, prevDay.to.getTime()),
  );

  const weekStart = bahiaStartOfWeek(now);
  const sinceWeekStart = now.getTime() - weekStart.getTime();
  const prevWeekFrom = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevWeekTo = new Date(prevWeekFrom.getTime() + sinceWeekStart);

  const today = usePlanWindow(pipelineId, "today", dayStart, now, {
    from: prevDay.from,
    // Janela vazia quebraria a rota (from >= to); no primeiro milissegundo do
    // dia compara com o dia útil anterior inteiro.
    to: prevDayTo.getTime() > prevDay.from.getTime() ? prevDayTo : prevDay.to,
  });
  const week = usePlanWindow(pipelineId, "week", weekStart, now, {
    from: prevWeekFrom,
    to: prevWeekTo.getTime() > prevWeekFrom.getTime() ? prevWeekTo : weekStart,
  });

  // Antes de 10/08 a janela do acumulado seria [futuro, agora) — from > to, e
  // a rota recusa com 422 (com razão). A query só liga quando o plano começa.
  const planStart = planStartInstant();
  const planStarted = now.getTime() > planStart.getTime();
  const plan = usePlanWindow(pipelineId, "plan", planStart, now, undefined, planStarted);

  return { today, week, plan, planStarted };
}
