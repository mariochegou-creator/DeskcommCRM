import { describe, expect, it } from "vitest";

import { extractGanchos, listarGanchos } from "@/lib/leads/ganchos";

/**
 * O seletor de primeiro toque precisa de mais do que os textos: precisa saber
 * DE QUAL campo cada gancho saiu. Antes, `extractGanchos` devolvia só strings —
 * suficiente para exibir, insuficiente para escolher.
 */
describe("listarGanchos", () => {
  const campos = {
    gancho_abertura: "Oi! Vi que vocês atendem em Catu.",
    gancho_2: "  Passando de novo pra saber se faz sentido.  ",
    cidade: "Catu",
    hook_extra: "",
  };

  it("traz chave e texto, e a chave é o que identifica o item", () => {
    const lista = listarGanchos(campos);
    expect(lista.map((g) => g.chave)).toEqual(["gancho_abertura", "gancho_2"]);
    // Espaço em volta é ruído de planilha: sai antes de virar mensagem.
    expect(lista[1].texto).toBe("Passando de novo pra saber se faz sentido.");
  });

  it("o rótulo é o que o SDR lê, nunca o nome de máquina", () => {
    const lista = listarGanchos(campos);
    expect(lista[0].rotulo).toBe("Gancho 1 — abertura");
    expect(lista[1].rotulo).toBe("Gancho 2 — segundo toque");
  });

  it("chave desconhecida ganha rótulo legível em vez de nome inventado", () => {
    // Gancho vindo de webhook ou de planilha de terceiro não tem rótulo fixo.
    // Embelezar é honesto; batizar de "Gancho 3" mentiria sobre a origem.
    const [g] = listarGanchos({ gancho_teste_ab: "Texto." });
    expect(g.rotulo).toBe("Gancho teste ab");
  });

  it("os dois leitores enxergam a mesma coisa", () => {
    // `extractGanchos` é a superfície de LEITURA (nota semeada, painel do
    // inbox). Se as duas divergirem, o SDR manda um gancho e a nota registra
    // outro — e ninguém repara até a conversa não fazer sentido.
    expect(extractGanchos(campos)).toEqual(listarGanchos(campos).map((g) => g.texto));
  });

  it("custom_fields vazio, nulo ou array não quebra a gaveta", () => {
    expect(listarGanchos(null)).toEqual([]);
    expect(listarGanchos([])).toEqual([]);
    expect(listarGanchos({ cidade: "Catu" })).toEqual([]);
  });
});
