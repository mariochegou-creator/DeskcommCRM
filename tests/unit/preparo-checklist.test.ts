import { describe, expect, it } from "vitest";

import { lerReuniao, type Reuniao } from "@/lib/agendamento/reuniao";
import {
  ehItemManual,
  estaAcontecendo,
  montarChecklist,
  quandoDaReuniao,
  resumoDoChecklist,
} from "@/lib/sala-reunioes/preparo";

/**
 * O checklist do preparo da Sala de Reuniões.
 *
 * Fuso America/Bahia (−03:00 fixo) com `agora` injetado: nenhum teste depende do
 * relógio da máquina — mesma regra dos testes de prazo das tarefas.
 */

/** 11/08/2026, 14:00 na Bahia = 17:00Z. */
const AGORA = new Date("2026-08-11T17:00:00.000Z");

/** R1 amanhã (12/08) às 10:00 na Bahia = 13:00Z, marcada hoje às 14:00. */
function reuniaoBase(patch: Partial<Reuniao> = {}): Reuniao {
  return {
    tipo: "r1",
    em: "2026-08-12T13:00:00.000Z",
    data: "2026-08-12",
    hora: "10:00",
    criada_em: AGORA.toISOString(),
    criada_por: null,
    avisos: {},
    gcal_event_id: null,
    gcal_link: null,
    checklist: {},
    ...patch,
  };
}

function acharItem(reuniao: Reuniao, id: string, agora = AGORA) {
  const item = montarChecklist(reuniao, agora).find((i) => i.id === id);
  if (!item) throw new Error(`item ${id} não existe no checklist`);
  return item;
}

describe("montarChecklist — os itens automáticos relatam o banco", () => {
  it("sem carimbo de confirmação o convite fica pendente e o texto NÃO afirma que falhou", () => {
    const item = acharItem(reuniaoBase(), "convite");
    expect(item.feito).toBe(false);
    expect(item.origem).toBe("automatico");
    // Reunião marcada antes do carimbo existir cairia aqui: "não consta" é
    // verdade; "não foi enviado" seria mentira.
    expect(item.detalhe).toContain("não consta");
  });

  it("com carimbo, o convite fica feito e mostra quando saiu (hora da Bahia)", () => {
    const item = acharItem(
      reuniaoBase({ avisos: { confirmacao: "2026-08-11T17:29:00.000Z" } }),
      "convite",
    );
    expect(item.feito).toBe(true);
    expect(item.detalhe).toBe("saiu 11/08 às 14:29");
  });

  it("o lembrete da véspera anuncia a hora em que vai sair", () => {
    // 18h do dia 11/08 (Bahia) — a véspera da reunião do dia 12.
    expect(acharItem(reuniaoBase(), "lembrete_vespera").detalhe).toBe("sai 11/08 às 18h");
  });

  it("marcada DEPOIS das 18h da véspera, o lembrete da véspera não sai — e diz isso", () => {
    // Marcada às 20h da Bahia (23:00Z) do dia 11 para o dia 12 às 10h: a véspera
    // já venceu. É a mesma guarda do cron (`lembretesDevidos`).
    const tarde = new Date("2026-08-11T23:00:00.000Z");
    const item = acharItem(reuniaoBase({ criada_em: tarde.toISOString() }), "lembrete_vespera", tarde);
    expect(item.feito).toBe(false);
    expect(item.detalhe).toContain("não sai");
  });

  it("o toque final anuncia 1h antes da reunião", () => {
    expect(acharItem(reuniaoBase(), "lembrete_final").detalhe).toBe("sai 12/08 às 09:00");
  });

  it("item automático nunca vira manual — não há como marcá-lo à mão", () => {
    const automaticos = montarChecklist(reuniaoBase(), AGORA).filter(
      (i) => i.origem === "automatico",
    );
    expect(automaticos.map((i) => i.id)).toEqual([
      "convite",
      "lembrete_vespera",
      "lembrete_final",
    ]);
  });
});

