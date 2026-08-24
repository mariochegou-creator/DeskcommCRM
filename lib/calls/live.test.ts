import { describe, expect, it } from "vitest";

import {
  JANELA_MAX_CHARS,
  liveCallSystemPrompt,
  liveCallUserPrompt,
  recortarJanela,
} from "@/lib/calls/live-prompt";
import {
  COBERTURA_LABELS,
  COBERTURA_VAZIA,
  DEGRAUS_DA_DOR,
  parseLiveCallSuggestion,
  parseLiveState,
} from "@/lib/calls/live-schema";

const SUGESTAO_VALIDA = {
  fase: "decisor",
  sugestao: "Quando envolve dinheiro, decide só você?",
  alerta: null,
  cobertura: { dor_declarada: true },
};

describe("parseLiveCallSuggestion", () => {
  it("aceita o JSON puro", () => {
    const r = parseLiveCallSuggestion(JSON.stringify(SUGESTAO_VALIDA));
    expect(r?.fase).toBe("decisor");
    expect(r?.sugestao).toContain("decide");
  });

  it("aceita JSON dentro de cerca de código", () => {
    const texto = "```json\n" + JSON.stringify(SUGESTAO_VALIDA) + "\n```";
    expect(parseLiveCallSuggestion(texto)?.fase).toBe("decisor");
  });

  it("completa a cobertura com os itens que faltaram", () => {
    // O modelo manda só o que mudou; a tela desenha os seis. Sem o default, uma
    // caixinha ausente viraria `undefined` e o item sumiria do checklist no meio
    // da ligação.
    const r = parseLiveCallSuggestion(JSON.stringify(SUGESTAO_VALIDA));
    expect(Object.keys(r?.cobertura ?? {}).sort()).toEqual(Object.keys(COBERTURA_VAZIA).sort());
    expect(r?.cobertura.dor_declarada).toBe(true);
    expect(r?.cobertura.decisor_identificado).toBe(false);
  });

  it("recusa fase fora do vocabulário", () => {
    const r = parseLiveCallSuggestion(JSON.stringify({ ...SUGESTAO_VALIDA, fase: "implicacao" }));
    expect(r).toBeNull();
  });

  it("recusa sugestão comprida — o teto é a guarda dura do prompt", () => {
    // O prompt PEDE 5-12 palavras; só o schema RECUSA. Sem isto, um parágrafo
    // chegaria à tela no meio de uma ligação, que é o defeito que o popup existe
    // para não ter.
    const r = parseLiveCallSuggestion(
      JSON.stringify({ ...SUGESTAO_VALIDA, sugestao: "palavra ".repeat(40) }),
    );
    expect(r).toBeNull();
  });

  it("devolve null para texto que não é JSON", () => {
    expect(parseLiveCallSuggestion("desculpe, não consegui analisar")).toBeNull();
  });
});

describe("parseLiveState", () => {
  it("tolera lixo e devolve estado vazio", () => {
    expect(parseLiveState("não é objeto")).toEqual({});
    expect(parseLiveState(null)).toEqual({});
  });

  it("preserva a contagem de blocos — é o que diz se a transcrição cobriu tudo", () => {
    expect(parseLiveState({ chunks: 12 }).chunks).toBe(12);
  });
});

describe("recortarJanela", () => {
  it("não mexe no que já cabe", () => {
    expect(recortarJanela("bom dia")).toBe("bom dia");
  });

  it("corta pelo fim e começa em fronteira de palavra", () => {
    const longo = "palavra ".repeat(1000);
    const r = recortarJanela(longo);
    expect(r.length).toBeLessThanOrEqual(JANELA_MAX_CHARS);
    expect(r.startsWith("palavra")).toBe(true);
  });
});

describe("o prompt do copiloto", () => {
  it("cita TODOS os itens do checklist", () => {
    // A trava contra o defeito silencioso: item novo no schema sem menção no
    // prompt nunca é marcado, fica eternamente apagado na tela, e o SDR aprende
    // a ignorar o checklist inteiro.
    const sistema = liveCallSystemPrompt();
    for (const chave of Object.keys(COBERTURA_LABELS)) {
      expect(sistema).toContain(chave);
    }
  });

  it("proíbe falar de preço na ligação", () => {
    expect(liveCallSystemPrompt()).toContain("preço");
  });

  it("a mensagem carrega estado, relógio e o trecho novo", () => {
    const u = liveCallUserPrompt({
      janela: "bom dia, aqui é da Nexo",
      ultimoTrecho: "quem decide com você?",
      estado: { fase: "dor" },
      segundos: 125,
      contexto: "Padaria Sintética — sem site",
    });
    expect(u).toContain("2:05");
    expect(u).toContain("quem decide com você?");
    expect(u).toContain("Padaria Sintética");
    expect(u).toContain('"fase":"dor"');
  });

  it("sem contexto do lead, não inventa seção vazia", () => {
    const u = liveCallUserPrompt({
      janela: "oi",
      ultimoTrecho: "oi",
      estado: {},
      segundos: 0,
      contexto: null,
    });
    expect(u).not.toContain("SOBRE O LEAD");
  });
});

describe("os degraus da dor", () => {
  it("aceita o degrau e devolve null quando o modelo não mandou", () => {
    const com = parseLiveCallSuggestion(JSON.stringify({ ...SUGESTAO_VALIDA, degrau: "prejuizo" }));
    expect(com?.degrau).toBe("prejuizo");
    // Fora da fase "dor" o campo não vem — e `undefined` na tela desenharia um
    // rótulo vazio em cima da sugestão, que é o elemento mais lido do popup.
    expect(parseLiveCallSuggestion(JSON.stringify(SUGESTAO_VALIDA))?.degrau).toBeNull();
  });

  it("recusa degrau fora do vocabulário", () => {
    const r = parseLiveCallSuggestion(JSON.stringify({ ...SUGESTAO_VALIDA, degrau: "implicacao" }));
    expect(r).toBeNull();
  });

  it("o prompt ensina os três degraus, na ordem", () => {
    // A mesma trava do checklist: degrau que existe no schema e não existe no
    // prompt nunca é preenchido, e o rótulo some da tela sem ninguém notar.
    const sistema = liveCallSystemPrompt();
    for (const degrau of DEGRAUS_DA_DOR) expect(sistema).toContain(degrau);
    expect(sistema.indexOf("aprofundar")).toBeLessThan(sistema.indexOf("prejuizo"));
    expect(sistema.indexOf("prejuizo")).toBeLessThan(sistema.indexOf("ponte"));
  });

  it("manda o LEAD dizer o número, e não o SDR", () => {
    // O degrau só vale se o dono quantifica. Número dito pelo SDR não convence
    // ninguém na R1 — foi o dono que precisa ter ouvido a própria conta.
    expect(liveCallSystemPrompt()).toContain("O DONO botar tamanho");
  });
});
