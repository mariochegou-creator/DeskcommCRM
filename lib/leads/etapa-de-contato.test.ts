import { describe, expect, it } from "vitest";

import { etapaMarcaContatoFeito } from "./etapa-de-contato";

describe("etapaMarcaContatoFeito", () => {
  it("reconhece a coluna «Contatado» do funil de prospecção da NEXO", () => {
    expect(etapaMarcaContatoFeito({ slug: "contatado", name: "Contatado" })).toBe(true);
  });

  it("NÃO dispara na coluna vizinha, «A contatar»", () => {
    // O par que motiva o arquivo: as duas colunas vivem lado a lado no mesmo
    // funil e a diferença inteira é o particípio.
    expect(etapaMarcaContatoFeito({ slug: "a-contatar", name: "A contatar" })).toBe(false);
    expect(etapaMarcaContatoFeito({ name: "A contactar" })).toBe(false);
  });

  it("aceita as flexões e a grafia com C", () => {
    expect(etapaMarcaContatoFeito({ name: "Contactado" })).toBe(true);
    expect(etapaMarcaContatoFeito({ name: "Empresa contatada" })).toBe(true);
    expect(etapaMarcaContatoFeito({ name: "Leads contatados" })).toBe(true);
  });

  it("NÃO dispara quando a etapa nega o contato", () => {
    expect(etapaMarcaContatoFeito({ slug: "nao-contatado", name: "Não contatado" })).toBe(false);
    expect(etapaMarcaContatoFeito({ name: "Sem contato" })).toBe(false);
  });

  it("NÃO dispara em «Primeiro contato» — é a coluna de entrada, não o contato feito", () => {
    expect(etapaMarcaContatoFeito({ slug: "primeiro_contato", name: "Primeiro contato" })).toBe(
      false,
    );
  });

  it("NÃO dispara nas outras etapas do funil", () => {
    expect(etapaMarcaContatoFeito({ slug: "respondeu", name: "Respondeu" })).toBe(false);
    expect(etapaMarcaContatoFeito({ slug: "r1-agendada", name: "R1 agendada" })).toBe(false);
    expect(etapaMarcaContatoFeito({ slug: "ganho", name: "Ganho" })).toBe(false);
  });

  it("sobrevive a etapa sem nome nem slug", () => {
    expect(etapaMarcaContatoFeito({})).toBe(false);
    expect(etapaMarcaContatoFeito({ name: null, slug: null })).toBe(false);
  });
});
