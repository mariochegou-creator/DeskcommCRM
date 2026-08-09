"use client";
import { Check, DotsThree } from "@/lib/ui/icons";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { MonoLabel } from "@/components/ui/mono-label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { percentChange } from "@/lib/dashboard/period";
import {
  usePlanPace,
  usePlanTasks,
  useUpdatePlanTask,
  type PlanTask,
} from "@/hooks/plan/useSixtyDayPlan";
import { pickPlanNumbers, type PaceFunnelStage } from "@/lib/plan/pace";
import {
  bahiaCivilDate,
  businessDaysMonToYesterday,
  currentPhase,
  daysUntil,
  nextCheckpoint,
  planDayNumber,
  shortDate,
} from "@/lib/plan/dates";
import { OWNER_LABEL, SIXTY_DAY_PLAN } from "@/lib/plan/sixty-day-plan";

/**
 * "// plano 60 dias" — o topo do Painel durante o plano comercial.
 *
 * Deliberadamente FORA do regime do seletor de período: as janelas daqui são
 * as do plano (hoje / semana / 10/08→agora), não as do dropdown — o plano tem
 * calendário próprio e o seletor não deve reescrevê-lo. Também fora do ternário
 * do board, pela mesma razão da ProspectingSection: dados próprios, queda
 * própria.
 *
 * Rotina diária NÃO aparece como tarefa marcável: "fiz as 40 aberturas" quem
 * responde é o card de ritmo (fn_prospecting_metrics). Tarefa aqui é só o
 * pontual — o que se faz UMA vez e destrava o resto.
 */

interface Props {
  prospectingPipelineId: string | null;
  now: Date;
}

export function SixtyDayPlanSection({ prospectingPipelineId, now }: Props) {
  const tasksQuery = usePlanTasks();
  const pace = usePlanPace(prospectingPipelineId, now);

  const tasks = tasksQuery.data?.data.tasks ?? null;
  // Métrica com erro NÃO derruba a seção: os cards degradam para "—" e as
  // tarefas — o coração — continuam de pé. Só a lista de tarefas é fatal.
  const paceLoading =
    prospectingPipelineId !== null &&
    (pace.today.isLoading || pace.week.isLoading || pace.plan.isLoading);

  const day = planDayNumber(now);
  const phase = currentPhase(now);
  // "Encerrado" é depois do endDate CIVIL, não do dia 60: 10/08→09/10 são 61
  // dias corridos e o último dia ainda é plano rodando.
  const ended = daysUntil(SIXTY_DAY_PLAN.endDate, now) < 0;
  const subtitle =
    day < 1
      ? `começa segunda ${shortDate(SIXTY_DAY_PLAN.startDate)} · Fase ${phase.n} — ${phase.name}`
      : ended
        ? `encerrado em ${shortDate(SIXTY_DAY_PLAN.endDate)} · Fase ${phase.n} — ${phase.name}`
        : `${shortDate(SIXTY_DAY_PLAN.startDate)} → ${shortDate(SIXTY_DAY_PLAN.endDate)} · dia ${Math.min(day, 60)} de 60 · Fase ${phase.n} — ${phase.name}`;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <MonoLabel>plano 60 dias</MonoLabel>
        <p className="text-xs text-text-subtle">{subtitle}</p>
      </div>

      {tasksQuery.isLoading || paceLoading ? (
        <PlanSkeleton />
      ) : tasksQuery.isError || tasks === null ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-error-fg">
            Não foi possível carregar o plano de 60 dias.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void tasksQuery.refetch();
              void pace.today.refetch();
              void pace.week.refetch();
              void pace.plan.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <PlanContent
          pipelineDetected={prospectingPipelineId !== null}
          planStarted={pace.planStarted}
          todayFunnel={pace.today.data?.data.funnel ?? null}
          weekFunnel={pace.week.data?.data.funnel ?? null}
          planFunnel={pace.plan.data?.data.funnel ?? null}
          tasks={tasks}
          now={now}
        />
      )}
    </section>
  );
}

