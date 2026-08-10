import { describe, expect, it } from "vitest";

import {
  dataCivilBahia,
  formatarReuniao,
  instanteDaReuniao,
  instanteLembreteFinal,
  instanteLembreteVespera,
  janelaDeVarredura,
  lembretesDevidos,
  lerReuniao,
  type Reuniao,
} from "./reuniao";

/** Reunião de referência: quarta 12/08/2026, 14h Bahia = 17h UTC. */
const EM = "2026-08-12T17:00:00.000Z";

function reuniao(over: Partial<Reuniao> = {}): Reuniao {
  return {
    tipo: "r1",
    em: EM,
    data: "2026-08-12",
    hora: "14:00",
    criada_em: "2026-08-10T12:00:00.000Z",
    avisos: {},
    ...over,
  };
}

describe("instanteDaReuniao", () => {
  it("lê data e hora como fuso da Bahia (−03:00)", () => {
    expect(instanteDaReuniao("2026-08-12", "14:00").toISOString()).toBe(EM);
  });

  it("cruza a meia-noite UTC sem trocar o dia civil", () => {
    // 22h da Bahia é 01h UTC do dia seguinte — o erro clássico de fuso.
    expect(instanteDaReuniao("2026-08-12", "22:00").toISOString()).toBe(
      "2026-08-13T01:00:00.000Z",
    );
  });
});

describe("instantes dos lembretes", () => {
  it("véspera é 18h civil do dia ANTERIOR, não 24h antes", () => {
    // 24h antes cairia às 14h da terça; a régua é o fim do expediente.
    expect(instanteLembreteVespera(new Date(EM)).toISOString()).toBe(
      "2026-08-11T21:00:00.000Z",
    );
  });

  it("véspera de reunião logo cedo continua às 18h do dia anterior", () => {
    const cedo = instanteDaReuniao("2026-08-12", "08:00");
    expect(instanteLembreteVespera(cedo).toISOString()).toBe("2026-08-11T21:00:00.000Z");
  });

  it("final é uma hora antes", () => {
    expect(instanteLembreteFinal(new Date(EM)).toISOString()).toBe("2026-08-12T16:00:00.000Z");
  });
});

describe("formatarReuniao", () => {
  it("fala como gente: dia da semana, dd/mm e hora sem minuto redondo", () => {
    expect(formatarReuniao(new Date(EM))).toEqual({
      diaDaSemana: "quarta-feira",
      diaMes: "12/08",
      hora: "14h",
    });
  });

  it("mantém os minutos quando existem", () => {
    expect(formatarReuniao(instanteDaReuniao("2026-08-12", "14:30")).hora).toBe("14h30");
  });
});

describe("lembretesDevidos", () => {
  it("manda a véspera na hora dela", () => {
    expect(lembretesDevidos(reuniao(), new Date("2026-08-11T21:00:00.000Z"))).toEqual([
      "vespera",
    ]);
  });

  it("não manda nada antes da hora", () => {
    expect(lembretesDevidos(reuniao(), new Date("2026-08-11T20:00:00.000Z"))).toEqual([]);
  });

  it("manda o final na hora dele", () => {
    expect(lembretesDevidos(reuniao(), new Date("2026-08-12T16:05:00.000Z"))).toEqual(["final"]);
  });

  it("não repete o que já foi carimbado", () => {
    const r = reuniao({ avisos: { vespera: "2026-08-11T21:00:00.000Z" } });
    expect(lembretesDevidos(r, new Date("2026-08-11T21:05:00.000Z"))).toEqual([]);
  });

  it("cala a boca depois que a reunião começou", () => {
    // Cron que voltou do ar às 14h05 não anuncia uma call que já está rolando.
    expect(lembretesDevidos(reuniao(), new Date("2026-08-12T17:05:00.000Z"))).toEqual([]);
  });

  it("não dispara véspera que já nasceu vencida", () => {
    // Marcou às 20h de terça uma reunião de quarta 14h: a véspera (18h de
    // terça) está no passado e mandá-la repetiria a confirmação recém-enviada.
    const r = reuniao({ criada_em: "2026-08-11T23:00:00.000Z" });
    expect(lembretesDevidos(r, new Date("2026-08-11T23:01:00.000Z"))).toEqual([]);
  });

  it("desiste do lembrete atrasado demais", () => {
    // 4h depois da véspera, com tolerância de 3h: chegaria junto do toque final.
    expect(lembretesDevidos(reuniao(), new Date("2026-08-12T01:00:00.000Z"))).toEqual([]);
  });

  it("ignora reunião com instante ilegível", () => {
    expect(lembretesDevidos(reuniao({ em: "ontem" }), new Date(EM))).toEqual([]);
  });
});

describe("lerReuniao", () => {
  it("devolve null para custom_fields sem reunião", () => {
    expect(lerReuniao(null)).toBeNull();
    expect(lerReuniao({})).toBeNull();
    expect(lerReuniao({ reuniao: "amanhã" })).toBeNull();
    expect(lerReuniao([{ reuniao: {} }])).toBeNull();
  });

  it("recusa reunião sem instante válido", () => {
    expect(lerReuniao({ reuniao: { em: "qualquer coisa" } })).toBeNull();
  });

  it("preenche o que falta sem inventar instante", () => {
    const lida = lerReuniao({ reuniao: { em: EM } });
    expect(lida).toMatchObject({ tipo: "r1", em: EM, criada_em: EM, avisos: {} });
  });

  it("mantém os carimbos de aviso", () => {
    const lida = lerReuniao({ reuniao: { em: EM, avisos: { vespera: "x", final: 3 } } });
    // `final: 3` não é carimbo — carimbo é ISO. Entra só o que é string.
    expect(lida?.avisos).toEqual({ vespera: "x" });
  });
});

describe("janelaDeVarredura", () => {
  it("olha uma hora atrás e dois dias à frente", () => {
    const { de, ate } = janelaDeVarredura(new Date("2026-08-12T12:00:00.000Z"));
    expect(de).toBe("2026-08-12T11:00:00.000Z");
    expect(ate).toBe("2026-08-14T12:00:00.000Z");
  });
});

describe("dataCivilBahia", () => {
  it("usa o dia civil da Bahia, não o do UTC", () => {
    // 01h UTC de 13/08 ainda é 22h de 12/08 na Bahia.
    expect(dataCivilBahia(new Date("2026-08-13T01:00:00.000Z"))).toBe("2026-08-12");
  });

  it("soma dias no calendário civil", () => {
    expect(dataCivilBahia(new Date("2026-08-13T01:00:00.000Z"), 1)).toBe("2026-08-13");
  });
});
