/**
 * Monta o TEXTO do resumo bom-dia do plano de 60 dias (WhatsApp, 8h30).
 *
 * Função PURA de propósito: o cron plan-morning-brief coleta os números
 * (fn_prospecting_metrics + plan_tasks) e este módulo só transforma em texto —
 * assim o formato tem teste unitário sem banco, e um bug de copy nunca se
 * esconde atrás de um mock de RPC.
 *
 * Formato WhatsApp: *asteriscos* para negrito, sem links nem emoji — o guia da
 * NEXO limita emoji e este texto chega TODO dia; decoração diária vira ruído
 * em uma semana.
 */
import {
  bahiaCivilDate,
  currentPhase,
  daysUntil,
  nextCheckpoint,
  planDayNumber,
  shortDate,
} from "./dates";
import {
  OWNER_LABEL,
  PLAN_OWNERS,
  SIXTY_DAY_PLAN,
  type PlanOwner,
} from "./sixty-day-plan";

export interface BriefWindowNumbers {
  openings: number;
  contacted: number;
  replied: number;
  xray: number;
}

export interface BriefTask {
  title: string;
  owner: PlanOwner;
  due_date: string | null;
}

export interface MorningBriefInput {
  now: Date;
  /** "sex 08/08" — o último dia útil, resolvido pelo cron. */
  yesterdayLabel: string;
  /** null = funil de prospecção não detectado (o texto degrada, não quebra). */
  yesterday: BriefWindowNumbers | null;
  weekOpenings: number | null;
  /** Dias úteis da semana já encerrados (meta pro-rata = 40 × isso). */
  weekBusinessDaysDone: number;
  /** Aceites de raio-x acumulados no plano; null = sem funil/etapa. */
  planXray: number | null;
  /** Tarefas PENDENTES de hoje (com prazo até hoje ou sem prazo na fase atual). */
  tasks: BriefTask[];
}

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

export function buildMorningBrief(input: MorningBriefInput): string {
  const { now } = input;
  const civil = bahiaCivilDate(now);
  const day = planDayNumber(now);
  const phase = currentPhase(now);
  const targets = SIXTY_DAY_PLAN.dailyTargets;

  const lines: string[] = [];

  lines.push(`*Bom dia! NEXO — plano 60 dias*`);
  const dateLabel = `${WEEKDAY[civil.dow]} ${shortDate(civil.iso)}`;
  lines.push(
    day < 1
      ? `${dateLabel} · começa segunda ${shortDate(SIXTY_DAY_PLAN.startDate)} · Fase ${phase.n} — ${phase.name}`
      : `${dateLabel} · dia ${Math.min(day, 60)} de 60 · Fase ${phase.n} — ${phase.name}`,
  );

  if (input.yesterday) {
    const y = input.yesterday;
    lines.push("");
    lines.push(`*Ontem (${input.yesterdayLabel})*`);
    lines.push(`Aberturas: ${y.openings} de ${targets.openings}`);
    lines.push(
      y.contacted > 0
        ? `Respostas: ${y.replied} de ${y.contacted} contatados`
        : `Respostas: ninguém contatado`,
    );
    lines.push(`Raios-x marcados: ${y.xray}`);
  }

  if (input.weekOpenings !== null) {
    const weekTarget =
      input.weekBusinessDaysDone > 0
        ? targets.openings * input.weekBusinessDaysDone
        : null;
    lines.push("");
    lines.push(
      weekTarget !== null
        ? `*Semana*: ${input.weekOpenings} de ${weekTarget} aberturas até ontem`
        : `*Semana*: começando — meta ${SIXTY_DAY_PLAN.weekTargetOpenings} aberturas`,
    );
  }

  const attention = attentionLine(input);
  if (attention) {
    lines.push("");
    lines.push(attention);
  }

  lines.push("");
  lines.push(...taskLines(input.tasks, civil.iso));

  lines.push("");
  lines.push(`*Rotina*`);
  for (const r of SIXTY_DAY_PLAN.routine) {
    lines.push(`${r.window}: ${r.what}`);
  }

  const cp = nextCheckpoint(now);
  if (cp) {
    const dias = daysUntil(cp.date, now);
    const quando = dias === 0 ? "é HOJE" : `em ${dias} dia${dias === 1 ? "" : "s"}`;
    const acumulado =
      cp.metric === "xray_accepted" && input.planXray !== null
        ? ` Acumulado: ${input.planXray} de ${cp.target}.`
        : "";
    lines.push("");
    lines.push(`Checkpoint ${shortDate(cp.date)} (${quando}): ${cp.rule}${acumulado}`);
  }

  return lines.join("\n");
}

/** Uma linha de alerta no máximo — a mais urgente. Ritmo da semana ganha do dia. */
function attentionLine(input: MorningBriefInput): string | null {
  const targets = SIXTY_DAY_PLAN.dailyTargets;
  if (input.weekOpenings !== null && input.weekBusinessDaysDone > 0) {
    const weekTarget = targets.openings * input.weekBusinessDaysDone;
    if (input.weekOpenings < weekTarget) {
      const falta = weekTarget - input.weekOpenings;
      return `ATENÇÃO: ritmo da semana abaixo da meta — faltam ${falta} aberturas pra recuperar.`;
    }
  }
  if (input.yesterday && input.yesterday.openings < targets.openings) {
    const falta = targets.openings - input.yesterday.openings;
    return `ATENÇÃO: ontem ficaram ${falta} aberturas abaixo da meta.`;
  }
  return null;
}

function taskLines(tasks: BriefTask[], todayIso: string): string[] {
  if (tasks.length === 0) {
    return ["*Hoje*: sem tarefa pontual — foco total na rotina."];
  }

  const out: string[] = [];
  for (const owner of PLAN_OWNERS) {
    const own = tasks.filter((t) => t.owner === owner);
    if (own.length === 0) continue;
    if (owner === "claude") {
      // Tarefa do Claude não é cobrança pro humano de manhã — vira uma linha.
      out.push(`Com o Claude: ${own.length} tarefa${own.length === 1 ? "" : "s"} em andamento.`);
      continue;
    }
    out.push(`*Hoje — ${OWNER_LABEL[owner]}*`);
    for (const t of own) {
      const overdue =
        t.due_date && t.due_date < todayIso ? ` (atrasada — era ${shortDate(t.due_date)})` : "";
      out.push(`- ${t.title}${overdue}`);
    }
  }
  return out;
}
