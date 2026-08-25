/**
 * O estado do anti-ban lido/escrito por supabase-js (0108).
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O motor anti-ban do repo já é bom e já é testado: `decidePacing` e
 * `decideSpinning` são funções PURAS (relógio e rng injetáveis) e ficam onde
 * estão. O que NÃO dá para reusar é o store delas
 * (lib/agent-engine/pacing/store.ts): ele fala com um pool `pg` cru, que só
 * existe dentro do worker longo da IA. Rota de cron no Next fala supabase-js.
 *
 * Então isto aqui é o MESMO store, nas MESMAS tabelas (`channel_knobs`,
 * `pacing_ledger`, `outbound_copies`), traduzido de dialeto. Nenhuma tabela
 * nova, nenhum número novo — se fosse um segundo ledger, o teto diário do chip
 * passaria a ser contado duas vezes pela metade, e o warm-up (que existe para
 * proteger número novo) viraria decoração.
 *
 * CONSEQUÊNCIA IMPORTANTE, E DESEJADA: o disparo e a IA dividem o MESMO
 * orçamento diário do número. Disparar 200 hoje reduz o que o atendimento
 * automático pode mandar hoje. É o comportamento certo — quem toma ban é o
 * chip, e ele não sabe distinguir quem originou a mensagem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { dayStartInTz, type PacingState } from "@/lib/agent-engine/pacing/engine";
import { PACING_DEFAULTS, type PacingKnobs } from "@/lib/agent-engine/pacing/defaults";
import { parseWarmupCaps } from "@/lib/agent-engine/pacing/store";
import { SPINNING_DEFAULTS, type SpinningKnobs } from "@/lib/agent-engine/spinning/defaults";
import {
  hashNormalized,
  normalizeCopy,
  type RecentCopy,
} from "@/lib/agent-engine/spinning/engine";

export interface ConfigDoNumero {
  knobs: PacingKnobs;
  spinning: SpinningKnobs;
  /** null = sem linha em channel_knobs → o motor trata como idade 0 (conservador). */
  numberActivatedAt: Date | null;
  /** channel_sessions.daily_message_limit — o cap absoluto do CRM. */
  crmDailyLimit: number | null;
}

interface LinhaDeKnobs {
  throttle_ms: number | null;
  jitter_max_ms: number | null;
  window_start_hour: number | null;
  window_end_hour: number | null;
  allow_sunday: boolean | null;
  timezone: string | null;
  warmup_daily_caps: unknown;
  spinning_knobs: unknown;
  number_activated_at: string | null;
}

/**
 * Valida o shape dos knobs de spinning. Inválido → defaults conservadores, sem
 * exceção no caminho de envio (mesma disciplina de `parseWarmupCaps`).
 */
function parseSpinningKnobs(value: unknown): SpinningKnobs | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown, fallback: number): number =>
    typeof x === "number" && Number.isFinite(x) ? x : fallback;
  const padroes = Array.isArray(v.allowlistPatterns)
    ? v.allowlistPatterns.filter((p): p is string => typeof p === "string")
    : SPINNING_DEFAULTS.allowlistPatterns;
  return {
    windowSize: num(v.windowSize, SPINNING_DEFAULTS.windowSize),
    similarityThreshold: num(v.similarityThreshold, SPINNING_DEFAULTS.similarityThreshold),
    repetitionThreshold: num(v.repetitionThreshold, SPINNING_DEFAULTS.repetitionThreshold),
    allowlistMaxLength: num(v.allowlistMaxLength, SPINNING_DEFAULTS.allowlistMaxLength),
    allowlistPatterns: padroes,
  };
}

