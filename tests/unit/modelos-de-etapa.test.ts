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

/** As colunas do funil «Prospecção» que têm checklist, como estão escritas nele. */
const COM_CHECKLIST = [
  "Respondeu",
  "R1 agendada",
  "R1 Realizada",
  "R2 Realizada",
  "Non Show",
  "Flow up",
] as const;

describe("etapaDeModelo", () => {
  it("reconhece as seis colunas do funil da NEXO pelo nome e pelo slug", () => {
    expect(etapaDeModelo({ name: "Respondeu", slug: "respondeu" })).toBe("respondeu");
    expect(etapaDeModelo({ name: "R1 agendada", slug: "r1-agendada" })).toBe("r1-agendada");
    expect(etapaDeModelo({ name: "R1 Realizada", slug: "r1_realizada" })).toBe("r1-realizada");
    expect(etapaDeModelo({ name: "R2 Realizada", slug: "r2_realizada" })).toBe("r2-realizada");
    expect(etapaDeModelo({ name: "Non Show", slug: "non_show" })).toBe("non-show");
    expect(etapaDeModelo({ name: "Flow up", slug: "flow-up" })).toBe("flow-up");
  });

  it("«realizada» ganha de «agendada» — as duas colunas dizem R1 e convivem", () => {
    // O preparo da reunião não pode nascer no dia em que ela já aconteceu.
    expect(etapaDeModelo({ name: "R1 realizada (agendada em julho)" })).toBe("r1-realizada");
  });

  it("R2 realizada não vira R1 realizada — são checklists opostos", () => {
    // Confundir aqui pediria "marcar a R2" de um negócio que já a fez.
    expect(etapaDeModelo({ name: "R2 Realizada" })).toBe("r2-realizada");
    expect(modelosDaEtapa({ name: "R2 Realizada" }).map((m) => m.chave)).toEqual([
      "r2-registrar",
      "r2-followup",
    ]);
  });

  it("aceita as variações de escrita de no-show", () => {
    for (const nome of ["No Show", "no-show", "Noshow", "NON SHOW"]) {
      expect(etapaDeModelo({ name: nome })).toBe("non-show");
    }
  });

  it("«Flow up» e «Follow-up» são a mesma coluna — a grafia de ouvido não pode custar o checklist", () => {
    for (const nome of ["Flow up", "flow-up", "Follow up", "follow-up", "Followup", "FLOWUP"]) {
      expect(etapaDeModelo({ name: nome })).toBe("flow-up");
    }
  });

  it("coluna sem checklist devolve null — e nenhuma tarefa", () => {
    for (const nome of ["A contatar", "Contatado", "Ganho", "Perdido", "Investigacao"]) {
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

  it("«Respondeu» é do SDR e pede UMA coisa — a janela é de horas, não de dias", () => {
    const modelos = modelosDaEtapa({ name: "Respondeu" });
    expect(modelos.map((m) => m.chave)).toEqual(["respondeu-puxar-r1"]);
    expect(modelos[0]?.papel).toBe("sdr");
  });

  it("depois da R2 o closer registra a objeção antes de fazer o follow-up", () => {
    // A ordem é o roteiro: sem a objeção anotada, o follow-up não tem o que citar.
    const modelos = modelosDaEtapa({ name: "R2 Realizada" });
    expect(modelos.map((m) => m.kind)).toEqual(["nota", "mensagem"]);
    expect(modelos.every((m) => m.papel === "closer")).toBe(true);
  });

  it("«Flow up» sempre marca a data de decidir — é o que impede a coluna virar depósito", () => {
    const modelos = modelosDaEtapa({ name: "Flow up" });
    expect(modelos.map((m) => m.chave)).toEqual(["flowup-mandar", "flowup-decidir"]);
  });

  it("nenhuma coluna passa de duas tarefas", () => {
    for (const nome of COM_CHECKLIST) {
      expect(modelosDaEtapa({ name: nome }).length).toBeLessThanOrEqual(2);
    }
  });

  it("toda coluna com checklist cria pelo menos uma tarefa", () => {
    for (const nome of COM_CHECKLIST) {
      expect(modelosDaEtapa({ name: nome }).length).toBeGreaterThan(0);
    }
  });

  it("nenhuma chave de modelo se repete entre colunas — a trava contra duplicata é o título", () => {
    const chaves = COM_CHECKLIST.flatMap((n) => modelosDaEtapa({ name: n }).map((m) => m.chave));
    expect(new Set(chaves).size).toBe(chaves.length);
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

  it("o follow-up da proposta é em 2 dias e o de decidir em 5 — sempre às 9h da Bahia", () => {
    const r2 = modelosDaEtapa({ name: "R2 Realizada" }).find((m) => m.chave === "r2-followup");
    expect(r2?.prazo(MANHA).toISOString()).toBe("2026-08-14T12:00:00.000Z");

    const decidir = modelosDaEtapa({ name: "Flow up" }).find((m) => m.chave === "flowup-decidir");
    expect(decidir?.prazo(MANHA).toISOString()).toBe("2026-08-17T12:00:00.000Z");
  });

  it("prazo de vários dias não herda a hora do arrasto — arrastar às 22h30 ainda vence às 9h", () => {
    const r2 = modelosDaEtapa({ name: "R2 Realizada" }).find((m) => m.chave === "r2-followup");
    expect(r2?.prazo(NOITE).toISOString()).toBe("2026-08-14T12:00:00.000Z");
  });

  it("nenhum prazo nasce no passado, em qualquer hora do dia", () => {
    for (let h = 0; h < 24; h++) {
      const agora = new Date(`2026-08-12T${String(h).padStart(2, "0")}:00:00.000Z`);
      for (const nome of COM_CHECKLIST) {
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
