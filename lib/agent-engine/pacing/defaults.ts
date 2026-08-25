/**
 * Defaults CONSERVADORES do motor anti-ban (F2-11) — a FONTE ÚNICA dos números
 * de pacing do daemon (blueprint 5.2: números anti-ban são fonte única e
 * inconsistente → knobs, nunca constantes). `scripts/lint-pacing.ts` reprova
 * literal de pacing em qualquer outro arquivo de daemon/src.
 *
 * Override por número/sessão: linha em `channel_knobs` (0010) — coluna NULL cai
 * aqui. O CAP DIÁRIO ABSOLUTO não mora aqui nem em channel_knobs: a fonte única
 * é `channel_sessions.daily_message_limit` (regra dura nº 3) — mesmo banco agora,
 * a cadeia de envio lê por query direta e injeta em `decidePacing` (`crmDailyLimit`).
 */

/** Degrau de warm-up: a partir de `minAgeDays` de idade do número vale `cap` envios/dia; `cap: null` = formado (sem cap de warm-up — resta só o limite do CRM). */
export interface WarmupStep {
  minAgeDays: number;
  cap: number | null;
}

export interface PacingKnobs {
  /** Intervalo mínimo entre envios do MESMO número (ms). */
  throttleMs: number;
  /** Teto do jitter randômico somado ao throttle e ao next_allowed_at (ms) — intervalo fixo é assinatura de bot. */
  jitterMaxMs: number;
  /** Janela horária de envio [start, end) na hora local do tenant. */
  windowStartHour: number;
  windowEndHour: number;
  /** Domingo é evitado por default. */
  allowSunday: boolean;
  /** IANA timezone do tenant — a janela é avaliada NELA. */
  timezone: string;
  /** Degraus de warm-up ordenados por minAgeDays crescente (o primeiro cobre idade 0). */
  warmupDailyCaps: WarmupStep[];
}

/**
 * Limites de SANIDADE da edição de knobs no Console (FU-14) — validação de entrada do
 * operador, não defaults de comportamento. Moram aqui porque a doutrina proíbe número de
 * pacing fora deste módulo (scripts/lint-pacing.ts); o Console os importa em vez de
 * cravar literais.
 */
export const KNOB_BOUNDS = {
  /** teto de intervalo/jitter aceito na UI (ms). */
  intervalMaxMs: 600_000,
  /** maior hora aceita como INÍCIO de janela (fim vai até 24). */
  hourLastStart: 23,
  /** fim de janela é exclusivo e pode chegar à meia-noite seguinte. */
  hourEnd: 24,
} as const;

/**
 * Números do DISPARO EM MASSA (0108) — moram aqui pela mesma regra do resto do
 * arquivo: número de pacing é fonte única, nunca literal espalhado.
 *
 * O disparo é mais lento que a conversa de propósito. `throttleMs` de 1,2s é o
 * intervalo entre respostas de um atendimento — gente conversando. Campanha é
 * outra coisa: mesmo texto, muitos destinos, nenhum deles esperando. A doutrina
 * do repo já dizia o número (CLAUDE.md, seção WAHA: "Campanha 1 msg/5s") e a
 * spec do WAHA repetia; faltava alguém implementar.
 *
 * Consequência prática: ~8 envios por tick de 1 minuto. Um público de 300 leva
 * ~40 minutos. É lento, e é o ponto — o chip é o ativo mais caro da operação.
 */
export const BROADCAST_DEFAULTS = {
  /** Intervalo mínimo entre dois envios da MESMA campanha (ms). */
  gapMs: 5000,
  /** Quantos destinatários um tick do cron reivindica por vez. */
  sendsPerTick: 8,
  /** Lease do claim (s) — folga sobre o pior tick (8 × ~6s ≈ 48s). */
  leaseSeconds: 120,
  /** Orçamento de parede do tick (ms): sair antes do `-m55` do curl no scheduler. */
  tickBudgetMs: 50_000,
  /** Tentativas por destinatário antes de marcar `failed` em definitivo. */
  maxAttempts: 3,
} as const;

export const PACING_DEFAULTS: PacingKnobs = {
  throttleMs: 1200, // 1 msg / 1,2s
  jitterMaxMs: 800,
  windowStartHour: 7, // janela 7h-22h
  windowEndHour: 22,
  allowSunday: false,
  timezone: 'America/Sao_Paulo',
  // Número sem linha em channel_knobs é tratado como idade 0 (o degrau mais
  // conservador) até alguém registrar number_activated_at.
  warmupDailyCaps: [
    { minAgeDays: 0, cap: 20 },
    { minAgeDays: 4, cap: 50 },
    { minAgeDays: 8, cap: 100 },
    { minAgeDays: 15, cap: 200 },
    { minAgeDays: 31, cap: null },
  ],
};
