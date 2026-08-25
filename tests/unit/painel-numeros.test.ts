import { describe, expect, it } from "vitest";

import {
  SEM_CONVERSA,
  TODOS_OS_NUMEROS,
  filtrarPorNumero,
} from "@/lib/dashboard/numeros";

/**
 * O seletor de número do Painel.
 *
 * O mapa `byLead` é o que a rota /metrics/lead-channels devolve: negócio →
 * conexões que falaram com ele. Negócio ausente do mapa nunca teve conversa.
 */

const LEADS = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
];

const DAVID = "sessao-david";
const MARIO = "sessao-mario";

const MAPA: Record<string, string[]> = {
  a: [DAVID],
  b: [MARIO],
  // Lead tocado pelas DUAS linhas: entrou pelo SDR, foi puxado pelo closer.
  c: [DAVID, MARIO],
  // "d" fora do mapa de propósito: ainda sem conversa.
};

describe("filtrarPorNumero", () => {
  it("sem filtro devolve a mesma lista, sem copiar", () => {
    expect(filtrarPorNumero(LEADS, MAPA, TODOS_OS_NUMEROS)).toBe(LEADS);
  });

  it("por número traz só quem passou por aquela linha", () => {
    expect(filtrarPorNumero(LEADS, MAPA, DAVID).map((l) => l.id)).toEqual(["a", "c"]);
    expect(filtrarPorNumero(LEADS, MAPA, MARIO).map((l) => l.id)).toEqual(["b", "c"]);
  });

  it("lead tocado por duas linhas aparece nas duas", () => {
    const noDavid = filtrarPorNumero(LEADS, MAPA, DAVID).some((l) => l.id === "c");
    const noMario = filtrarPorNumero(LEADS, MAPA, MARIO).some((l) => l.id === "c");
    expect(noDavid && noMario).toBe(true);
  });

  it("'sem conversa' é quem não está no mapa", () => {
    expect(filtrarPorNumero(LEADS, MAPA, SEM_CONVERSA).map((l) => l.id)).toEqual(["d"]);
  });

  it("mapa vazio joga tudo em 'sem conversa' e nada em número nenhum", () => {
    expect(filtrarPorNumero(LEADS, {}, SEM_CONVERSA)).toHaveLength(4);
    expect(filtrarPorNumero(LEADS, {}, DAVID)).toHaveLength(0);
  });

  it("lista com entrada vazia no mapa conta como sem conversa", () => {
    const mapa = { a: [] as string[] };
    expect(filtrarPorNumero(LEADS, mapa, SEM_CONVERSA).map((l) => l.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});
