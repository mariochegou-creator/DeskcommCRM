import { describe, expect, it } from "vitest";

import {
  aplicarTagDaIa,
  formatNotaResumo,
  montarPromptDigest,
  montarTranscript,
  parseDigest,
} from "@/lib/conversations/digest-diario";

/** 22/08/2026, 07:00 na Bahia = 10:00Z — a hora em que o cron roda. */
const MANHA = new Date("2026-08-22T10:00:00.000Z");

const CATALOGO = ["Interessado", "Sem retorno", "Não perturbar"];

describe("montarTranscript", () => {
  it("rotula inbound como Cliente e outbound como Atendente, na ordem", () => {
    const t = montarTranscript([
      { direction: "outbound", body: "Oi, tudo bem?", sent_at: null },
      { direction: "inbound", body: "Quanto custa o site?", sent_at: null },
    ]);
    expect(t).toBe("Atendente: Oi, tudo bem?\nCliente: Quanto custa o site?");
  });

  it("pula mensagem sem corpo (mídia) — não vira linha vazia no prompt", () => {
    const t = montarTranscript([
      { direction: "inbound", body: null, sent_at: null },
      { direction: "inbound", body: "   ", sent_at: null },
      { direction: "inbound", body: "ok", sent_at: null },
    ]);
    expect(t).toBe("Cliente: ok");
  });

  it("conversa só com mídia vira transcript vazio — o cron pula sem gastar LLM", () => {
    expect(montarTranscript([{ direction: "inbound", body: null, sent_at: null }])).toBe("");
  });
});

describe("parseDigest", () => {
  it("extrai a tag pelo nome do catálogo, ignorando caixa e espaços", () => {
    const d = parseDigest("TAG: interessado\nRESUMO:\n- Pediu preço do site.", CATALOGO);
    expect(d.tag).toBe("Interessado");
    expect(d.resumo).toBe("- Pediu preço do site.");
  });

  it("«nenhuma» e tag fora do catálogo viram null — a IA nunca inventa tag", () => {
    expect(parseDigest("TAG: nenhuma\nRESUMO:\n- ok", CATALOGO).tag).toBeNull();
    expect(parseDigest("TAG: VIP\nRESUMO:\n- ok", CATALOGO).tag).toBeNull();
  });

  it("resposta fora do formato vira resumo inteiro com tag null, nunca perde o texto", () => {
    const d = parseDigest("O cliente pediu orçamento e ficou de responder.", CATALOGO);
    expect(d.tag).toBeNull();
    expect(d.resumo).toBe("O cliente pediu orçamento e ficou de responder.");
  });

  it("RESUMO na mesma linha do rótulo também conta", () => {
    const d = parseDigest("TAG: Sem retorno\nRESUMO: só nós falamos.", CATALOGO);
    expect(d.tag).toBe("Sem retorno");
    expect(d.resumo).toBe("só nós falamos.");
  });
});

describe("aplicarTagDaIa", () => {
  it("troca a tag gerida anterior pela nova, preservando as tags humanas", () => {
    expect(aplicarTagDaIa(["kaptar", "Sem retorno"], "Interessado")).toEqual([
      "kaptar",
      "Interessado",
    ]);
  });

  it("tag já aplicada (mesmo com caixa diferente) → null, nada a gravar", () => {
    expect(aplicarTagDaIa(["INTERESSADO"], "Interessado")).toBeNull();
  });

  it("«Cliente» e «Parceiro» nunca são removidas pela IA", () => {
    expect(aplicarTagDaIa(["Cliente", "Sem retorno"], "Interessado")).toEqual([
      "Cliente",
      "Interessado",
    ]);
  });

  it("sem escolha e sem tag gerida no contato → null", () => {
    expect(aplicarTagDaIa(["Cliente"], null)).toBeNull();
  });
});

describe("formatNotaResumo", () => {
  it("carimba o dia civil da Bahia e a tag aplicada", () => {
    const nota = formatNotaResumo("- Pediu preço.", "Interessado", MANHA);
    expect(nota).toContain("Resumo do dia 22/08/2026:");
    expect(nota).toContain("- Pediu preço.");
    expect(nota).toContain("Tag aplicada: Interessado");
  });

  it("sem tag, a linha da tag não aparece", () => {
    expect(formatNotaResumo("- ok", null, MANHA)).not.toContain("Tag aplicada");
  });

  it("nunca passa do teto de 4096 do createNoteSchema", () => {
    expect(formatNotaResumo("x".repeat(9000), "Interessado", MANHA).length).toBeLessThanOrEqual(
      4096,
    );
  });
});

describe("montarPromptDigest", () => {
  it("lista as tags do catálogo + nenhuma como vocabulário fechado", () => {
    const p = montarPromptDigest({ transcript: "Cliente: oi", tagsPermitidas: CATALOGO });
    expect(p).toContain("Interessado | Sem retorno | Não perturbar | nenhuma");
    expect(p).toContain("Cliente: oi");
  });
});
