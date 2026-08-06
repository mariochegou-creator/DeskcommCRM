import { describe, it, expect } from "vitest";

import { extractExtras, extractGanchos, extractGoogleMapsUrl } from "./ganchos";

describe("extractExtras — o dossiê fora dos ganchos", () => {
  it("devolve tudo que não é gancho nem Maps, na ordem de inserção", () => {
    const cf = {
      "Gancho de abertura": "Oi! Vi que...",
      "Google Maps": "https://maps.google.com/x",
      Dores: "1) dor: consequência (visto: evidência)",
      Score: "65",
      Cidade: "Barreiras",
    };
    expect(extractExtras(cf)).toEqual([
      ["Dores", "1) dor: consequência (visto: evidência)"],
      ["Score", "65"],
      ["Cidade", "Barreiras"],
    ]);
  });

  it("number e boolean do Kaptar viram string; objeto e array são ruído", () => {
    const cf = {
      score_kaptar: 94,
      tem_site: false,
      payload: { a: 1 },
      lista: [1, 2],
    };
    expect(extractExtras(cf)).toEqual([
      ["score_kaptar", "94"],
      ["tem_site", "false"],
    ]);
  });

  it("vazio, null e não-objeto devolvem lista vazia", () => {
    expect(extractExtras({})).toEqual([]);
    expect(extractExtras(null)).toEqual([]);
    expect(extractExtras("x")).toEqual([]);
    expect(extractExtras([{ a: "b" }])).toEqual([]);
    expect(extractExtras({ vazio: "  " })).toEqual([]);
  });

  it("não rouba o que os outros extratores leem", () => {
    const cf = {
      gancho_2: "segundo toque",
      place_url: "https://maps.google.com/y",
      Site: "https://exemplo.com.br",
    };
    expect(extractGanchos(cf)).toEqual(["segundo toque"]);
    expect(extractGoogleMapsUrl(cf)).toBe("https://maps.google.com/y");
    expect(extractExtras(cf)).toEqual([["Site", "https://exemplo.com.br"]]);
  });
});
