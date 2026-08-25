import { describe, expect, it } from "vitest";

import { tarefaDeRetorno } from "@/lib/calls/tarefa-de-retorno";

/**
 * O combinado da ligação virando tarefa — e, principalmente, NÃO virando.
 *
 * Fuso America/Bahia (−03:00 fixo) com `agora` injetado: nenhum teste depende
 * do relógio da máquina.
 */

/** 25/08/2026, 14:00 na Bahia = 17:00Z. */
const AGORA = new Date("2026-08-25T17:00:00.000Z");

const combinado = (over: Partial<{ data: string; hora: string; combinado: string }> = {}) => ({
  data: "2026-08-27",
  hora: "09:00",
  combinado: "pediu pra ligar quinta de manhã, antes das 10",
  ...over,
});

describe("tarefaDeRetorno", () => {
  it("marca o retorno na hora civil da Bahia", () => {
    const t = tarefaDeRetorno(combinado(), "ADS Móveis Planejados", AGORA);
    expect(t).not.toBeNull();
    // 27/08 09:00 na Bahia = 12:00Z.
    expect(t?.prazo.toISOString()).toBe("2026-08-27T12:00:00.000Z");
    expect(t?.kind).toBe("ligar");
  });

  it("põe o nome do lead no título — é a lista que o SDR lê", () => {
    const t = tarefaDeRetorno(combinado(), "ADS Móveis Planejados", AGORA);
    expect(t?.titulo).toBe("Retornar a ligação — ADS Móveis Planejados");
  });

  it("guarda o pedido nas palavras dele", () => {
    const t = tarefaDeRetorno(combinado(), "ADS", AGORA);
    expect(t?.nota).toContain("quinta de manhã");
  });

  it("sem nome do lead, o título ainda funciona", () => {
    const t = tarefaDeRetorno(combinado(), null, AGORA);
    expect(t?.titulo).toBe("Retornar a ligação");
  });

  it("sem combinado, não inventa tarefa", () => {
    expect(tarefaDeRetorno(null, "ADS", AGORA)).toBeNull();
    expect(tarefaDeRetorno(undefined, "ADS", AGORA)).toBeNull();
  });

  it("recusa combinado vazio", () => {
    expect(tarefaDeRetorno(combinado({ combinado: "   " }), "ADS", AGORA)).toBeNull();
  });

  it("recusa formato de data ou hora quebrado", () => {
    expect(tarefaDeRetorno(combinado({ data: "27/08/2026" }), "ADS", AGORA)).toBeNull();
    expect(tarefaDeRetorno(combinado({ hora: "9h" }), "ADS", AGORA)).toBeNull();
    expect(tarefaDeRetorno(combinado({ hora: "25:00" }), "ADS", AGORA)).toBeNull();
  });

  /** O caso que `dataValida` sozinha deixa passar: o formato cola, o dia não existe. */
  it("recusa dia que não existe em vez de rolar para o mês seguinte", () => {
    expect(tarefaDeRetorno(combinado({ data: "2026-02-31" }), "ADS", AGORA)).toBeNull();
  });

  it("recusa retorno no passado — o modelo errou o ano", () => {
    expect(tarefaDeRetorno(combinado({ data: "2025-08-27" }), "ADS", AGORA)).toBeNull();
  });

  /** Pedido "daqui a pouco" cuja hora venceu enquanto a análise rodava: vale. */
  it("aceita o que venceu há poucos minutos, e o prazo nasce vencido", () => {
    const t = tarefaDeRetorno(
      combinado({ data: "2026-08-25", hora: "13:58" }),
      "ADS",
      AGORA,
    );
    expect(t).not.toBeNull();
    expect(t!.prazo.getTime()).toBeLessThan(AGORA.getTime());
  });

  it("recusa data absurdamente longe — isso é bug, não combinado", () => {
    expect(tarefaDeRetorno(combinado({ data: "2027-08-27" }), "ADS", AGORA)).toBeNull();
  });
});
