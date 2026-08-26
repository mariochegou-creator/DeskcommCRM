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

import { FATOS_KEY } from "@/lib/leads/fatos-do-cliente";

export const GANCHO_KEY_RE = /gancho|hook|icebreaker|abertura/i;

const MAPS_KEY_RE = /google.?maps|^maps$|place_?url/i;

/**
 * Autor-marcador da nota semeada com os ganchos. Também é o dedupe: a rota de
 * notas só semeia se a conversa ainda não tem nota com este autor. Mudar o
 * texto re-semearia todas as conversas já abertas.
 */
export const GANCHO_NOTE_AUTHOR = "Ganchos de prospecção";

export interface GanchoDoLead {
  /** A chave crua em custom_fields — identidade estável para o <Select>. */
  chave: string;
  /** O que o SDR lê no seletor. */
  rotulo: string;
  texto: string;
}

/**
 * Rótulos das chaves que a importação de prospecção realmente grava. O resto
 * (webhook, planilha de terceiro) cai no embelezamento genérico — mostrar
 * `gancho_extra_2` cru é feio, mas inventar nome para chave desconhecida
 * esconderia de qual campo o texto saiu.
 */
const ROTULO_DO_GANCHO: Record<string, string> = {
  gancho_abertura: "Gancho 1 — abertura",
  gancho_2: "Gancho 2 — segundo toque",
};

function rotularGancho(chave: string): string {
  const conhecido = ROTULO_DO_GANCHO[chave.toLowerCase()];
  if (conhecido) return conhecido;
  const limpo = chave.replace(/[_-]+/g, " ").trim();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * Os ganchos COM a chave de onde saíram. Ordem de inserção, sem vazios.
 *
 * `extractGanchos` (só os textos) continua sendo o que as superfícies de
 * LEITURA usam — nota semeada, painel do inbox, dossiê. Esta existe para o
 * seletor de primeiro toque, que precisa de identidade estável por item: dois
 * ganchos com o mesmo texto (acontece em lista reimportada) colidiriam como
 * chave de React e o segundo sumiria da lista.
 */
export function listarGanchos(customFields: unknown): GanchoDoLead[] {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return [];
  }
  const ganchos: GanchoDoLead[] = [];
  for (const [key, value] of Object.entries(customFields as Record<string, unknown>)) {
    if (!GANCHO_KEY_RE.test(key)) continue;
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (v) ganchos.push({ chave: key, rotulo: rotularGancho(key), texto: v });
  }
  return ganchos;
}

/** Colhe os ganchos de um custom_fields (jsonb → unknown). Ordem de inserção, sem vazios. */
export function extractGanchos(customFields: unknown): string[] {
  return listarGanchos(customFields).map((g) => g.texto);
}

/**
 * Link do Google Maps do negócio, também vindo da lista de prospecção
 * (custom_fields["Google Maps"] ou variações). É o caminho de volta pro
 * anúncio original quando o telefone falha — número fora do WhatsApp, Maps
 * desatualizado. Só aceita URL http(s); qualquer outro valor é ruído de
 * planilha.
 */
export function extractGoogleMapsUrl(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return null;
  }
  for (const [key, value] of Object.entries(customFields as Record<string, unknown>)) {
    if (!MAPS_KEY_RE.test(key)) continue;
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (/^https?:\/\//i.test(v)) return v;
  }
  return null;
}

/**
 * O resto do dossiê de prospecção: todo custom_field que NÃO é gancho nem
 * link do Maps (esses dois já têm renderização própria). É o que a lista
 * enriquecida manda além dos ganchos — Dores, Entregáveis, Score, Nota
 * Google, Cidade, Instagram, Site, Origem da linha — e também o que o
 * importador do Kaptar grava (tem_site, categoria, score_kaptar…).
 *
 * Valores number/boolean viram string aqui (o Kaptar grava tipados); objeto
 * e array são descartados — campo de dossiê é sempre escalar, estrutura é
 * ruído de webhook.
 */
export function extractExtras(customFields: unknown): Array<[string, string]> {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return [];
  }
  const extras: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(customFields as Record<string, unknown>)) {
    if (GANCHO_KEY_RE.test(key)) continue;
    if (MAPS_KEY_RE.test(key)) continue;
    // "O que o cliente contou" tem seção própria (lib/leads/fatos-do-cliente).
    // Hoje ele é objeto e cairia no `continue` de estrutura logo abaixo — a
    // pulada explícita é para o dia em que um webhook gravar uma string nesta
    // chave e o dossiê ganhar uma linha ilegível sem ninguém ter pedido.
    if (key === FATOS_KEY) continue;
    let v: string;
    if (typeof value === "string") v = value.trim();
    else if (typeof value === "number" || typeof value === "boolean") v = String(value);
    else continue;
    if (v) extras.push([key, v]);
  }
  return extras;
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
