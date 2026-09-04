import { describe, expect, it } from "vitest";

import {
  avisosDasConexoes,
  avisosDasTarefas,
  avisosDoInbox,
  avisosDoKanban,
  janelaDeAbordagem,
  ordenar,
  TETO_DE_AVISOS,
  type Aviso,
  type NumeroDeWhatsApp,
} from "./avisos";

/**
 * As regras do copiloto. São puras de propósito: o valor do módulo está em
 * ESCOLHER o que dizer, e escolha errada não aparece em teste de integração —
 * aparece como um painel que a pessoa aprendeu a ignorar.
 *
 * O que os testes protegem, em ordem de importância:
 *  1. o teto de 3 (fora confirmações), que é a diferença entre copiloto e lista;
 *  2. o silêncio quando não há o que dizer — copiloto que fala sempre não é lido;
 *  3. a consequência escrita no aviso do chip caído, que é o motivo de ele existir.
 */

const inbox = {
  naoLidas: 0,
  maisVelhaHoras: 0,
  responderam: 0,
  segundoToque: null as number | null,
  enviadasHoje: 0,
  enviadasOntem: 0,
};

const numero = (over: Partial<NumeroDeWhatsApp> = {}): NumeroDeWhatsApp => ({
  rotulo: "Comercial",
  status: "WORKING",
  aiMode: "copiloto",
  aquecido: true,
  ehChipDoGrupo: false,
  ...over,
});

describe("ordenar", () => {
  it("corta em 3 e deixa as confirmações passarem por fora do teto", () => {
    const bruto: Aviso[] = [
      { id: "a", peso: "nota", etiqueta: "", titulo: "", texto: "" },
      { id: "b", peso: "agir", etiqueta: "", titulo: "", texto: "" },
      { id: "c", peso: "atencao", etiqueta: "", titulo: "", texto: "" },
      { id: "d", peso: "atencao", etiqueta: "", titulo: "", texto: "" },
      { id: "e", peso: "ok", etiqueta: "", titulo: "", texto: "" },
    ];
    const r = ordenar(bruto);
    expect(r.filter((a) => a.peso !== "ok")).toHaveLength(TETO_DE_AVISOS);
    expect(r[0]!.id).toBe("b"); // agir vem primeiro
    expect(r.map((a) => a.id)).toContain("e"); // a confirmação sobrevive ao corte
    expect(r.map((a) => a.id)).not.toContain("a"); // a nota foi cortada
  });
});

describe("janelaDeAbordagem", () => {
  it("segunda a quarta é janela boa", () => {
    // 2026-09-07 é uma segunda-feira.
    expect(janelaDeAbordagem(new Date("2026-09-07T09:00:00")).boa).toBe(true);
    expect(janelaDeAbordagem(new Date("2026-09-09T09:00:00")).boa).toBe(true);
  });
  it("de quinta a domingo não é", () => {
    expect(janelaDeAbordagem(new Date("2026-09-10T09:00:00")).boa).toBe(false);
    expect(janelaDeAbordagem(new Date("2026-09-12T09:00:00")).boa).toBe(false);
    expect(janelaDeAbordagem(new Date("2026-09-13T09:00:00")).boa).toBe(false);
  });
});

describe("inbox", () => {
  it("respondeu sem segundo toque é o aviso de agir", () => {
    const r = avisosDoInbox({ ...inbox, responderam: 4, segundoToque: 0 });
    expect(r[0]!.id).toBe("inbox.segundo-toque-parado");
    expect(r[0]!.peso).toBe("agir");
    expect(r[0]!.texto).toContain("4"); // o número que gerou o aviso vai no texto
  });

  it("não acusa gargalo quando a etapa do segundo toque nem existe", () => {
    const r = avisosDoInbox({ ...inbox, responderam: 4, segundoToque: null });
    expect(r.map((a) => a.id)).not.toContain("inbox.segundo-toque-parado");
  });

  it("não acusa gargalo quando o segundo toque já saiu", () => {
    const r = avisosDoInbox({ ...inbox, responderam: 4, segundoToque: 2 });
    expect(r.map((a) => a.id)).not.toContain("inbox.segundo-toque-parado");
  });

  it("espera de menos de 7 dias não vira aviso", () => {
    expect(avisosDoInbox({ ...inbox, naoLidas: 3, maisVelhaHoras: 100 })).toHaveLength(0);
  });

  it("espera longa conta os dias", () => {
    const r = avisosDoInbox({ ...inbox, naoLidas: 56, maisVelhaHoras: 771 });
    expect(r[0]!.titulo).toContain("32 dias");
  });

  it("silêncio de hoje só aparece se ontem teve movimento", () => {
    expect(avisosDoInbox({ ...inbox, naoLidas: 1, enviadasHoje: 0, enviadasOntem: 0 })).toHaveLength(0);
    const r = avisosDoInbox({ ...inbox, naoLidas: 1, enviadasHoje: 0, enviadasOntem: 26 });
    expect(r.map((a) => a.id)).toContain("inbox.silencio-hoje");
  });

  it("fila limpa vira confirmação, não silêncio", () => {
    const r = avisosDoInbox(inbox);
    expect(r).toHaveLength(1);
    expect(r[0]!.peso).toBe("ok");
  });
});

