import { describe, expect, it } from "vitest";

import {
  ancoraDoPainel,
  foiArraste,
  grudarNaTela,
  MARGEM,
  posicaoPadrao,
  TAMANHO_DO_ROBO,
} from "./posicao";

/**
 * A bolinha solta tem um jeito de falhar que ninguém percebe até acontecer:
 * o robô sai da janela e não há como trazê-lo de volta pelo próprio robô — só
 * limpando o armazenamento do navegador. Os testes de `grudarNaTela` existem
 * para esse buraco, não para a matemática.
 */

const TELA = { vw: 1440, vh: 900 };
const CELULAR = { vw: 390, vh: 780 };

describe("posicaoPadrao", () => {
  it("nasce no canto de baixo à direita", () => {
    const p = posicaoPadrao(TELA.vw, TELA.vh, false);
    expect(p.x).toBe(TELA.vw - TAMANHO_DO_ROBO - 16);
    expect(p.y).toBe(TELA.vh - TAMANHO_DO_ROBO - 24);
  });

  it("no celular sobe o suficiente para não cobrir a barra de navegação", () => {
    const celular = posicaoPadrao(CELULAR.vw, CELULAR.vh, true);
    const desktop = posicaoPadrao(CELULAR.vw, CELULAR.vh, false);
    expect(celular.y).toBeLessThan(desktop.y);
  });
});

describe("grudarNaTela", () => {
  it("traz de volta o robô largado fora da janela", () => {
    const p = grudarNaTela({ x: 5000, y: 5000 }, TELA.vw, TELA.vh);
    expect(p.x).toBe(TELA.vw - TAMANHO_DO_ROBO - MARGEM);
    expect(p.y).toBe(TELA.vh - TAMANHO_DO_ROBO - MARGEM);
  });

  it("traz de volta o robô com coordenada negativa", () => {
    expect(grudarNaTela({ x: -80, y: -80 }, TELA.vw, TELA.vh)).toEqual({ x: MARGEM, y: MARGEM });
  });

  it("janela que encolheu não some com o botão", () => {
    const largo = { x: 1376, y: 828 };
    const depois = grudarNaTela(largo, 500, 400);
    expect(depois.x).toBeLessThanOrEqual(500 - TAMANHO_DO_ROBO);
    expect(depois.y).toBeLessThanOrEqual(400 - TAMANHO_DO_ROBO);
  });

  it("janela menor que o próprio robô ainda devolve ponto visível", () => {
    const p = grudarNaTela({ x: 300, y: 300 }, 40, 40);
    expect(p).toEqual({ x: MARGEM, y: MARGEM });
  });

  it("posição válida não é mexida", () => {
    expect(grudarNaTela({ x: 400, y: 400 }, TELA.vw, TELA.vh)).toEqual({ x: 400, y: 400 });
  });
});

describe("ancoraDoPainel", () => {
  const L = 340;
  const A = 400;

  it("robô à direita abre o painel para a esquerda", () => {
    const a = ancoraDoPainel({ x: 1376, y: 828 }, TELA.vw, TELA.vh, L, A);
    expect(a.left).toBeLessThan(1376);
    expect(a.left + L).toBeLessThanOrEqual(TELA.vw);
  });

  it("robô à esquerda abre o painel para a direita", () => {
    const a = ancoraDoPainel({ x: 20, y: 828 }, TELA.vw, TELA.vh, L, A);
    expect(a.left).toBe(20);
  });

  it("robô embaixo abre o painel para cima, e vice-versa", () => {
    const embaixo = ancoraDoPainel({ x: 700, y: 800 }, TELA.vw, TELA.vh, L, A);
    const emCima = ancoraDoPainel({ x: 700, y: 40 }, TELA.vw, TELA.vh, L, A);
    expect(embaixo.top).toBeLessThan(800);
    expect(emCima.top).toBeGreaterThan(40);
  });

  it("o painel nunca sai da janela, nem em tela de celular", () => {
    for (const canto of [
      { x: 0, y: 0 },
      { x: CELULAR.vw, y: 0 },
      { x: 0, y: CELULAR.vh },
      { x: CELULAR.vw, y: CELULAR.vh },
    ]) {
      const a = ancoraDoPainel(canto, CELULAR.vw, CELULAR.vh, L, A);
      expect(a.left).toBeGreaterThanOrEqual(MARGEM);
      expect(a.top).toBeGreaterThanOrEqual(MARGEM);
    }
  });
});

describe("foiArraste", () => {
  it("tremida do dedo continua sendo clique", () => {
    expect(foiArraste({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(false);
  });

  it("movimento de verdade é arraste, em qualquer direção", () => {
    expect(foiArraste({ x: 100, y: 100 }, { x: 130, y: 100 })).toBe(true);
    expect(foiArraste({ x: 100, y: 100 }, { x: 100, y: 60 })).toBe(true);
  });
});
