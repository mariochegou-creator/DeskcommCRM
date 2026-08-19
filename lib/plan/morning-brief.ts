/**
 * Monta o TEXTO do resumo bom-dia do plano de 60 dias (WhatsApp, 8h30).
 *
 * Função PURA de propósito: o cron plan-morning-brief coleta os números
 * (fn_prospecting_metrics + plan_tasks + reuniões do dia) e este módulo só
 * transforma em texto — assim o formato tem teste unitário sem banco, e um bug
 * de copy nunca se esconde atrás de um mock de RPC.
 *
 * CURTO DE PROPÓSITO (pedido do Mario, 19/08/2026): a primeira versão levava
 * rotina inteira + fases + checkpoint todo dia e ficou "meio confusa". O que
 * sobrou é só o que muda a manhã de quem lê: as reuniões DE HOJE, as tarefas
 * DELE, e uma linha de números de ontem. A rotina é decorada em uma semana;
 * repetir todo dia era ruído.
 *
 * PERSONALIZADO por destinatário: "Bom dia, Mario" e só as tarefas dele (e da
 * dupla). O texto único pra todo mundo obrigava cada um a garimpar a sua parte.
 *
 * Formato WhatsApp: *asteriscos* para negrito, sem links nem emoji — o guia da
 * NEXO limita emoji e este texto chega TODO dia; decoração diária vira ruído
 * em uma semana.
 */
import {
  bahiaCivilDate,
  daysUntil,
  nextCheckpoint,
  planDayNumber,
  shortDate,
} from "./dates";
import { OWNER_LABEL, PLAN_OWNERS, SIXTY_DAY_PLAN, type PlanOwner } from "./sixty-day-plan";

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

/** Uma reunião de hoje, já formatada pelo cron (que conhece o fuso e o card). */
export interface BriefMeeting {
  /** "10h" ou "10h30" — como se fala. */
  hora: string;
  /** "raio-x" | "R1" | "R2", já rotulado. */
  tipo: string;
  /** Título do card; null quando o lead não tem nome. */
  negocio: string | null;
}

export interface MorningBriefInput {
  now: Date;
  /** Nome do destinatário como está na config — personaliza saudação e tarefas. */
  recipientName: string;
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
  /** Reuniões marcadas pra HOJE, em ordem de horário. */
  meetings: BriefMeeting[];
}

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** A quantos dias o checkpoint ainda entra no brief. Longe disso, é ruído diário. */
const CHECKPOINT_JANELA_DIAS = 2;

export function buildMorningBrief(input: MorningBriefInput): string {
  const { now } = input;
  const civil = bahiaCivilDate(now);
  const day = planDayNumber(now);

  const lines: string[] = [];

  const nome = primeiroNome(input.recipientName);
  const saudacao = nome ? `Bom dia, ${nome}!` : "Bom dia!";
  const dateLabel = `${WEEKDAY[civil.dow]} ${shortDate(civil.iso)}`;
  lines.push(
    day < 1
      ? `*${saudacao} · ${dateLabel} · plano começa ${shortDate(SIXTY_DAY_PLAN.startDate)}*`
      : `*${saudacao} · ${dateLabel} · dia ${Math.min(day, 60)} de 60*`,
  );

  lines.push("");
  if (input.meetings.length === 0) {
    lines.push("Sem reunião marcada pra hoje.");
  } else {
    lines.push("*Reuniões de hoje*");
    for (const m of input.meetings) {
      lines.push(`- ${m.hora} — ${m.tipo} com ${m.negocio ?? "(card sem nome)"}`);
    }
  }

  lines.push("");
  lines.push(...taskLines(input.tasks, input.recipientName, civil.iso));

  const numeros = numbersLine(input);
  if (numeros) {
    lines.push("");
    lines.push(numeros);
  }
  const attention = attentionLine(input);
  if (attention) {
    if (!numeros) lines.push("");
    lines.push(attention);
  }

  const cp = nextCheckpoint(now);
  if (cp) {
    const dias = daysUntil(cp.date, now);
    if (dias <= CHECKPOINT_JANELA_DIAS) {
      const quando = dias === 0 ? "é HOJE" : `em ${dias} dia${dias === 1 ? "" : "s"}`;
      const acumulado =
        cp.metric === "xray_accepted" && input.planXray !== null
          ? ` Acumulado: ${input.planXray} de ${cp.target}.`
          : "";
      lines.push("");
      lines.push(`Checkpoint ${shortDate(cp.date)} (${quando}): ${cp.rule}${acumulado}`);
    }
  }

  return lines.join("\n");
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/** "Ontem (seg 18/08): 32 de 40 aberturas · 3 respostas · 1 raio-x" */
function numbersLine(input: MorningBriefInput): string | null {
  if (!input.yesterday) return null;
  const y = input.yesterday;
  const alvo = SIXTY_DAY_PLAN.dailyTargets.openings;
  const respostas =
    y.contacted === 0
      ? "ninguém contatado"
      : `${y.replied} resposta${y.replied === 1 ? "" : "s"}`;
  const xray = `${y.xray} raio${y.xray === 1 ? "-x" : "s-x"}`;
  return `Ontem (${input.yesterdayLabel}): ${y.openings} de ${alvo} aberturas · ${respostas} · ${xray}`;
}

/** Uma linha de alerta no máximo — a mais urgente. Ritmo da semana ganha do dia. */
function attentionLine(input: MorningBriefInput): string | null {
  const targets = SIXTY_DAY_PLAN.dailyTargets;
  if (input.weekOpenings !== null && input.weekBusinessDaysDone > 0) {
    const weekTarget = targets.openings * input.weekBusinessDaysDone;
    if (input.weekOpenings < weekTarget) {
      const falta = weekTarget - input.weekOpenings;
      return `Faltam ${falta} aberturas pra fechar a meta da semana.`;
    }
  }
  if (input.yesterday && input.yesterday.openings < targets.openings) {
    const falta = targets.openings - input.yesterday.openings;
    return `Ontem ficaram ${falta} aberturas abaixo da meta.`;
  }
  return null;
}

/** O dono do plano correspondente ao destinatário; null quando o nome não bate. */
function ownerDoDestinatario(recipientName: string): PlanOwner | null {
  const primeiro = primeiroNome(recipientName).toLowerCase();
  for (const owner of PLAN_OWNERS) {
    if (OWNER_LABEL[owner].toLowerCase() === primeiro) return owner;
  }
  return null;
}

/**
 * Só as tarefas DE QUEM RECEBE (mais as da dupla). Tarefa do Claude nunca entra
 * — cobrança de robô de manhã não muda a manhã de ninguém. Destinatário que não
 * bate com dono nenhum (um número novo na config) vê tudo que é de humano, pra
 * mensagem nunca esconder trabalho por causa de um cadastro.
 */
function taskLines(tasks: BriefTask[], recipientName: string, todayIso: string): string[] {
  const owner = ownerDoDestinatario(recipientName);
  const minhas = tasks.filter((t) =>
    t.owner === "claude" ? false : owner === null || t.owner === owner || t.owner === "dupla",
  );

  if (minhas.length === 0) {
    return ["Sem tarefa pontual hoje — foco na rotina."];
  }

  const out: string[] = ["*Suas tarefas*"];
  for (const t of minhas) {
    const overdue =
      t.due_date && t.due_date < todayIso ? ` (atrasada — era ${shortDate(t.due_date)})` : "";
    out.push(`- ${t.title}${overdue}`);
  }
  return out;
}
