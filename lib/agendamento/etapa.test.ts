import { describe, expect, it } from "vitest";

import { etapaPedeAgendamento, tipoDeReuniaoDaEtapa } from "./etapa";

describe("tipoDeReuniaoDaEtapa", () => {
  it("reconhece o funil atual da NEXO pelo slug", () => {
    expect(tipoDeReuniaoDaEtapa({ slug: "r1-agendada", name: "R1 agendada" })).toBe("r1");
    expect(tipoDeReuniaoDaEtapa({ slug: "r2-agendada", name: "R2 agendada" })).toBe("r2");
  });

  it("reconhece o funil de 8 etapas pelo nome, com acento e hífen", () => {
    expect(tipoDeReuniaoDaEtapa({ slug: "raio-x-marcado", name: "Raio-x marcado" })).toBe(
      "raio-x",
    );
    expect(tipoDeReuniaoDaEtapa({ name: "Raio X marcado" })).toBe("raio-x");
  });

  it("NÃO dispara em etapa de reunião já acontecida", () => {
    // É o par que motiva a regra dupla: "R1 feita" tem o R1 e não tem o marcada.
    expect(tipoDeReuniaoDaEtapa({ slug: "r1-feita", name: "R1 feita" })).toBeNull();
    expect(tipoDeReuniaoDaEtapa({ slug: "r2-feita", name: "R2 feita" })).toBeNull();
  });

  it("NÃO dispara em etapa de outra natureza", () => {
    expect(tipoDeReuniaoDaEtapa({ slug: "entrada", name: "Entrada" })).toBeNull();
    expect(tipoDeReuniaoDaEtapa({ slug: "em-cadencia", name: "Em cadência" })).toBeNull();
    expect(tipoDeReuniaoDaEtapa({ slug: "fechado-ganho", name: "Fechado (ganho)" })).toBeNull();
  });

  it("aceita 'reunião marcada' sem numeral e trata como a primeira", () => {
    expect(tipoDeReuniaoDaEtapa({ name: "Reunião marcada" })).toBe("r1");
    expect(tipoDeReuniaoDaEtapa({ name: "Diagnóstico agendado" })).toBe("r1");
  });

  it("exige as duas metades: só 'agendada' não basta", () => {
    expect(tipoDeReuniaoDaEtapa({ name: "Agendada" })).toBeNull();
  });

  it("sobrevive a etapa sem nome nem slug", () => {
    expect(tipoDeReuniaoDaEtapa({})).toBeNull();
    expect(tipoDeReuniaoDaEtapa({ name: null, slug: null })).toBeNull();
  });
});

describe("etapaPedeAgendamento", () => {
  it("é o booleano do mesmo julgamento", () => {
    expect(etapaPedeAgendamento({ slug: "r1-agendada" })).toBe(true);
    expect(etapaPedeAgendamento({ slug: "r1-feita" })).toBe(false);
  });
});
