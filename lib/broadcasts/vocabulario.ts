/**
 * Vocabulário do disparador (0108) — pareado com os CHECKs da migration sob
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 *
 * Constante compartilhada, nunca string literal no emissor: é assim que o
 * invariante consegue comparar os dois lados. Mudar um valor aqui sem mudar o
 * CHECK (ou vice-versa) reprova no CI.
 */

/** Estados de uma campanha. Ordem = ciclo de vida. */
export const STATUS_DE_CAMPANHA = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "done",
  "cancelled",
] as const;
export type StatusDeCampanha = (typeof STATUS_DE_CAMPANHA)[number];

/** Estados de um destinatário dentro da campanha. */
export const STATUS_DE_DESTINATARIO = [
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type StatusDeDestinatario = (typeof STATUS_DE_DESTINATARIO)[number];

/** Tipos de mídia que uma campanha pode carregar (1 por campanha). */
export const TIPOS_DE_MIDIA = ["audio", "video", "image"] as const;
export type TipoDeMidia = (typeof TIPOS_DE_MIDIA)[number];

/**
 * Por que um contato não recebeu. Vira frase na tela — "0 enviados" mudo é o
 * que faz o operador achar que o disparador está quebrado quando na verdade o
 * público inteiro estava sem telefone.
 */
export const MOTIVOS_DE_PULO = {
  sem_telefone: "Contato sem telefone cadastrado.",
  bloqueado: "O contato pediu para não ser mais contatado.",
  anonimizado: "Contato anonimizado (LGPD).",
  contato_fundido: "Contato foi fundido em outro cadastro.",
  telefone_divergente:
    "O telefone não bate com o WhatsApp do contato — a mensagem sairia e não chegaria.",
  sem_sessao: "Nenhum número de WhatsApp conectado para falar com este contato.",
} as const;
export type MotivoDePulo = keyof typeof MOTIVOS_DE_PULO;

/**
 * Por que a campanha parou sozinha. Distinguir do pause manual é o que evita o
 * operador ficar olhando pra uma campanha parada sem saber que o chip caiu.
 */
export const MOTIVOS_DE_PAUSA = {
  manual: "Pausada por quem opera.",
  sessao_caiu: "O número do WhatsApp desconectou — reconecte e retome.",
  copy_repetida:
    "O texto saiu igual demais nos últimos envios deste número. Adicione variações antes de retomar.",
  interruptor_da_org: "Os disparos estão desligados nas configurações da organização.",
} as const;
export type MotivoDePausa = keyof typeof MOTIVOS_DE_PAUSA;

export function fraseDoPulo(motivo: string | null): string {
  if (!motivo) return "Sem motivo registrado.";
  return MOTIVOS_DE_PULO[motivo as MotivoDePulo] ?? motivo;
}

export function fraseDaPausa(motivo: string | null): string {
  if (!motivo) return "Pausada.";
  return MOTIVOS_DE_PAUSA[motivo as MotivoDePausa] ?? motivo;
}
