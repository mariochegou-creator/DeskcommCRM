import { describe, expect, it } from "vitest";

import {
  bahiaCivilDate,
  bahiaStartOfDay,
  bahiaStartOfWeek,
  businessDaysMonToYesterday,
  currentPhase,
  daysUntil,
  isBusinessDayBahia,
  nextCheckpoint,
  planDayNumber,
  previousBusinessDayWindow,
} from "./dates";

describe("datas civis da Bahia (offset fixo −03:00)", () => {
  it("madrugada UTC ainda é o dia ANTERIOR na Bahia", () => {
    // 02:00 UTC de 12/08 = 23:00 de 11/08 na Bahia.
    const c = bahiaCivilDate(new Date("2026-08-12T02:00:00.000Z"));
    expect(c.iso).toBe("2026-08-11");
  });

  it("meia-noite civil vira 03:00 UTC", () => {
    const start = bahiaStartOfDay(new Date("2026-08-11T11:30:00.000Z"));
    expect(start.toISOString()).toBe("2026-08-11T03:00:00.000Z");
  });

  it("semana começa na segunda 00:00 civil", () => {
    // Quarta 12/08 → segunda 10/08.
    const monday = bahiaStartOfWeek(new Date("2026-08-12T15:00:00.000Z"));
    expect(monday.toISOString()).toBe("2026-08-10T03:00:00.000Z");
  });

  it("segunda de manhã: o 'ontem útil' é SEXTA, não domingo", () => {
    const w = previousBusinessDayWindow(new Date("2026-08-10T11:30:00.000Z"));
    expect(w.label).toBe("sex 07/08");
    expect(w.from.toISOString()).toBe("2026-08-07T03:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-08-08T03:00:00.000Z");
  });

  it("dias úteis fechados da semana: seg=0, ter=1, sex=4", () => {
    expect(businessDaysMonToYesterday(new Date("2026-08-10T11:30:00.000Z"))).toBe(0);
    expect(businessDaysMonToYesterday(new Date("2026-08-11T11:30:00.000Z"))).toBe(1);
    expect(businessDaysMonToYesterday(new Date("2026-08-14T11:30:00.000Z"))).toBe(4);
  });

  it("fim de semana não é dia útil", () => {
    expect(isBusinessDayBahia(new Date("2026-08-08T15:00:00.000Z"))).toBe(false); // sáb
    expect(isBusinessDayBahia(new Date("2026-08-10T15:00:00.000Z"))).toBe(true); // seg
  });
});

describe("calendário do plano", () => {
  it("10/08 é o dia 1; 09/10 cai no dia civil 61 (o consumidor mostra 'dia 60')", () => {
    expect(planDayNumber(new Date("2026-08-10T12:00:00.000Z"))).toBe(1);
    expect(planDayNumber(new Date("2026-08-21T12:00:00.000Z"))).toBe(12);
    expect(planDayNumber(new Date("2026-10-09T12:00:00.000Z"))).toBe(61);
  });

  it("fase corrente segue as datas civis", () => {
    expect(currentPhase(new Date("2026-08-09T12:00:00.000Z")).n).toBe(0);
    expect(currentPhase(new Date("2026-08-15T12:00:00.000Z")).n).toBe(1);
    expect(currentPhase(new Date("2026-08-25T12:00:00.000Z")).n).toBe(2);
    expect(currentPhase(new Date("2026-09-20T12:00:00.000Z")).n).toBe(3);
  });

  it("próximo checkpoint inclui o de hoje; depois do último, null", () => {
    expect(nextCheckpoint(new Date("2026-08-21T12:00:00.000Z"))?.slug).toBe("cp-2026-08-21");
    expect(nextCheckpoint(new Date("2026-08-22T12:00:00.000Z"))?.slug).toBe("cp-2026-09-04");
    expect(nextCheckpoint(new Date("2026-10-10T12:00:00.000Z"))).toBeNull();
  });

  it("daysUntil conta dias civis", () => {
    expect(daysUntil("2026-08-21", new Date("2026-08-11T11:30:00.000Z"))).toBe(10);
    expect(daysUntil("2026-08-21", new Date("2026-08-21T11:30:00.000Z"))).toBe(0);
  });
});
