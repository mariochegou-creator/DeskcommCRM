import { describe, expect, it } from "vitest";

import {
  etapaDeModelo,
  modelosDaEtapa,
  tituloDaTarefa,
} from "@/lib/tarefas/modelos-de-etapa";

/**
 * O checklist que nasce quando o card entra na coluna.
 *
 * Fuso America/Bahia (−03:00 fixo) com `agora` injetado — nenhum teste depende
 * do relógio da máquina.
 */

/** 12/08/2026, 09:00 na Bahia = 12:00Z. */
const MANHA = new Date("2026-08-12T12:00:00.000Z");
/** 12/08/2026, 19:30 na Bahia = 22:30Z — depois das 18h. */
const NOITE = new Date("2026-08-12T22:30:00.000Z");

describe("etapaDeModelo", () => {
  it("reconhece as três colunas do funil da NEXO pelo nome e pelo slug", () => {
    expect(etapaDeModelo({ name: "R1 agendada", slug: "r1-agendada" })).toBe("r1-agendada");
    expect(etapaDeModelo({ name: "R1 Realizada", slug: "r1_realizada" })).toBe("r1-realizada");
    expect(etapaDeModelo({ name: "Non Show", slug: "non_show" })).toBe("non-show");
  });

  it("«realizada» ganha de «agendada» — as duas colunas dizem R1 e convivem", () => {
    // O preparo da reunião não pode nascer no dia em que ela já aconteceu.
    expect(etapaDeModelo({ name: "R1 realizada (agendada em julho)" })).toBe("r1-realizada");
  });

  it("aceita as variações de escrita de no-show", () => {
    for (const nome of ["No Show", "no-show", "Noshow", "NON SHOW"]) {
      expect(etapaDeModelo({ name: nome })).toBe("non-show");
    }
  });

  it("coluna sem checklist devolve null — e nenhuma tarefa", () => {
    for (const nome of ["A contatar", "Contatado", "Respondeu", "Ganho", "Perdido", "R2 Realizada"]) {
      expect(etapaDeModelo({ name: nome })).toBeNull();
      expect(modelosDaEtapa({ name: nome })).toHaveLength(0);
    }
  });

  it("etapa sem nome nem slug não quebra", () => {
    expect(etapaDeModelo({})).toBeNull();
    expect(etapaDeModelo({ name: null, slug: null })).toBeNull();
  });
});

describe("modelosDaEtapa", () => {
  it("R1 agendada pede o roteiro e o levantamento, os dois para o closer", () => {
    const modelos = modelosDaEtapa({ name: "R1 agendada" });
    expect(modelos.map((m) => m.chave)).toEqual(["r1-roteiro", "r1-levantamento"]);
    expect(modelos.every((m) => m.papel === "closer")).toBe(true);
  });

  it("Non Show é do SDR — quem corre atrás de remarcar", () => {
    const modelos = modelosDaEtapa({ name: "Non Show" });
    expect(modelos.map((m) => m.papel)).toEqual(["sdr", "sdr"]);
  });

  it("nenhuma coluna passa de duas tarefas", () => {
    for (const nome of ["R1 agendada", "R1 Realizada", "Non Show"]) {
      expect(modelosDaEtapa({ name: nome }).length).toBeLessThanOrEqual(2);
    }
  });
});

describe("prazos", () => {
  it("de manhã, o preparo da R1 vence hoje às 18h da Bahia", () => {
    const [roteiro] = modelosDaEtapa({ name: "R1 agendada" });
    expect(roteiro?.prazo(MANHA).toISOString()).toBe("2026-08-12T21:00:00.000Z");
  });

  it("depois das 18h, vira daqui a 2 horas — tarefa não nasce vencida", () => {
    const [roteiro] = modelosDaEtapa({ name: "R1 agendada" });
    const prazo = roteiro?.prazo(NOITE);
    expect(prazo?.getTime()).toBeGreaterThan(NOITE.getTime());
    expect(prazo?.toISOString()).toBe("2026-08-13T00:30:00.000Z");
  });

  it("a APN é para amanhã às 9h da Bahia", () => {
    const apn = modelosDaEtapa({ name: "R1 Realizada" }).find((m) => m.chave === "r2-apn");
    expect(apn?.prazo(MANHA).toISOString()).toBe("2026-08-13T12:00:00.000Z");
  });

  it("no-show é para agora: 1 hora para ligar, 3 para a mensagem", () => {
    const modelos = modelosDaEtapa({ name: "Non Show" });
    expect(modelos[0]?.prazo(MANHA).toISOString()).toBe("2026-08-12T13:00:00.000Z");
    expect(modelos[1]?.prazo(MANHA).toISOString()).toBe("2026-08-12T15:00:00.000Z");
  });

  it("nenhum prazo nasce no passado, em qualquer hora do dia", () => {
    for (let h = 0; h < 24; h++) {
      const agora = new Date(`2026-08-12T${String(h).padStart(2, "0")}:00:00.000Z`);
      for (const nome of ["R1 agendada", "R1 Realizada", "Non Show"]) {
        for (const m of modelosDaEtapa({ name: nome })) {
          expect(m.prazo(agora).getTime()).toBeGreaterThan(agora.getTime());
        }
      }
    }
  });
});

describe("tituloDaTarefa", () => {
  it("cola o nome do negócio — cinco cards em Non Show não podem virar cinco linhas iguais", () => {
    const [ligar] = modelosDaEtapa({ name: "Non Show" });
    expect(tituloDaTarefa(ligar!, "GNG Solar")).toBe("Ligar para remarcar — GNG Solar");
  });

  it("lead sem nome não deixa travessão solto no título", () => {
    const [ligar] = modelosDaEtapa({ name: "Non Show" });
    expect(tituloDaTarefa(ligar!, null)).toBe("Ligar para remarcar");
    expect(tituloDaTarefa(ligar!, "   ")).toBe("Ligar para remarcar");
  });

  it("respeita o teto de 200 caracteres do banco", () => {
    const [ligar] = modelosDaEtapa({ name: "Non Show" });
    expect(tituloDaTarefa(ligar!, "x".repeat(500)).length).toBe(200);
  });

  it("o mesmo modelo e o mesmo lead dão sempre o mesmo título — é a trava contra duplicata", () => {
    const [roteiro] = modelosDaEtapa({ name: "R1 agendada" });
    expect(tituloDaTarefa(roteiro!, "GNG Solar")).toBe(tituloDaTarefa(roteiro!, "GNG Solar"));
  });
});