function PlanContent({
  pipelineDetected,
  planStarted,
  todayFunnel,
  weekFunnel,
  planFunnel,
  tasks,
  now,
}: {
  pipelineDetected: boolean;
  planStarted: boolean;
  todayFunnel: PaceFunnelStage[] | null;
  weekFunnel: PaceFunnelStage[] | null;
  planFunnel: PaceFunnelStage[] | null;
  tasks: PlanTask[];
  now: Date;
}) {
  // funnel null com funil detectado = a métrica falhou/não carregou — coisa
  // diferente de "não há funil", e o hint não pode mentir sobre qual é o caso.
  const noPipelineHint = pipelineDetected
    ? "métricas indisponíveis agora"
    : "funil de prospecção não detectado";
  const targets = SIXTY_DAY_PLAN.dailyTargets;

  const today = todayFunnel ? pickPlanNumbers(todayFunnel) : null;
  const week = weekFunnel ? pickPlanNumbers(weekFunnel) : null;
  const plan = planFunnel ? pickPlanNumbers(planFunnel) : null;

  const todayDelta =
    today && today.openingsPrev !== null
      ? percentChange(today.openings, today.openingsPrev)
      : undefined;
  const weekDelta =
    week && week.openingsPrev !== null
      ? percentChange(week.openings, week.openingsPrev)
      : undefined;

  const daysDone = businessDaysMonToYesterday(now);
  const weekTargetSoFar = targets.openings * daysDone;

  const cp = nextCheckpoint(now);
  const xrayCp = SIXTY_DAY_PLAN.checkpoints.find((c) => c.metric === "xray_accepted");
  const xrayHint = !planStarted
    ? `começa segunda ${shortDate(SIXTY_DAY_PLAN.startDate)} · meta ${xrayCp?.target ?? 15} até ${shortDate(xrayCp?.date ?? "2026-08-21")}`
    : plan === null
      ? noPipelineHint
      : plan.xrayStage === null
        ? "etapa de raio-x não encontrada no funil"
        : xrayCp && daysUntil(xrayCp.date, now) >= 0
          ? `meta ${xrayCp.target} até ${shortDate(xrayCp.date)}`
          : `aceites desde ${shortDate(SIXTY_DAY_PLAN.startDate)}`;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aberturas hoje"
          value={today ? today.openings.toLocaleString("pt-BR") : "—"}
          delta={todayDelta}
          hint={
            today
              ? `meta ${targets.openings} · ${targets.openingsPerChip} por chip · vs. último dia útil`
              : noPipelineHint
          }
        />
        <StatCard
          label="Aberturas na semana"
          value={week ? week.openings.toLocaleString("pt-BR") : "—"}
          delta={weekDelta}
          hint={
            week
              ? daysDone > 0
                ? `meta ${weekTargetSoFar.toLocaleString("pt-BR")} até ontem · ${SIXTY_DAY_PLAN.weekTargetOpenings} na semana`
                : `semana começando · meta ${SIXTY_DAY_PLAN.weekTargetOpenings}`
              : noPipelineHint
          }
        />
        <StatCard
          label="Raios-x no plano"
          value={plan && plan.xrayStage !== null ? plan.xray.toLocaleString("pt-BR") : "—"}
          hint={xrayHint}
        />
        <StatCard
          label="Próximo checkpoint"
          value={cp ? shortDate(cp.date) : shortDate(SIXTY_DAY_PLAN.endDate)}
          hint={
            cp
              ? `${cp.title} · ${daysUntil(cp.date, now) === 0 ? "é hoje" : `em ${daysUntil(cp.date, now)} dias`} · ${cp.ruleShort}`
              : "plano encerrado — revisão final feita"
          }
        />
      </div>

      <TasksCard tasks={tasks} now={now} />
    </>
  );
}