describe("montarChecklist — os itens manuais", () => {
  it("marcado no jsonb, aparece feito e com o carimbo da marcação", () => {
    const item = acharItem(
      reuniaoBase({ checklist: { dossie: "2026-08-11T17:05:00.000Z" } }),
      "dossie",
    );
    expect(item.feito).toBe(true);
    expect(item.detalhe).toBe("marcado 11/08 às 14:05");
  });

  it("a R1 pede demo e não pede APN; a R2 é o contrário", () => {
    const r1 = montarChecklist(reuniaoBase(), AGORA).map((i) => i.id);
    const r2 = montarChecklist(reuniaoBase({ tipo: "r2" }), AGORA).map((i) => i.id);

    expect(r1).toContain("demo");
    expect(r1).not.toContain("apn");
    expect(r2).toContain("apn");
    expect(r2).toContain("investimento");
    expect(r2).not.toContain("demo");
  });

  it("com evento no Google Agenda, o item da agenda vira automático e já nasce feito", () => {
    const item = acharItem(reuniaoBase({ gcal_event_id: "evt_123" }), "agenda");
    expect(item.feito).toBe(true);
    expect(item.origem).toBe("automatico");
  });

  it("sem a integração ligada, a agenda continua sendo pergunta para o humano", () => {
    expect(acharItem(reuniaoBase(), "agenda").origem).toBe("manual");
  });
});

describe("ehItemManual — o gate da rota que grava", () => {
  it("aceita item do tipo certo", () => {
    expect(ehItemManual("apn", "r2")).toBe(true);
    expect(ehItemManual("demo", "r1")).toBe(true);
  });

  it("recusa item de outro tipo de reunião e id inventado", () => {
    expect(ehItemManual("apn", "r1")).toBe(false);
    expect(ehItemManual("qualquer_coisa", "r1")).toBe(false);
  });

  it("recusa item automático — o banco é quem responde por ele", () => {
    expect(ehItemManual("lembrete_vespera", "r1")).toBe(false);
    expect(ehItemManual("convite", "r1")).toBe(false);
  });
});

describe("resumoDoChecklist", () => {
  it("conta feitos e faltantes", () => {
    const itens = montarChecklist(
      reuniaoBase({
        avisos: { confirmacao: AGORA.toISOString() },
        checklist: { dossie: AGORA.toISOString() },
      }),
      AGORA,
    );
    const resumo = resumoDoChecklist(itens);
    expect(resumo.feitos).toBe(2);
    expect(resumo.total).toBe(itens.length);
    expect(resumo.faltam).toBe(itens.length - 2);
  });
});

describe("quandoDaReuniao e estaAcontecendo", () => {
  it("fala em hoje/amanhã antes de falar em data", () => {
    expect(quandoDaReuniao(reuniaoBase(), AGORA)).toBe("amanhã às 10h");
    expect(quandoDaReuniao(reuniaoBase({ em: "2026-08-11T20:00:00.000Z" }), AGORA)).toBe(
      "hoje às 17h",
    );
    expect(quandoDaReuniao(reuniaoBase({ em: "2026-08-14T19:00:00.000Z" }), AGORA)).toBe(
      "sexta-feira (14/08) às 16h",
    );
  });

  it("continua 'acontecendo' por 90 min depois da hora — quem entrou atrasado ainda a encontra", () => {
    const emCima = new Date("2026-08-11T17:00:00.000Z");
    const reuniao = reuniaoBase({ em: "2026-08-11T17:00:00.000Z" });
    expect(estaAcontecendo(reuniao, emCima)).toBe(true);
    expect(estaAcontecendo(reuniao, new Date("2026-08-11T18:29:00.000Z"))).toBe(true);
    expect(estaAcontecendo(reuniao, new Date("2026-08-11T18:31:00.000Z"))).toBe(false);
    expect(estaAcontecendo(reuniao, new Date("2026-08-11T16:59:00.000Z"))).toBe(false);
  });
});

describe("lerReuniao preserva o checklist", () => {
  it("copia o checklist de volta — senão o próximo lembrete do cron o apagaria", () => {
    // O cron lê com `lerReuniao` e regrava `{ ...reuniao, avisos }`. Campo que a
    // peneira não copia é campo que some às 18h da véspera.
    const lida = lerReuniao({
      reuniao: {
        tipo: "r1",
        em: "2026-08-12T13:00:00.000Z",
        data: "2026-08-12",
        hora: "10:00",
        criada_em: AGORA.toISOString(),
        avisos: { confirmacao: "2026-08-11T17:29:00.000Z" },
        checklist: { dossie: "2026-08-11T17:05:00.000Z", lixo: 42 },
      },
    });
    expect(lida?.checklist).toEqual({ dossie: "2026-08-11T17:05:00.000Z" });
    expect(lida?.avisos?.confirmacao).toBe("2026-08-11T17:29:00.000Z");
  });
});
