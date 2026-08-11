import { describe, expect, it } from "vitest";

import {
  atalhosDePrazo,
  compararTarefas,
  estadoDoPrazo,
  formatarPrazo,
  instanteParaInputLocal,
  inputLocalParaInstante,
  mesmoDia,
  tituloSugerido,
} from "@/lib/tarefas/tarefa";

/**
 * A aritmética de prazo das tarefas (0101).
 *
 * Tudo aqui é fuso America/Bahia (−03:00 fixo) com `now` injetado: nenhum teste
 * depende do relógio da máquina — foi assim que os testes de data do plano de 60
 * dias passaram a rodar igual no Windows do Mario e no CI.
 */

/** 11/08/2026, 14:00 na Bahia = 17:00Z. */
const AGORA = new Date("2026-08-11T17:00:00.000Z");

describe("estadoDoPrazo", () => {
  it("prazo passado é atrasada", () => {
    expect(estadoDoPrazo(new Date("2026-08-11T16:59:00.000Z"), AGORA)).toBe("atrasada");
  });

  it("os 15 minutos antes do vencimento são 'agora' — a ligação se prepara antes da hora", () => {
    expect(estadoDoPrazo(new Date("2026-08-11T17:10:00.000Z"), AGORA)).toBe("agora");
  });

  it("mais tarde no mesmo dia civil é 'hoje'", () => {
    expect(estadoDoPrazo(new Date("2026-08-11T21:00:00.000Z"), AGORA)).toBe("hoje");
  });

  it("depois da meia-noite da Bahia já é 'futura', mesmo antes da meia-noite UTC", () => {
    // 12/08 00:30 na Bahia = 03:30Z do dia 12 — mas 11/08 23:30Z ainda é dia 11
    // lá. Este é o par que pega o bug de comparar em UTC.
    expect(estadoDoPrazo(new Date("2026-08-11T23:30:00.000Z"), AGORA)).toBe("hoje");
    expect(estadoDoPrazo(new Date("2026-08-12T03:30:00.000Z"), AGORA)).toBe("futura");
  });
});

describe("formatarPrazo", () => {
  it("hoje, amanhã e ontem viram palavra; o resto vira data", () => {
    expect(formatarPrazo(new Date("2026-08-11T21:00:00.000Z"), AGORA)).toBe("hoje 18:00");
    expect(formatarPrazo(new Date("2026-08-12T12:00:00.000Z"), AGORA)).toBe("amanhã 09:00");
    expect(formatarPrazo(new Date("2026-08-14T13:00:00.000Z"), AGORA)).toBe("sex 14/08 10:00");
  });

  it("prefixa 'atrasada' quando o prazo já passou", () => {
    expect(formatarPrazo(new Date("2026-08-10T17:00:00.000Z"), AGORA)).toBe(
      "atrasada · ontem 14:00",
    );
  });
});

describe("atalhosDePrazo", () => {
  it("sem reunião marcada, oferece só os genéricos", () => {
    const ids = atalhosDePrazo(AGORA).map((a) => a.id);
    expect(ids).toEqual(["1h", "3h", "hoje18", "amanha9"]);
    expect(atalhosDePrazo(AGORA).every((a) => !a.daReuniao)).toBe(true);
  });

  it("'Hoje 18h' some depois das 18h — atalho não nasce no passado", () => {
    const noiteNaBahia = new Date("2026-08-11T22:00:00.000Z"); // 19h na Bahia
    expect(atalhosDePrazo(noiteNaBahia).map((a) => a.id)).not.toContain("hoje18");
  });

  it("com reunião marcada, as antecedências vêm primeiro e na ordem do mais cedo", () => {
    // Reunião depois de amanhã (13/08) às 10:00 na Bahia = 13:00Z. As quatro
    // antecedências cabem no futuro — com a reunião de AMANHÃ às 10h, "1 dia
    // antes" já teria passado (é o caso do teste seguinte).
    const reuniao = new Date("2026-08-13T13:00:00.000Z");
    const atalhos = atalhosDePrazo(AGORA, reuniao);
    expect(atalhos.slice(0, 4).map((a) => a.id)).toEqual(["r-1d", "r-5h", "r-2h", "r-30m"]);
    expect(atalhos.slice(0, 4).every((a) => a.daReuniao)).toBe(true);
    // "5h antes" de 13/08 10:00 é 13/08 05:00 (Bahia) — o rótulo mostra isso.
    expect(atalhos[1]!.rotulo).toBe("5h antes (13/08 05:00)");
  });

  it("reunião amanhã cedo: '1 dia antes' cai no passado e não é oferecido", () => {
    const amanhaAs10 = new Date("2026-08-12T13:00:00.000Z");
    const daReuniao = atalhosDePrazo(AGORA, amanhaAs10).filter((a) => a.daReuniao);
    expect(daReuniao.map((a) => a.id)).toEqual(["r-5h", "r-2h", "r-30m"]);
  });

  it("antecedência que já passou não é oferecida", () => {
    // Reunião hoje às 15:00 na Bahia (18:00Z), com agora = 14:00: "1 dia antes"
    // e "5h antes" estão no passado; sobram "2h antes"? não — também. Só 30min.
    const reuniao = new Date("2026-08-11T18:00:00.000Z");
    const daReuniao = atalhosDePrazo(AGORA, reuniao).filter((a) => a.daReuniao);
    expect(daReuniao.map((a) => a.id)).toEqual(["r-30m"]);
  });

  it("reunião que já aconteceu não gera atalho nenhum", () => {
    const ontem = new Date("2026-08-10T13:00:00.000Z");
    expect(atalhosDePrazo(AGORA, ontem).some((a) => a.daReuniao)).toBe(false);
  });
});

