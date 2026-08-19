import { describe, expect, it } from "vitest";

import { buildMorningBrief, type MorningBriefInput } from "./morning-brief";

/** 8h30 na Bahia = 11:30 UTC. 10/08/2026 é segunda; 11/08 é terça. */
const TUESDAY_0830 = new Date("2026-08-11T11:30:00.000Z");
/** Quinta 20/08 — véspera do checkpoint de 21/08. */
const THURSDAY_0830 = new Date("2026-08-20T11:30:00.000Z");

function base(overrides: Partial<MorningBriefInput> = {}): MorningBriefInput {
  return {
    now: TUESDAY_0830,
    recipientName: "Mario",
    yesterdayLabel: "seg 10/08",
    yesterday: { openings: 40, contacted: 40, replied: 6, xray: 2 },
    weekOpenings: 40,
    weekBusinessDaysDone: 1,
    planXray: 2,
    tasks: [],
    meetings: [],
    ...overrides,
  };
}

describe("buildMorningBrief", () => {
  it("dia no ritmo: saudação com nome, uma linha de números, sem alerta nem rotina", () => {
    const text = buildMorningBrief(base());
    expect(text).toContain("*Bom dia, Mario! · ter 11/08 · dia 2 de 60*");
    expect(text).toContain("Ontem (seg 10/08): 40 de 40 aberturas · 6 respostas · 2 raios-x");
    expect(text).not.toContain("*Rotina*");
    expect(text).not.toContain("Faltam");
    expect(text).not.toContain("abaixo da meta");
  });

  it("reuniões de hoje vêm primeiro; sem nenhuma, diz isso em uma linha", () => {
    const com = buildMorningBrief(
      base({
        meetings: [
          { hora: "10h", tipo: "R1", negocio: "GNG Solar" },
          { hora: "14h30", tipo: "raio-x", negocio: null },
        ],
      }),
    );
    expect(com).toContain("*Reuniões de hoje*");
    expect(com).toContain("- 10h — R1 com GNG Solar");
    expect(com).toContain("- 14h30 — raio-x com (card sem nome)");

    const sem = buildMorningBrief(base());
    expect(sem).toContain("Sem reunião marcada pra hoje.");
    expect(sem).not.toContain("*Reuniões de hoje*");
  });

  it("abaixo do ritmo: UMA linha de alerta, e a da semana ganha da do dia", () => {
    const text = buildMorningBrief(
      base({
        yesterday: { openings: 22, contacted: 22, replied: 3, xray: 1 },
        weekOpenings: 22,
      }),
    );
    expect(text).toContain("Faltam 18 aberturas pra fechar a meta da semana.");
    expect(text).not.toContain("abaixo da meta");
  });

  it("só o dia abaixo: alerta do dia", () => {
    const text = buildMorningBrief(
      base({
        yesterday: { openings: 30, contacted: 30, replied: 3, xray: 1 },
        weekOpenings: 40,
      }),
    );
    expect(text).toContain("Ontem ficaram 10 aberturas abaixo da meta.");
  });

  it("ninguém contatado vira texto, não 0 de 0", () => {
    const text = buildMorningBrief(
      base({ yesterday: { openings: 0, contacted: 0, replied: 0, xray: 0 } }),
    );
    expect(text).toContain("· ninguém contatado ·");
  });

  it("sem funil detectado: degrada sem quebrar — sem linha de números", () => {
    const text = buildMorningBrief(
      base({ yesterday: null, weekOpenings: null, planXray: null }),
    );
    expect(text).not.toContain("Ontem");
    expect(text).toContain("Sem reunião marcada pra hoje.");
  });

  it("tarefas: só as do destinatário e as da dupla; Claude nunca aparece", () => {
    const tasks: MorningBriefInput["tasks"] = [
      { title: "Conferir 22 bios", owner: "mario", due_date: "2026-08-10" },
      { title: "Separar lista da semana", owner: "david", due_date: "2026-08-11" },
      { title: "Revisar ganchos juntos", owner: "dupla", due_date: null },
      { title: "Gerar lote de 40 leads", owner: "claude", due_date: null },
    ];
    const doMario = buildMorningBrief(base({ tasks }));
    expect(doMario).toContain("*Suas tarefas*");
    expect(doMario).toContain("- Conferir 22 bios (atrasada — era 10/08)");
    expect(doMario).toContain("- Revisar ganchos juntos");
    expect(doMario).not.toContain("Separar lista da semana");
    expect(doMario).not.toContain("Claude");
    expect(doMario).not.toContain("Gerar lote");

    const doDavid = buildMorningBrief(base({ recipientName: "David", tasks }));
    expect(doDavid).toContain("*Bom dia, David!");
    expect(doDavid).toContain("- Separar lista da semana");
    expect(doDavid).not.toContain("Conferir 22 bios");
  });

  it("destinatário desconhecido vê tudo que é de humano", () => {
    const text = buildMorningBrief(
      base({
        recipientName: "Fulana",
        tasks: [
          { title: "Conferir 22 bios", owner: "mario", due_date: null },
          { title: "Gerar lote de 40 leads", owner: "claude", due_date: null },
        ],
      }),
    );
    expect(text).toContain("- Conferir 22 bios");
    expect(text).not.toContain("Gerar lote");
  });

  it("sem tarefa pontual: uma linha, sem seção", () => {
    const text = buildMorningBrief(base({ tasks: [] }));
    expect(text).toContain("Sem tarefa pontual hoje — foco na rotina.");
    expect(text).not.toContain("*Suas tarefas*");
  });

  it("checkpoint só entra quando está a 2 dias ou menos", () => {
    // 11/08 → checkpoint 21/08 está a 10 dias: fora.
    expect(buildMorningBrief(base())).not.toContain("Checkpoint");
    // 20/08 → está a 1 dia: entra, com o acumulado.
    const perto = buildMorningBrief(
      base({ now: THURSDAY_0830, yesterdayLabel: "qua 19/08", weekBusinessDaysDone: 3, weekOpenings: 120 }),
    );
    expect(perto).toContain("Checkpoint 21/08 (em 1 dia):");
    expect(perto).toContain("Acumulado: 2 de 15.");
  });
});
