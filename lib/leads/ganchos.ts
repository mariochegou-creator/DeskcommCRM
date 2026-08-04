/**
 * Ganchos de abertura — as frases de puxada de conversa que a ferramenta de
 * prospecção entrega junto com a lista de leads (importada em
 * /app/settings/import-lista).
 *
 * Onde vivem: em `crm_leads.custom_fields`, sob chaves que casam com
 * GANCHO_KEY_RE (`gancho_abertura`, `gancho_2`, `hook`, …). A escolha é de
 * propósito: o webhook de captação já joga campo desconhecido em
 * custom_fields, então gancho vindo por webhook e gancho vindo por importação
 * acabam no MESMO lugar e as duas superfícies de leitura (painel do inbox e
 * nota semeada na conversa) funcionam para ambos sem saber a origem.
 *
 * Módulo puro — sem I/O — porque client (CRMSidePanel) e server (rota de
 * notas) precisam da mesma extração; duas cópias divergiriam.
 */

export const GANCHO_KEY_RE = /gancho|hook|icebreaker|abertura/i;

/**
 * Autor-marcador da nota semeada com os ganchos. Também é o dedupe: a rota de
 * notas só semeia se a conversa ainda não tem nota com este autor. Mudar o
 * texto re-semearia todas as conversas já abertas.
 */
export const GANCHO_NOTE_AUTHOR = "Ganchos de prospecção";

/** Colhe os ganchos de um custom_fields (jsonb → unknown). Ordem de inserção, sem vazios. */
export function extractGanchos(customFields: unknown): string[] {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return [];
  }
  const ganchos: string[] = [];
  for (const [key, value] of Object.entries(customFields as Record<string, unknown>)) {
    if (!GANCHO_KEY_RE.test(key)) continue;
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (v) ganchos.push(v);
  }
  return ganchos;
}

/** Corpo da nota semeada. 4096 é o teto de createNoteSchema — a nota entra pela mesma tabela. */
export function formatGanchoNote(ganchos: string[]): string {
  const unicos = [...new Set(ganchos)];
  const linhas = unicos.length > 1 ? unicos.map((g) => `• ${g}`) : unicos;
  return `Ganchos de abertura (vieram com a lista de prospecção):\n\n${linhas.join("\n")}`.slice(
    0,
    4096,
  );
}
