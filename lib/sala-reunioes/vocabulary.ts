/**
 * O vocabulário da Sala de Reuniões — fonte ÚNICA, escrita e leitura.
 *
 * Mesmo contrato do activity-vocabulary: os CHECKs da migration 0098 e estas
 * listas TÊM de concordar (invariante banco×TypeScript). O gate é o compilador
 * — os `Record`s de rótulo são exaustivos, então valor novo sem rótulo não
 * compila; e o teste de invariante compara as listas com os CHECKs do banco.
 */

/** Espelha `crm_meetings_type_check` (0098). */
export const MEETING_TYPES = ["r1", "r2"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  r1: "R1 — Diagnóstico",
  r2: "R2 — Proposta",
};

/** Espelha `crm_meetings_status_check` (0098). */
export const MEETING_STATUSES = [
  "ao_vivo",
  "encerrada",
  "analisando",
  "concluida",
  "concluida_sem_formato",
  "falhou",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  ao_vivo: "Ao vivo",
  encerrada: "Encerrada",
  analisando: "Analisando…",
  concluida: "Concluída",
  // O modelo não devolveu JSON válido nem no retry: o texto cru fica em
  // coaching->>raw e a pessoa lê mesmo assim (padrão done_unformatted da 0098).
  concluida_sem_formato: "Concluída (texto)",
  falhou: "Falhou",
};

/**
 * Espelha `crm_meetings_outcome_check` (0098) — a taxonomia de Rackham da
 * skill r2: reunião de venda termina de quatro jeitos, e só os dois primeiros
 * são progresso.
 */
export const MEETING_OUTCOMES = ["pedido", "avanco", "continuacao", "nao_venda"] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];

export const MEETING_OUTCOME_LABELS: Record<MeetingOutcome, string> = {
  pedido: "Fechou",
  avanco: "Avançou",
  continuacao: "Continuação",
  nao_venda: "Não-venda",
};

/**
 * Espelha `crm_meeting_suggestions_phase_check` (0098).
 *
 * União dos dois roteiros: SPIN da R1 (situação → problema → implicação →
 * necessidade) e Pits da R2 (diagnóstico → objeções → pit1 → extração → pit2).
 * `abertura` e `fechamento` são comuns aos dois.
 */
export const MEETING_PHASES = [
  "abertura",
  "situacao",
  "problema",
  "implicacao",
  "necessidade",
  "diagnostico",
  "objecoes",
  "pit1",
  "extracao",
  "pit2",
  "fechamento",
] as const;
export type MeetingPhase = (typeof MEETING_PHASES)[number];

export const MEETING_PHASE_LABELS: Record<MeetingPhase, string> = {
  abertura: "Abertura",
  situacao: "Situação",
  problema: "Problema",
  implicacao: "Implicação",
  necessidade: "Necessidade",
  diagnostico: "Diagnóstico",
  objecoes: "Objeções",
  pit1: "Pit 1 — Compromisso",
  extracao: "Extração de investimento",
  pit2: "Pit 2 — Apresentação",
  fechamento: "Fechamento",
};

/** As fases que pertencem a cada tipo de reunião (guia do overlay e da análise). */
export const PHASES_BY_TYPE: Record<MeetingType, readonly MeetingPhase[]> = {
  r1: ["abertura", "situacao", "problema", "implicacao", "necessidade", "fechamento"],
  r2: ["abertura", "diagnostico", "objecoes", "pit1", "extracao", "pit2", "fechamento"],
};

/** Um turno da transcrição, como vive no jsonb `crm_meetings.transcript`. */
export interface MeetingTurn {
  /** Índice GLOBAL do turno na reunião — chave da idempotência do append. */
  i: number;
  /** Nome do falante como o Meet legenda ("Você", "Maria Souza"). */
  speaker: string;
  /** true = fala do Mario (quem conduz); false = fala do lead. */
  is_self: boolean;
  text: string;
  /** Segundos desde `started_at` — mesmo relógio de `at_seconds` das sugestões. */
  t: number;
}
