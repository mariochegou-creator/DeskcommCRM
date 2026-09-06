import { describe, expect, it } from "vitest";

import { interpolateTemplate, saudacaoDaHora } from "@/lib/inbox/template-vars";

describe("interpolateTemplate", () => {
  it("substitui nome e primeiro_nome", () => {
    expect(interpolateTemplate("Oi {{primeiro_nome}}, tudo bem?", { name: "Rafael Melgaço" })).toBe(
      "Oi Rafael, tudo bem?",
    );
    expect(interpolateTemplate("Falo com {{nome}}?", { name: "Rafael Melgaço" })).toBe(
      "Falo com Rafael Melgaço?",
    );
  });
  it("tolera espaços e case nas chaves", () => {
    expect(interpolateTemplate("Oi {{ Primeiro_Nome }}!", { name: "Ana Paula" })).toBe("Oi Ana!");
  });
  it("sem nome → mantém o literal (não quebra)", () => {
    expect(interpolateTemplate("Oi {{primeiro_nome}}", { name: null })).toBe("Oi {{primeiro_nome}}");
  });
  it("variável desconhecida → mantém o literal", () => {
    expect(interpolateTemplate("Cupom {{codigo}}", { name: "X" })).toBe("Cupom {{codigo}}");
  });
});

/**
 * A saudação é o caso que mordeu de verdade: um template cadastrado com "bom
 * dia" escrito no texto mandou "bom dia" às onze da noite. Quem cadastrou não
 * vê o erro — quem vê é o cliente, e o efeito é o de mensagem disparada por
 * robô, que é o oposto do que o atalho serve para fazer.
 */
describe("saudacaoDaHora", () => {
  const as = (hora: number) => new Date(2026, 8, 5, hora, 30);

  it("segue o português falado, não o relógio", () => {
    expect(saudacaoDaHora(as(5))).toBe("bom dia");
    expect(saudacaoDaHora(as(11))).toBe("bom dia");
    expect(saudacaoDaHora(as(12))).toBe("boa tarde");
    expect(saudacaoDaHora(as(17))).toBe("boa tarde");
    expect(saudacaoDaHora(as(18))).toBe("boa noite");
    expect(saudacaoDaHora(as(23))).toBe("boa noite");
  });

  it("madrugada é boa noite — ninguém diz bom dia às 3h", () => {
    expect(saudacaoDaHora(as(0))).toBe("boa noite");
    expect(saudacaoDaHora(as(4))).toBe("boa noite");
  });

  it("no template, a saudação acompanha a hora do envio", () => {
    const corpo = "{{saudacao_maiuscula}}, {{primeiro_nome}}.";
    expect(interpolateTemplate(corpo, { name: "Ana" }, as(9))).toBe("Bom dia, Ana.");
    expect(interpolateTemplate(corpo, { name: "Ana" }, as(21))).toBe("Boa noite, Ana.");
  });

  it("resolve mesmo sem contato — saudação não depende de dado do lead", () => {
    expect(interpolateTemplate("{{saudacao}}", { name: null }, as(14))).toBe("boa tarde");
  });
});