function TasksCard({ tasks, now }: { tasks: PlanTask[]; now: Date }) {
  const update = useUpdatePlanTask();
  const todayIso = bahiaCivilDate(now).iso;

  const isOpen = (t: PlanTask) => t.status === "pending";
  const isLate = (t: PlanTask) => isOpen(t) && t.due_date !== null && t.due_date < todayIso;
  const isToday = (t: PlanTask) => isOpen(t) && t.due_date === todayIso;

  const sorted = [...tasks].sort((a, b) => {
    const rank = (t: PlanTask) =>
      isLate(t) || isToday(t) ? 0 : isOpen(t) ? 1 : 2;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.phase !== b.phase) return a.phase - b.phase;
    if (a.position !== b.position) return a.position - b.position;
    return a.slug.localeCompare(b.slug);
  });

  const pending = tasks.filter(isOpen).length;

  return (
    <Card className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">Tarefas do plano</h2>
        <span className="text-xs text-text-subtle">
          {pending === 0
            ? "nenhuma pendente"
            : `${pending} pendente${pending === 1 ? "" : "s"}`}
        </span>
      </div>

      <PhaseProgress tasks={tasks} />

      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">
          Sem tarefas ainda — o seed do plano cria as da Fase 0.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((t) => {
            const done = t.status === "done";
            const resolved = t.status !== "pending";
            return (
              <li
                key={t.id}
                className="group flex items-center gap-3 rounded-[10px] px-2 py-2 transition-colors duration-fast hover:bg-surface-elevated"
              >
                <button
                  type="button"
                  aria-label={done ? `Reabrir "${t.title}"` : `Concluir "${t.title}"`}
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({ id: t.id, status: done ? "pending" : "done" })
                  }
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-fast",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    done
                      ? "border-transparent bg-accent text-accent-foreground"
                      : "border-border-strong bg-transparent text-transparent hover:border-accent-500",
                  )}
                >
                  <Check size={12} weight="bold" aria-hidden />
                </button>

                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    resolved ? "text-text-subtle line-through" : "text-text",
                  )}
                  title={t.description ?? t.title}
                >
                  {t.title}
                </span>

                <span className="shrink-0 rounded-[6px] bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text-muted">
                  {OWNER_LABEL[t.owner] ?? t.owner}
                </span>

                {t.due_date && !resolved && (
                  <span
                    className={cn(
                      "hidden shrink-0 text-[11px] tabular sm:block",
                      isLate(t)
                        ? "font-semibold text-error-fg"
                        : isToday(t)
                          ? "font-semibold text-text"
                          : "text-text-subtle",
                    )}
                  >
                    {isLate(t)
                      ? `atrasada · ${shortDate(t.due_date)}`
                      : isToday(t)
                        ? "hoje"
                        : shortDate(t.due_date)}
                  </span>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ações de "${t.title}"`}
                      className="h-8 w-8 shrink-0 opacity-0 transition-opacity duration-fast focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <DotsThree size={18} weight="bold" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem
                      onClick={() =>
                        update.mutate({
                          id: t.id,
                          status: t.status === "pending" ? "done" : "pending",
                        })
                      }
                    >
                      {t.status === "pending" ? "Concluir" : "Reabrir"}
                    </DropdownMenuItem>
                    {t.status !== "skipped" && (
                      <DropdownMenuItem
                        onClick={() => update.mutate({ id: t.id, status: "skipped" })}
                      >
                        Pular
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Barras finas de done/total por fase — só as fases que TÊM tarefas. */
function PhaseProgress({ tasks }: { tasks: PlanTask[] }) {
  const rows = SIXTY_DAY_PLAN.phases
    .map((p) => {
      const all = tasks.filter((t) => t.phase === p.n);
      const done = all.filter((t) => t.status !== "pending").length;
      return { phase: p, total: all.length, done };
    })
    .filter((r) => r.total > 0);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.phase.n} className="flex items-center gap-3">
          <span
            className="w-32 shrink-0 truncate text-xs text-text-muted"
            title={`Fase ${r.phase.n} — ${r.phase.name}`}
          >
            F{r.phase.n} · {r.phase.name}
          </span>
          <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-[6px] bg-surface-elevated">
            <div
              className="h-full rounded-[6px] bg-accent"
              style={{ width: `${r.total > 0 ? (r.done / r.total) * 100 : 0}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-xs font-bold text-text tabular">
            {r.done}/{r.total}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[148px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-card" />
    </div>
  );
}
