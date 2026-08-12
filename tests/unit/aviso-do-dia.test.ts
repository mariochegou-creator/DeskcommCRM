import { describe, expect, it } from "vitest";

import {
  carimboDoDia,
  chaveDoAviso,
  precisaAvisar,
  tarefasParaAvisar,
} from "@/lib/tarefas/aviso-do-dia";

/** 12/08/2026, 09:00 na Bahia = 12:00Z. */
const AGORA = new Date("2026-08-12T12:00:00.000Z");

function tarefa(due_at: string, status = "pending") {
  return { status, due_at };
}

describe("tarefasParaAvisar", () => {
  it("avisa o que vence hoje", () => {
    const hoje = tarefa("2026-08-12T20:00:00.000Z"); // 17h na Bahia
    expect(tarefasParaAvisar([hoje], AGORA)).toEqual([hoje]);
  });

  it("avisa o que já venceu, inclusive de dias atrás", () => {
    const ontem = tarefa("2026-08-11T12:00:00.000Z");
    const semanaPassada = tarefa("2026-08-05T12:00:00.000Z");
    expect(tarefasParaAvisar([ontem, semanaPassada], AGORA)).toHaveLength(2);
  });

  it("não avisa o que está marcado para depois de hoje", () => {
    // 23h59 da Bahia de hoje ainda é hoje; 00h01 de amanhã já não é.
    expect(tarefasParaAvisar([tarefa("2026-08-13T02:59:00.000Z")], AGORA)).toHaveLength(1);
    expect(tarefasParaAvisar([tarefa("2026-08-13T03:01:00.000Z")], AGORA)).toHaveLength(0);
  });

  it("tarefa resolvida ou cancelada não avisa", () => {
    const vencida = "2026-08-11T12:00:00.000Z";
    expect(tarefasParaAvisar([tarefa(vencida, "done")], AGORA)).toHaveLength(0);
    expect(tarefasParaAvisar([tarefa(vencida, "canceled")], AGORA)).toHaveLength(0);
  });

  it("data inválida é ignorada em vez de derrubar a tela", () => {
    expect(tarefasParaAvisar([tarefa("não é data")], AGORA)).toHaveLength(0);
  });

  it("lista vazia não avisa", () => {
    expect(tarefasParaAvisar([], AGORA)).toHaveLength(0);
  });
});

describe("o carimbo de uma vez por dia", () => {
  it("sem carimbo, avisa", () => {
    expect(precisaAvisar(null, AGORA)).toBe(true);
  });

  it("carimbado hoje, não avisa de novo", () => {
    expect(precisaAvisar(carimboDoDia(AGORA), AGORA)).toBe(false);
  });

  it("carimbo de ontem avisa de novo", () => {
    expect(precisaAvisar("2026-08-11", AGORA)).toBe(true);
  });

  it("o dia vira às 00h da BAHIA, não às 00h UTC", () => {
    // 12/08 21:00 na Bahia = 13/08 00:00Z. Ainda é dia 12 para a operação.
    const noiteDaBahia = new Date("2026-08-13T00:00:00.000Z");
    expect(carimboDoDia(noiteDaBahia)).toBe("2026-08-12");
    expect(precisaAvisar("2026-08-12", noiteDaBahia)).toBe(false);
  });

  it("a chave é por conversa — avisar de um lead não cala o outro", () => {
    expect(chaveDoAviso("abc")).not.toBe(chaveDoAviso("def"));
    expect(chaveDoAviso("abc")).toContain("abc");
  });
});
