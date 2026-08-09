/**
 * Datas do plano de 60 dias no fuso civil de America/Bahia.
 *
 * O offset é FIXO em −03:00 — a Bahia não tem horário de verão desde 2019, e
 * essa é a razão de não puxar Intl/timezone aqui: aritmética de UTC com offset
 * constante é pura, roda igual no browser, na rota e no cron, e é testável sem
 * relógio. Se o Brasil recriar o horário de verão, este arquivo é O lugar a
 * mudar.
 *
 * Todas as funções recebem `now` como parâmetro (mesma regra do periodRange):
 * o chamador congela o instante do render/tick e dois números da mesma tela
 * nunca caem em lados opostos da virada do dia.
 */
import { SIXTY_DAY_PLAN, type PlanCheckpoint, type PlanPhase } from "./sixty-day-plan";

/** UTC = hora civil da Bahia + 3h. */
const BAHIA_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CivilDate {
  y: number;
  m: number; // 0-based, como Date
  d: number;
  /** 0 = domingo … 6 = sábado. */
  dow: number;
  /** YYYY-MM-DD. */
  iso: string;
}

/** A data civil (America/Bahia) do instante `now`. */
export function bahiaCivilDate(now: Date): CivilDate {
  const shifted = new Date(now.getTime() - BAHIA_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { y, m, d, dow: shifted.getUTCDay(), iso };
}

/** Meia-noite civil da Bahia do dia (y, m, d) como instante UTC. */
function civilMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d) + BAHIA_OFFSET_MS);
}

/** 00:00 de hoje (Bahia). */
export function bahiaStartOfDay(now: Date): Date {
  const c = bahiaCivilDate(now);
  return civilMidnight(c.y, c.m, c.d);
}

/** 00:00 de amanhã (Bahia). */
export function bahiaStartOfNextDay(now: Date): Date {
  return new Date(bahiaStartOfDay(now).getTime() + DAY_MS);
}

/** 00:00 da segunda-feira desta semana (Bahia). */
export function bahiaStartOfWeek(now: Date): Date {
  const c = bahiaCivilDate(now);
  const daysFromMonday = (c.dow + 6) % 7;
  return civilMidnight(c.y, c.m, c.d - daysFromMonday);
}

export function isBusinessDayBahia(now: Date): boolean {
  const dow = bahiaCivilDate(now).dow;
  return dow >= 1 && dow <= 5;
}

/**
 * A janela do último dia ÚTIL antes de hoje: [00:00, 24:00) civil.
 * Segunda-feira olha para sexta — "ontem" num resumo de segunda seria domingo,
 * e domingo sem meta faria todo começo de semana parecer fracasso.
 */
export function previousBusinessDayWindow(now: Date): { from: Date; to: Date; label: string } {
  const c = bahiaCivilDate(now);
  let back = 1;
  if (c.dow === 1) back = 3; // seg → sex
  else if (c.dow === 0) back = 2; // dom → sex
  else if (c.dow === 6) back = 1; // sáb → sex
  const from = civilMidnight(c.y, c.m, c.d - back);
  const to = new Date(from.getTime() + DAY_MS);
  const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
  const fc = bahiaCivilDate(from);
  return {
    from,
    to,
    label: `${WEEKDAY[fc.dow]} ${String(fc.d).padStart(2, "0")}/${String(fc.m + 1).padStart(2, "0")}`,
  };
}

/** Dias úteis desta semana JÁ ENCERRADOS (segunda até ontem, inclusive). */
export function businessDaysMonToYesterday(now: Date): number {
  const c = bahiaCivilDate(now);
  if (c.dow === 0) return 5; // domingo: semana útil inteira já passou
  if (c.dow === 6) return 5; // sábado: idem
  return Math.max(0, c.dow - 1); // seg=0, ter=1, … sex=4
}

/** Dia N do plano (1 = 10/08). Antes do início devolve ≤ 0. */
export function planDayNumber(now: Date): number {
  const c = bahiaCivilDate(now);
  const start = SIXTY_DAY_PLAN.startDate;
  const [sy, sm, sd] = start.split("-").map(Number) as [number, number, number];
  const diff = Math.round((Date.UTC(c.y, c.m, c.d) - Date.UTC(sy, sm - 1, sd)) / DAY_MS);
  return diff + 1;
}

/** Instante UTC do início civil do plano (00:00 de 10/08, Bahia). */
export function planStartInstant(): Date {
  const [y, m, d] = SIXTY_DAY_PLAN.startDate.split("-").map(Number) as [number, number, number];
  return civilMidnight(y, m - 1, d);
}

export function currentPhase(now: Date): PlanPhase {
  const iso = bahiaCivilDate(now).iso;
  const found = SIXTY_DAY_PLAN.phases.find((p) => iso >= p.from && iso <= p.to);
  if (found) return found;
  // Antes da Fase 0 ⇒ Fase 0; depois do fim ⇒ última fase.
  const first = SIXTY_DAY_PLAN.phases[0]!;
  const last = SIXTY_DAY_PLAN.phases[SIXTY_DAY_PLAN.phases.length - 1]!;
  return iso < first.from ? first : last;
}

/** O próximo checkpoint (inclui o de hoje até o fim do dia). null = plano encerrado. */
export function nextCheckpoint(now: Date): PlanCheckpoint | null {
  const iso = bahiaCivilDate(now).iso;
  return SIXTY_DAY_PLAN.checkpoints.find((cp) => cp.date >= iso) ?? null;
}

/** Dias civis de hoje até a data (0 = é hoje). */
export function daysUntil(dateIso: string, now: Date): number {
  const c = bahiaCivilDate(now);
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(c.y, c.m, c.d)) / DAY_MS);
}

/** "21/08" a partir de "2026-08-21". */
export function shortDate(dateIso: string): string {
  const [, m, d] = dateIso.split("-");
  return `${d}/${m}`;
}