describe("input datetime-local ↔ instante", () => {
  it("o valor digitado é lido como hora da Bahia, não do navegador", () => {
    expect(inputLocalParaInstante("2026-08-12T14:00")?.toISOString()).toBe(
      "2026-08-12T17:00:00.000Z",
    );
  });

  it("ida e volta preserva o horário civil", () => {
    const d = new Date("2026-08-12T17:30:00.000Z");
    expect(instanteParaInputLocal(d)).toBe("2026-08-12T14:30");
    expect(inputLocalParaInstante(instanteParaInputLocal(d))?.getTime()).toBe(d.getTime());
  });

  it("texto inválido devolve null em vez de Invalid Date", () => {
    expect(inputLocalParaInstante("")).toBeNull();
    expect(inputLocalParaInstante("12/08/2026 14:00")).toBeNull();
  });
});

describe("mesmoDia", () => {
  it("compara o dia CIVIL da Bahia, não o UTC", () => {
    expect(mesmoDia(new Date("2026-08-11T23:00:00.000Z"), AGORA)).toBe(true);
    expect(mesmoDia(new Date("2026-08-12T03:00:00.000Z"), AGORA)).toBe(false);
  });
});

describe("tituloSugerido", () => {
  it("usa o nome do lead quando existe", () => {
    expect(tituloSugerido("ligar", "GNG Solar")).toBe("Ligar para GNG Solar");
  });

  it("cai para 'o lead' quando o nome está vazio", () => {
    expect(tituloSugerido("ligar", "   ")).toBe("Ligar para o lead");
  });

  it("'outro' não sugere nada — quem escolhe 'outro' vai escrever", () => {
    expect(tituloSugerido("outro", "GNG Solar")).toBe("");
  });
});

describe("compararTarefas", () => {
  it("pendentes primeiro, e entre elas a que vence antes", () => {
    const lista = [
      { status: "done" as const, due_at: "2026-08-11T10:00:00.000Z" },
      { status: "pending" as const, due_at: "2026-08-13T10:00:00.000Z" },
      { status: "pending" as const, due_at: "2026-08-11T10:00:00.000Z" },
    ];
    expect([...lista].sort(compararTarefas).map((t) => [t.status, t.due_at])).toEqual([
      ["pending", "2026-08-11T10:00:00.000Z"],
      ["pending", "2026-08-13T10:00:00.000Z"],
      ["done", "2026-08-11T10:00:00.000Z"],
    ]);
  });

  it("entre resolvidas, a mais recente primeiro — histórico se lê de trás para frente", () => {
    const lista = [
      { status: "done" as const, due_at: "2026-08-09T10:00:00.000Z" },
      { status: "canceled" as const, due_at: "2026-08-11T10:00:00.000Z" },
    ];
    expect([...lista].sort(compararTarefas)[0]!.due_at).toBe("2026-08-11T10:00:00.000Z");
  });
});
