import { describe, expect, it } from "vitest";

import { buildMorningBrief, type MorningBriefInput } from "./morning-brief";

/** 8h30 na Bahia = 11:30 UTC. 10/08/2026 é segunda; 11/08 é terça. */
const TUESDAY_0830 = new Date("2026-08-11T11:30:00.000Z");
const MONDAY_0830 = new Date("2026-08-10T11:30:00.000Z");

function base(overrides: Partial<MorningBriefInput> = {}): MorningBriefInput {
  return {
    now: TUESDAY_0830,
    yesterdayLabel: "seg 10/08",
    yesterday: { openings: 40, contacted: 40, replied: 6, xray: 2 },
    weekOpenings: 40,
    weekBusinessDaysDone: 1,
    planXray: 2,
    tasks: [],
    ...overrides,
  };
}

describe("buildMorningBrief", () => {
  it("dia no ritmo: cabeçalho, ontem, semana, rotina e checkpoint — sem ATENÇÃO", () => {
    const text = buildMorningBrief(base());
    expect(text).toContain("*Bom dia! NEXO — plano 60 dias*");
    expect(text).toContain("ter 11/08 · dia 2 de 60 · Fase 1 — Teste de nicho");
    expect(text).toContain("*Ontem (seg 10/08)*");
    expect(text).toContain("Aberturas: 40 de 40");
    expect(text).toContain("Respostas: 6 de 40 contatados");
    expect(text).toContain("*Semana*: 40 de 40 aberturas até ontem");
    expect(text).toContain("*Rotina*");
    expect(text).toContain("Checkpoint 21/08 (em 10 dias):");
    expect(text).toContain("Acumulado: 2 de 15.");
    expect(text).not.toContain("ATENÇÃO");
  });

  it("abaixo do ritmo: UMA linha de ATENÇÃO, e a da semana ganha da do dia", () => {
    const text = buildMorningBrief(
      base({
        yesterday: { openings: 22, contacted: 22, replied: 3, xray: 1 },
        weekOpenings: 22,
      }),
    );
    const atencoes = text.split("\n").filter((l) => l.startsWith("ATENÇÃO"));
    expect(atencoes).toHaveLength(1);
    expect(atencoes[0]).toContain("faltam 18 aberturas");
  });

  it("segunda-feira: 0 dias úteis fechados ⇒ semana 'começando', sem falso alarme", () => {
    const text = buildMorningBrief(
      base({
        now: MONDAY_0830,
        yesterdayLabel: "sex 07/08",
        weekOpenings: 0,
        weekBusinessDaysDone: 0,
      }),
    );
    expect(text).toContain("*Semana*: começando — meta 200 aberturas");
    expect(text.split("\n").filter((l) => l.startsWith("ATENÇÃO: ritmo da semana"))).toHaveLength(0);
  });

  it("sem funil detectado: degrada sem quebrar — só tarefas, rotina e checkpoint", () => {
    const text = buildMorningBrief(
      base({ yesterday: null, weekOpenings: null, planXray: null }),
    );
    expect(text).not.toContain("*Ontem");
    expect(text).not.toContain("*Semana*");
    expect(text).not.toContain("Acumulado:");
    expect(text).toContain("*Rotina*");
    expect(text).toContain("Checkpoint 21/08");
  });

  it("tarefas agrupadas por dono; atrasada anotada; claude vira linha única", () => {
    const text = buildMorningBrief(
      base({
        tasks: [
          { title: "Conferir 22 bios", owner: "mario", due_date: "2026-08-10" },
          { title: "Separar lista da semana", owner: "david", due_date: "2026-08-11" },
          { title: "Gerar lote de 40 leads", owner: "claude", due_date: null },
        ],
      }),
    );
    expect(text).toContain("*Hoje — Mario*");
    expect(text).toContain("- Conferir 22 bios (atrasada — era 10/08)");
    expect(text).toContain("*Hoje — David*");
    expect(text).toContain("- Separar lista da semana");
    expect(text).not.toContain("Separar lista da semana (atrasada");
    expect(text).toContain("Com o Claude: 1 tarefa em andamento.");
  });

  it("sem tarefa pontual: linha de foco na rotina", () => {
    const text = buildMorningBrief(base({ tasks: [] }));
    expect(text).toContain("*Hoje*: sem tarefa pontual — foco total na rotina.");
  });
});
