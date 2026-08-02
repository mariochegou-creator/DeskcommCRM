/**
 * Parser de markdown do subconjunto EXATO usado pelos guias do produto
 * (`docs/guias/*.md`). Não é um markdown completo de propósito: guia é conteúdo
 * que a gente escreve, não que o usuário envia, então suportar o que está em uso
 * — e falhar visível no que não está — vale mais que uma dependência nova de
 * runtime que traz um parser inteiro para renderizar seis tipos de bloco.
 *
 * Suportado: h1/h2/h3, parágrafo, lista (- / número), tabela GFM, citação (>),
 * bloco de código cercado, divisor (---) e o inline `código`, **negrito**,
 * [link](destino).
 *
 * NÃO suportado (e por isso não deve aparecer nos guias): HTML cru, imagem,
 * lista aninhada, tabela sem cabeçalho, ênfase com underline.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][]; align: Align[] }
  | { kind: "quote"; content: Inline[][] }
  | { kind: "code"; text: string; lang: string | null }
  | { kind: "divider" };

export type Align = "left" | "center" | "right";

export interface GuideSection {
  /** Âncora estável, derivada do título. */
  id: string;
  /** 1 = parte (h1), 2 = seção (h2). h3 não abre seção — fica dentro da seção pai. */
  level: 1 | 2;
  title: string;
  blocks: Block[];
  /** Texto puro da seção inteira, minúsculo e sem acento — é o que a busca varre. */
  searchText: string;
}

export interface ParsedGuide {
  title: string;
  /** Parágrafos de citação logo abaixo do h1 — a apresentação do guia. */
  intro: Inline[][];
  sections: GuideSection[];
}

/** Remove acento e caixa: busca por "configuracoes" tem que achar "Configurações". */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function slugify(value: string): string {
  return normalizeForSearch(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;

export function parseInline(raw: string): Inline[] {
  const out: Inline[] = [];
  let cursor = 0;

  for (const match of raw.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) out.push({ kind: "text", text: raw.slice(cursor, start) });

    const token = match[0];
    if (token.startsWith("`")) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      out.push({ kind: "strong", text: token.slice(2, -2) });
    } else {
      const close = token.indexOf("](");
      out.push({
        kind: "link",
        text: token.slice(1, close),
        href: token.slice(close + 2, -1),
      });
    }
    cursor = start + token.length;
  }

  if (cursor < raw.length) out.push({ kind: "text", text: raw.slice(cursor) });
  return out.length > 0 ? out : [{ kind: "text", text: raw }];
}

export function inlineToText(content: Inline[]): string {
  return content.map((node) => node.text).join("");
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function readAlign(cells: string[]): Align[] {
  return cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

/** Linha de separação de tabela: `---`, `:--`, `--:`, `:-:` em toda célula. */
function isTableDivider(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  /**
   * Leitura de linha fora do intervalo devolve string vazia. O projeto roda com
   * `noUncheckedIndexedAccess`, e cada laço aqui já testa `i < lines.length`
   * antes de ler — espalhar `?? ""` em 15 pontos escondia essa checagem no ruído.
   */
  const at = (index: number): string => lines[index] ?? "";

  while (i < lines.length) {
    const line = at(i);

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Divisor. Vem antes da checagem de tabela porque `---` sozinho não é tabela.
    if (/^-{3,}\s*$/.test(line.trim())) {
      blocks.push({ kind: "divider" });
      i += 1;
      continue;
    }

    // Código cercado.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(at(i))) {
        body.push(at(i));
        i += 1;
      }
      i += 1; // fecha a cerca
      blocks.push({ kind: "code", text: body.join("\n"), lang });
      continue;
    }

    // Títulos.
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = (heading[1] ?? "#").length as 1 | 2 | 3;
      const text = (heading[2] ?? "").trim();
      blocks.push({ kind: "heading", level, text, id: slugify(text) });
      i += 1;
      continue;
    }

    // Tabela: exige cabeçalho + linha de separação. Sem separador não é tabela.
    if (line.includes("|") && i + 1 < lines.length && isTableDivider(at(i + 1))) {
      const head = splitTableRow(line).map(parseInline);
      const align = readAlign(splitTableRow(at(i + 1)));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && at(i).includes("|") && at(i).trim() !== "") {
        rows.push(splitTableRow(at(i)).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: "table", head, rows, align });
      continue;
    }

    // Citação.
    if (line.startsWith(">")) {
      const content: Inline[][] = [];
      while (i < lines.length && at(i).startsWith(">")) {
        const text = at(i).replace(/^>\s?/, "").trim();
        if (text !== "") content.push(parseInline(text));
        i += 1;
      }
      blocks.push({ kind: "quote", content });
      continue;
    }

    // Listas.
    const bullet = /^\s*-\s+(.*)$/;
    const numbered = /^\s*\d+\.\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: Inline[][] = [];
      while (i < lines.length && pattern.test(at(i))) {
        items.push(parseInline((at(i).match(pattern)?.[1] ?? "").trim()));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Parágrafo: junta linhas até a próxima linha em branco ou início de outro bloco.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      at(i).trim() !== "" &&
      !/^(#{1,3}\s|>|```|-{3,}\s*$)/.test(at(i)) &&
      !bullet.test(at(i)) &&
      !numbered.test(at(i)) &&
      !(at(i).includes("|") && i + 1 < lines.length && isTableDivider(at(i + 1)))
    ) {
      paragraph.push(at(i).trim());
      i += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    }
  }

  return blocks;
}

function blockToText(block: Block): string {
  switch (block.kind) {
    case "heading":
      return block.text;
    case "paragraph":
      return inlineToText(block.content);
    case "list":
      return block.items.map(inlineToText).join(" ");
    case "table":
      return [
        ...block.head.map(inlineToText),
        ...block.rows.flatMap((row) => row.map(inlineToText)),
      ].join(" ");
    case "quote":
      return block.content.map(inlineToText).join(" ");
    case "code":
      return block.text;
    case "divider":
      return "";
  }
}

/**
 * Agrupa os blocos em seções navegáveis. h1 abre uma parte, h2 abre uma seção;
 * h3 e o resto ficam dentro da seção corrente — o índice lateral tem dois níveis
 * porque três já não cabem na largura da barra.
 */
export function parseGuide(source: string): ParsedGuide {
  const blocks = parseBlocks(source);
  const sections: GuideSection[] = [];
  let title = "Guia";
  let intro: Inline[][] = [];
  let current: GuideSection | null = null;
  let seenTitle = false;

  for (const block of blocks) {
    if (block.kind === "heading" && block.level === 1 && !seenTitle) {
      title = block.text;
      seenTitle = true;
      continue;
    }

    if (!current && block.kind === "quote") {
      intro = [...intro, ...block.content];
      continue;
    }

    if (block.kind === "heading" && (block.level === 1 || block.level === 2)) {
      current = {
        id: block.id,
        level: block.level,
        title: block.text,
        blocks: [],
        searchText: "",
      };
      sections.push(current);
      continue;
    }

    if (!current) continue; // conteúdo solto antes da primeira seção: descartado
    if (block.kind === "divider") continue; // o divisor de seção vira o próprio card
    current.blocks.push(block);
  }

  for (const section of sections) {
    section.searchText = normalizeForSearch(
      [section.title, ...section.blocks.map(blockToText)].join(" "),
    );
  }

  return { title, intro, sections };
}
