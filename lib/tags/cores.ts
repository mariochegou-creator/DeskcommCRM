/**
 * A paleta das tags de cliente (0105) — nomes, classes e rótulos.
 *
 * FECHADA de propósito, e é a mesma decisão que o pill de etapa tomou sobre
 * `crm_stages.color`: hex livre escolhido por quem configura não tem garantia
 * nenhuma de contraste, e a tag aparece em 10px na lista do inbox, que é a
 * menor tipografia do app. Oito cores distinguíveis cobrem o uso real (qualificar
 * cliente) sem transformar a tela de Configurações num color picker.
 *
 * O mapa de classes é LITERAL e não template string (`text-tag-${cor}`): o
 * Tailwind varre o código como texto, e classe montada em runtime não entra no
 * CSS gerado — a tag sairia sem cor em produção. Mesma armadilha documentada em
 * lib/kanban/stage-tone.ts.
 */
export const CORES_DE_TAG = [
  "cinza",
  "azul",
  "ciano",
  "verde",
  "ambar",
  "vermelho",
  "roxo",
  "rosa",
] as const;

export type CorDeTag = (typeof CORES_DE_TAG)[number];

export const COR_PADRAO: CorDeTag = "cinza";

/** O que a pessoa lê no seletor de cor. */
export const ROTULO_DA_COR: Record<CorDeTag, string> = {
  cinza: "Cinza",
  azul: "Azul",
  ciano: "Ciano",
  verde: "Verde",
  ambar: "Âmbar",
  vermelho: "Vermelho",
  roxo: "Roxo",
  rosa: "Rosa",
};

/** Chip da tag: fundo a 12% + texto no stop cheio. */
export const CLASSE_DO_CHIP: Record<CorDeTag, string> = {
  cinza: "bg-[color-mix(in_srgb,var(--tag-cinza)_12%,transparent)] text-tag-cinza",
  azul: "bg-[color-mix(in_srgb,var(--tag-azul)_12%,transparent)] text-tag-azul",
  ciano: "bg-[color-mix(in_srgb,var(--tag-ciano)_12%,transparent)] text-tag-ciano",
  verde: "bg-[color-mix(in_srgb,var(--tag-verde)_12%,transparent)] text-tag-verde",
  ambar: "bg-[color-mix(in_srgb,var(--tag-ambar)_12%,transparent)] text-tag-ambar",
  vermelho: "bg-[color-mix(in_srgb,var(--tag-vermelho)_12%,transparent)] text-tag-vermelho",
  roxo: "bg-[color-mix(in_srgb,var(--tag-roxo)_12%,transparent)] text-tag-roxo",
  rosa: "bg-[color-mix(in_srgb,var(--tag-rosa)_12%,transparent)] text-tag-rosa",
};

/** Bolinha sólida — legenda, seletor de cor e o card do Kanban. */
export const CLASSE_DA_BOLINHA: Record<CorDeTag, string> = {
  cinza: "bg-tag-cinza",
  azul: "bg-tag-azul",
  ciano: "bg-tag-ciano",
  verde: "bg-tag-verde",
  ambar: "bg-tag-ambar",
  vermelho: "bg-tag-vermelho",
  roxo: "bg-tag-roxo",
  rosa: "bg-tag-rosa",
};

/** Normaliza o que veio do banco: cor desconhecida vira o padrão, nunca `undefined`. */
export function corDeTag(bruta: string | null | undefined): CorDeTag {
  return (CORES_DE_TAG as readonly string[]).includes(bruta ?? "")
    ? (bruta as CorDeTag)
    : COR_PADRAO;
}

/**
 * A chave de comparação de um nome de tag.
 *
 * As tags aplicadas vivem em `contacts.tags` (text[]) e o catálogo é uma tabela
 * à parte: o encontro entre os dois é por NOME. Sem uma normalização única,
 * "Cliente VIP" no catálogo e "cliente vip" no contato seriam duas tags — a
 * segunda sem cor, e ninguém entenderia por quê. `toLocaleLowerCase("pt-BR")`
 * porque o acento importa aqui: "Órgão" e "órgão" são a mesma tag.
 */
export function chaveDaTag(nome: string): string {
  return nome.trim().toLocaleLowerCase("pt-BR");
}

/** O catálogo como veio da API. */
export interface TagDoCliente {
  id: string;
  name: string;
  color: CorDeTag;
  position: number;
}

/** Índice nome-normalizado → tag, para a lista do inbox e o card do Kanban. */
export function indexaPorNome(tags: TagDoCliente[]): Map<string, TagDoCliente> {
  return new Map(tags.map((t) => [chaveDaTag(t.name), t]));
}