/** Knobs efetivos do número + o cap absoluto do CRM, numa ida só por sessão. */
export async function carregarConfigDoNumero(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<ConfigDoNumero> {
  const [{ data: knobsRow }, { data: sessao }] = await Promise.all([
    admin
      .from("channel_knobs")
      .select(
        "throttle_ms, jitter_max_ms, window_start_hour, window_end_hour, allow_sunday, timezone, warmup_daily_caps, spinning_knobs, number_activated_at",
      )
      .eq("organization_id", organizationId)
      .eq("channel_session_id", channelSessionId)
      .maybeSingle(),
    admin
      .from("channel_sessions")
      .select("daily_message_limit")
      .eq("id", channelSessionId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);

  const crmDailyLimit =
    (sessao as { daily_message_limit: number | null } | null)?.daily_message_limit ?? null;
  const row = knobsRow as LinhaDeKnobs | null;

  if (!row) {
    return {
      knobs: { ...PACING_DEFAULTS },
      spinning: { ...SPINNING_DEFAULTS },
      numberActivatedAt: null,
      crmDailyLimit,
    };
  }

  let warmupDailyCaps = PACING_DEFAULTS.warmupDailyCaps;
  if (row.warmup_daily_caps !== null) {
    const parsed = parseWarmupCaps(row.warmup_daily_caps);
    if (parsed) {
      warmupDailyCaps = parsed;
    } else {
      logger.warn("[disparador] warmup_daily_caps inválido — usando defaults conservadores", {
        organizationId,
        channelSessionId,
      });
    }
  }

  const spinning =
    row.spinning_knobs === null
      ? { ...SPINNING_DEFAULTS }
      : (parseSpinningKnobs(row.spinning_knobs) ?? { ...SPINNING_DEFAULTS });

  return {
    knobs: {
      throttleMs: row.throttle_ms ?? PACING_DEFAULTS.throttleMs,
      jitterMaxMs: row.jitter_max_ms ?? PACING_DEFAULTS.jitterMaxMs,
      windowStartHour: row.window_start_hour ?? PACING_DEFAULTS.windowStartHour,
      windowEndHour: row.window_end_hour ?? PACING_DEFAULTS.windowEndHour,
      allowSunday: row.allow_sunday ?? PACING_DEFAULTS.allowSunday,
      timezone: row.timezone ?? PACING_DEFAULTS.timezone,
      warmupDailyCaps,
    },
    spinning,
    numberActivatedAt: row.number_activated_at ? new Date(row.number_activated_at) : null,
    crmDailyLimit,
  };
}

/**
 * lastSentAt (qualquer dia) + sentToday (desde a meia-noite LOCAL da org).
 *
 * `sentToday` sai de uma contagem com `head: true` — o PostgREST devolve o total
 * no header, sem trazer as linhas. Numa org que dispara há meses o ledger tem
 * dezenas de milhares de linhas e trazer todas para contar em memória seria a
 * forma clássica de o tick estourar o orçamento de tempo.
 */
export async function carregarEstadoDoNumero(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
  input: { now: Date; timezone: string; numberActivatedAt: Date | null },
): Promise<PacingState> {
  const dayStart = dayStartInTz(input.now, input.timezone).toISOString();

  const [{ data: ultima }, { count }] = await Promise.all([
    admin
      .from("pacing_ledger")
      .select("sent_at")
      .eq("organization_id", organizationId)
      .eq("channel_session_id", channelSessionId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("pacing_ledger")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("channel_session_id", channelSessionId)
      .gte("sent_at", dayStart),
  ]);

  const sentAt = (ultima as { sent_at: string } | null)?.sent_at ?? null;
  return {
    lastSentAt: sentAt ? new Date(sentAt) : null,
    sentToday: count ?? 0,
    numberActivatedAt: input.numberActivatedAt,
  };
}

/** As últimas N copies do NÚMERO (across contatos) — a janela do gate de spinning. */
export async function carregarJanelaDeCopies(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
  windowSize: number,
): Promise<RecentCopy[]> {
  const { data } = await admin
    .from("outbound_copies")
    .select("normalized_text, normalized_hash")
    .eq("organization_id", organizationId)
    .eq("channel_session_id", channelSessionId)
    .order("sent_at", { ascending: false })
    .limit(windowSize);

  return ((data ?? []) as { normalized_text: string; normalized_hash: string }[]).map((r) => ({
    normalizedText: r.normalized_text,
    normalizedHash: r.normalized_hash,
  }));
}

/**
 * Registra o envio efetivado nas DUAS contabilidades do anti-ban.
 *
 * Melhor-esforço: a mensagem JÁ saiu quando isto roda. Falhar aqui não pode
 * derrubar o tick nem marcar o destinatário como não-enviado — o pior efeito de
 * um registro perdido é o próximo envio vir um pouco mais cedo do que deveria.
 */
export async function registrarEnvio(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
  corpo: string | null,
  sentAt: Date = new Date(),
): Promise<void> {
  const quando = sentAt.toISOString();
  try {
    const trabalhos: PromiseLike<unknown>[] = [
      admin.from("pacing_ledger").insert({
        organization_id: organizationId,
        channel_session_id: channelSessionId,
        sent_at: quando,
      }),
    ];
    // Mídia sem legenda não tem copy — registrar string vazia poluiria a janela
    // e faria dois áudios seguidos contarem como "template idêntico".
    const texto = (corpo ?? "").trim();
    if (texto) {
      const normalizado = normalizeCopy(texto);
      trabalhos.push(
        admin.from("outbound_copies").insert({
          organization_id: organizationId,
          channel_session_id: channelSessionId,
          normalized_text: normalizado,
          normalized_hash: hashNormalized(normalizado),
          sent_at: quando,
        }),
      );
    }
    await Promise.all(trabalhos);
  } catch (err) {
    logger.warn("[disparador] registro do anti-ban falhou — envio já saiu", {
      organizationId,
      channelSessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
