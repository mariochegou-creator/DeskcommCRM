import { RAW_GUIDES, type RawGuide } from "./content/generated";
import { parseGuide, type ParsedGuide } from "./markdown";

export type { Block, Inline, GuideSection, ParsedGuide } from "./markdown";

export interface Guide extends Omit<RawGuide, "source">, ParsedGuide {}

/**
 * O parse roda uma vez por processo (módulo é singleton) e o resultado é
 * imutável — guia é conteúdo estático, não muda entre requests.
 */
const GUIDES: Guide[] = RAW_GUIDES.map((raw) => {
  const parsed = parseGuide(raw.source);
  return {
    slug: raw.slug,
    // O título do catálogo vence o `# ` do markdown: é ele que aparece na
    // navegação, e mudar o cabeçalho do arquivo não deve renomear o item de menu.
    title: raw.title,
    description: raw.description,
    audience: raw.audience,
    minutes: raw.minutes,
    sourceFile: raw.sourceFile,
    intro: parsed.intro,
    sections: parsed.sections,
  };
});

export function listGuides(): Guide[] {
  return GUIDES;
}

export function getGuide(slug: string): Guide | null {
  return GUIDES.find((guide) => guide.slug === slug) ?? null;
}