describe("kanban", () => {
  const agora = new Date("2026-09-07T09:00:00"); // segunda
  const etapas = [
    { nome: "Investigacao", leads: 21, parados: 0 },
    { nome: "A contatar", leads: 34, parados: 0 },
    { nome: "Contatado", leads: 36, parados: 0 },
    { nome: "Respondeu", leads: 4, parados: 0 },
    { nome: "Vídeo enviado", leads: 0, parados: 0 },
  ];

  it("a etapa vazia depois de uma cheia é o gargalo", () => {
    const r = avisosDoKanban({ funil: "Buffets", etapas, agora });
    expect(r[0]!.id).toBe("kanban.gargalo-segundo-toque");
    expect(r[0]!.titulo).toContain("Vídeo enviado");
  });

  it("fora da janela, a fila de primeiro toque desce para nota e perde o botão", () => {
    const sabado = new Date("2026-09-12T09:00:00");
    const r = avisosDoKanban({ funil: "Buffets", etapas, agora: sabado });
    const fila = r.find((a) => a.id === "kanban.fila-sem-primeiro-toque")!;
    expect(fila.peso).toBe("nota");
    expect(fila.acao).toBeUndefined();
    expect(fila.texto).toContain("operando festa");
  });

  it("'A contatar' parado não vira aviso de etapa travada — já tem o dele", () => {
    const r = avisosDoKanban({
      funil: "Buffets",
      etapas: [{ nome: "A contatar", leads: 34, parados: 30 }],
      agora,
    });
    expect(r.map((a) => a.id)).not.toContain("kanban.etapa-travada");
  });

  it("funil sem etapa nenhuma não inventa aviso", () => {
    expect(avisosDoKanban({ funil: "", etapas: [], agora })).toHaveLength(0);
  });
});

describe("conexões", () => {
  it("o chip do grupo caído vira a consequência, não o status", () => {
    const r = avisosDasConexoes({
      numeros: [numero(), numero({ rotulo: "(77) 8141-2789", status: "FAILED", ehChipDoGrupo: true })],
    });
    expect(r[0]!.id).toBe("conexoes.chip-do-grupo-caiu");
    expect(r[0]!.titulo).toContain("grupo");
  });

  it("número comum caído é aviso genérico", () => {
    const r = avisosDasConexoes({ numeros: [numero({ status: "FAILED" })] });
    expect(r[0]!.id).toBe("conexoes.numero-caiu");
  });

  it("número caído não é cobrado também por aquecimento", () => {
    const r = avisosDasConexoes({ numeros: [numero({ status: "FAILED", aquecido: false })] });
    expect(r.map((a) => a.id)).not.toContain("conexoes.aquecimento");
  });

  it("IA solta em algum número é atenção; todos em copiloto é confirmação", () => {
    const solto = avisosDasConexoes({ numeros: [numero({ aiMode: "atendente" })] });
    expect(solto.map((a) => a.id)).toContain("conexoes.ia-respondendo");
    expect(solto.map((a) => a.id)).not.toContain("conexoes.tudo-copiloto");

    const calado = avisosDasConexoes({ numeros: [numero(), numero()] });
    expect(calado.map((a) => a.id)).toContain("conexoes.tudo-copiloto");
  });

  it("org sem número nenhum não recebe nem confirmação", () => {
    expect(avisosDasConexoes({ numeros: [] })).toHaveLength(0);
  });
});

describe("tarefas", () => {
  it("tudo vencido é um sinal diferente de algumas vencidas", () => {
    const morta = avisosDasTarefas({ pendentes: 45, vencidas: 45, maisVelhaDias: 18 });
    expect(morta[0]!.id).toBe("tarefas.lista-morta");
    expect(morta[0]!.texto).toContain("18 dias");

    const parcial = avisosDasTarefas({ pendentes: 45, vencidas: 9, maisVelhaDias: 2 });
    expect(parcial[0]!.id).toBe("tarefas.vencidas");
  });

  it("lista curta toda vencida ainda é só 'vencidas' — 3 tarefas não é lista morta", () => {
    const r = avisosDasTarefas({ pendentes: 3, vencidas: 3, maisVelhaDias: 1 });
    expect(r[0]!.id).toBe("tarefas.vencidas");
  });

  it("nada aberto vira confirmação", () => {
    const r = avisosDasTarefas({ pendentes: 0, vencidas: 0, maisVelhaDias: null });
    expect(r).toHaveLength(1);
    expect(r[0]!.peso).toBe("ok");
  });
});
