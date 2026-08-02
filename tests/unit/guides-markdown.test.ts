import { describe, expect, it } from "vitest";

import { listGuides } from "@/lib/guides";
import {
  inlineToText,
  normalizeForSearch,
  parseBlocks,
  parseGuide,
  type Block,
} from "@/lib/guides/markdown";

/** Lê o primeiro bloco já estreitado pelo `kind` — o teste falha aqui se o parser mudar de opinião. */
function firstBlock<K extends Block["kind"]>(source: string, kind: K): Extract<Block, { kind: K }> {
  const [block] = parseBlocks(source);
  expect(block?.kind).toBe(kind);
  return block as Extract<Block, { kind: K }>;
}

describe("parser de markdown dos guias", () => {
  it("separa texto, código, negrito e link no inline", () => {
    const block = firstBlock(
      "Vá em `Conexões` e clique em **Ligar** — [docs](/app/settings).",
      "paragraph",
    );
    expect(block.content.map((node) => node.kind)).toEqual([
      "text",
      "code",
      "text",
      "strong",
      "text",
      "link",
      "text",
    ]);
    expect(inlineToText(block.content)).toContain("Conexões");
  });

  it("lê tabela com cabeçalho, alinhamento e linhas", () => {
    const block = firstBlock(
      ["| Ação | viewer | agent |", "|---|:--:|---:|", "| Ver Inbox | ✅ | ✅ |"].join("\n"),
      "table",
    );
    expect(block.head).toHaveLength(3);
    expect(block.align).toEqual(["left", "center", "right"]);
    expect(block.rows).toHaveLength(1);
    expect(inlineToText(block.rows[0]?.[0] ?? [])).toBe("Ver Inbox");
  });

  it("não confunde divisor de seção com tabela", () => {
    const blocks = parseBlocks("---\n\ntexto");
    expect(blocks[0]?.kind).toBe("divider");
    expect(blocks[1]?.kind).toBe("paragraph");
  });

  it("separa lista ordenada de não-ordenada", () => {
    const blocks = parseBlocks("- um\n- dois\n\n1. passo\n2. passo");
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
  });

  it("preserva o bloco de código sem interpretar markdown dentro", () => {
    const block = firstBlock("```\n# não é título\n- não é lista\n```", "code");
    expect(block.text).toBe("# não é título\n- não é lista");
  });

  it("agrupa seções por h1/h2 e mantém h3 dentro da seção pai", () => {
    const guide = parseGuide(
      ["# Guia", "> intro", "# Parte I", "## 1. Uma coisa", "### 1.1 Detalhe", "texto"].join("\n"),
    );
    expect(guide.title).toBe("Guia");
    expect(guide.intro).toHaveLength(1);
    expect(guide.sections.map((section) => section.title)).toEqual(["Parte I", "1. Uma coisa"]);
    expect(guide.sections[1]?.blocks.some((block) => block.kind === "heading")).toBe(true);
  });

  it("busca ignora acento e caixa", () => {
    expect(normalizeForSearch("Configurações")).toBe("configuracoes");
  });
});

describe("guias publicados", () => {
  it("o guia do CRM está no bundle e foi fatiado em seções", () => {
    const guides = listGuides();
    expect(guides.length).toBeGreaterThan(0);

    const crm = guides.find((guide) => guide.slug === "crm-completo");
    expect(crm, "o guia crm-completo precisa estar no catálogo").toBeTruthy();
    if (!crm) return;

    // Guarda contra o modo de falha silencioso: o gerador rodar com o .md vazio,
    // ou o parser engolir tudo e a tela publicar uma casca.
    expect(crm.sections.length).toBeGreaterThan(20);
    expect(crm.sections.every((section) => section.id.length > 0)).toBe(true);
    expect(crm.sections.some((section) => section.searchText.includes("inbox"))).toBe(true);
    expect(
      crm.sections.some((section) => section.blocks.some((block) => block.kind === "table")),
    ).toBe(true);
  });

  it("não gera duas seções com a mesma âncora (a navegação levaria ao lugar errado)", () => {
    for (const guide of listGuides()) {
      const ids = guide.sections.map((section) => section.id);
      expect(new Set(ids).size, `âncoras duplicadas em ${guide.slug}`).toBe(ids.length);
    }
  });
});
