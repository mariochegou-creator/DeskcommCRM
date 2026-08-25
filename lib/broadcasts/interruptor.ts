/**
 * O interruptor geral dos disparos (0108).
 *
 * Espelho deliberado de `automacaoDesligada` (lib/agendamento/envio.ts) — mesma
 * forma, mesma disciplina FAIL-CLOSED — mas em chave própria
 * (`organizations.settings.broadcasts`), pela razão que o schema em
 * lib/schemas/settings.ts documenta: "a IA está calada?" e "os disparos podem
 * rodar?" são perguntas diferentes, e a org roda com a primeira respondida SIM.
 *
 * FAIL-CLOSED: leitura que falha vira DESLIGADO. Entre não mandar e mandar sem
 * saber se era permitido, o erro caro é o segundo — no WhatsApp do lead não
 * existe botão de desfazer, e aqui não é uma mensagem, são centenas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { broadcastsSettingsSchema, type BroadcastsSettings } from "@/lib/schemas/settings";

export async function lerConfigDeDisparos(
  admin: SupabaseClient,
  organizationId: string,
): Promise<BroadcastsSettings | null> {
  const { data, error } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    logger.error("[disparador] interruptor ilegível — tratando como desligado", {
      organizationId,
      error: error.message,
    });
    return null;
  }

  const settings = (data as { settings?: unknown } | null)?.settings;
  const bruto =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).broadcasts
      : undefined;
  return broadcastsSettingsSchema.parse(bruto);
}

/** `true` = não pode disparar agora. Erro de leitura também devolve `true`. */
export async function disparosDesligados(
  admin: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  const cfg = await lerConfigDeDisparos(admin, organizationId);
  return cfg === null || !cfg.enabled;
}
