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
  degrauDaCobertura,
  faseDaCobertura,
  parseLiveCallSuggestion,
  parseLiveState,
} from "@/lib/calls/live-schema";

const SUGESTAO_VALIDA = {
  sugestao: "Quando envolve dinheiro, decide só você?",
  alerta: null,
  cobertura: { espelho_feito: true },
};

describe("parseLiveCallSuggestion", () => {
  it("aceita o JSON puro", () => {
    const r = parseLiveCallSuggestion(JSON.stringify(SUGESTAO_VALIDA));
    expect(r?.sugestao).toContain("decide");
    expect(r?.cobertura.espelho_feito).toBe(true);
  });

  it("aceita JSON dentro de cerca de código", () => {
    const texto = "```json\n" + JSON.stringify(SUGESTAO_VALIDA) + "\n```";
    expect(parseLiveCallSuggestion(texto)?.sugestao).toContain("decide");
  });

  it("completa a cobertura com os itens que faltaram", () => {
    // O modelo manda só o que mudou; a tela desenha os seis. Sem o default, uma
    // caixinha ausente viraria `undefined` e o item sumiria do checklist no meio
    // da ligação.
    const r = parseLiveCallSuggestion(JSON.stringify(SUGESTAO_VALIDA));
    expect(Object.keys(r?.cobertura ?? {}).sort()).toEqual(Object.keys(COBERTURA_VAZIA).sort());
    expect(r?.cobertura.espelho_feito).toBe(true);
    expect(r?.cobertura.decisor_identificado).toBe(false);
  });

  it("ignora a fase se o modelo insistir em mandar", () => {
    // A fase é calculada do checklist (`faseDaCobertura`) e não faz mais parte
    // do contrato de saída. Modelo teimoso não pode quebrar o bloco nem, muito
    // menos, colocar a tela numa etapa que as caixinhas desmentem.
    const r = parseLiveCallSuggestion(
      JSON.stringify({ ...SUGESTAO_VALIDA, fase: "implicacao", degrau: "implicacao" }),
    );
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty("fase");
    expect(r).not.toHaveProperty("degrau");
  });

  it("recusa sugestão comprida — o teto é a guarda dura do prompt", () => {
    // O prompt PEDE 5-12 palavras; só o schema RECUSA. Sem isto, um parágrafo
    // chegaria à tela no meio de uma ligação, que é o defeito que o popup existe
    // para não ter.
    const r = parseLiveCallSuggestion(
      JSON.stringify({ ...SUGESTAO_VALIDA, sugestao: "palavra ".repeat(30) }),
    );
    expect(r).toBeNull();
  });

  it("mas ACEITA o script inteiro quando é resposta de objeção", () => {
    // As respostas da aula 08 são longas de propósito — encurtá-las destrói o
    // que as faz funcionar. O teto passou a depender do que a sugestão É:
    // objeção pode ser longa, o resto continua preso aos 120 caracteres.
    const script =
      "Mando sim, e já te mando agora. Só que o que eu tenho pra te mostrar é tela, " +
      "não texto — no WhatsApp vira aquela mensagem comprida que o senhor não vai ler " +
      "no meio do expediente. São 30 minutos. Quinta de manhã ou sexta à tarde?";
    const r = parseLiveCallSuggestion(
      JSON.stringify({ ...SUGESTAO_VALIDA, sugestao: script, objecao: "manda_whatsapp" }),
    );
    expect(r?.objecao).toBe("manda_whatsapp");
    expect(r?.sugestao).toContain("Quinta de manhã ou sexta à tarde?");
  });

  it("o silêncio é uma sugestão de primeira classe", () => {
    // "Fez a pergunta? Cale a boca" é regra do caderno. Um copiloto que só sabe
    // sugerir frases empurra o SDR a falar na hora em que esperar é o trabalho.
    const r = parseLiveCallSuggestion(
      JSON.stringify({ sugestao: "Silêncio. Deixe ele responder.", tipo: "calar" }),
    );
    expect(r?.tipo).toBe("calar");
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

  it("a mensagem carrega a etapa calculada, o relógio e o trecho novo", () => {
    const u = liveCallUserPrompt({
      janela: "bom dia, aqui é da Nexo",
      ultimoTrecho: "quem decide com você?",
      estado: { cobertura: { espelho_feito: true } },
      segundos: 125,
      contexto: "Padaria Sintética — sem site",
      fase: "dor",
      degrau: "numero",
    });
    expect(u).toContain("2:05");
    expect(u).toContain("quem decide com você?");
    expect(u).toContain("Padaria Sintética");
    // A etapa é ENTREGUE ao modelo, não perguntada — é a linha que sustenta a
    // fase calculada. Sem ela o modelo volta a adivinhar em que ponto está.
    expect(u).toContain('fase "dor", degrau "numero"');
  });

  it("fora da dor, a etapa vai sem degrau", () => {
    const u = liveCallUserPrompt({
      janela: "oi",
      ultimoTrecho: "quem decide aí?",
      estado: {},
      segundos: 10,
      contexto: null,
      fase: "decisor",
      degrau: null,
    });
    expect(u).toContain('fase "decisor"');
    expect(u).not.toContain("degrau");
  });

  it("não pede mais a fase na resposta", () => {
    const sistema = liveCallSystemPrompt();
    expect(sistema).toContain('NÃO mande "fase" nem "degrau"');
  });

  it("sem contexto do lead, não inventa seção vazia", () => {
    const u = liveCallUserPrompt({
      janela: "oi",
      ultimoTrecho: "oi",
      estado: {},
      segundos: 0,
      contexto: null,
      fase: "abertura",
      degrau: null,
    });
    expect(u).not.toContain("SOBRE O LEAD");
  });
});

describe("a fase calculada do checklist", () => {
  it("começa na abertura e anda um portão por item marcado", () => {
    expect(faseDaCobertura(undefined)).toBe("abertura");
    expect(faseDaCobertura({})).toBe("abertura");
    expect(faseDaCobertura({ abriu_sem_pergunta: true })).toBe("abertura");
    expect(faseDaCobertura({ abriu_sem_pergunta: true, permissao_pedida: true })).toBe("pergunta");
    expect(
      faseDaCobertura({ abriu_sem_pergunta: true, permissao_pedida: true, pergunta_feita: true }),
    ).toBe("dor");
  });

  it("só sai da dor depois da ponte, não depois do número", () => {
    // Era aqui que o copiloto antigo pulava: com o prejuízo dimensionado ele
    // ia direto ao decisor, e o dono aceitava a reunião sem saber para quê.
    const ate = {
      abriu_sem_pergunta: true,
      permissao_pedida: true,
      pergunta_feita: true,
      espelho_feito: true,
      dor_aprofundada: true,
      numero_dele: true,
    };
    expect(faseDaCobertura(ate)).toBe("dor");
    expect(faseDaCobertura({ ...ate, ponte_feita: true })).toBe("decisor");
  });

  it("chega ao encerramento com tudo marcado", () => {
    const tudo = Object.fromEntries(Object.keys(COBERTURA_VAZIA).map((k) => [k, true]));
    expect(faseDaCobertura(tudo)).toBe("encerramento");
  });

  it("NÃO congela quando uma etapa é pulada", () => {
    // O caso real: na ligação fria a pergunta vai direto na dor e
    // "entendeu_o_negocio" nunca marca. Com "primeiro item não marcado" o
    // copiloto sugeriria perguntas de situação até o SDR desligar.
    expect(faseDaCobertura({ abriu_sem_pergunta: true, espelho_feito: true })).toBe("dor");
    expect(faseDaCobertura({ decisor_identificado: true })).toBe("agendamento");
  });

  it("a fase nunca discorda do checklist", () => {
    // A contradição que existia: fase "agendamento" com a dor por declarar.
    // Agora é impossível de construir — a fase É o checklist.
    expect(faseDaCobertura({ reuniao_proposta: true }).length).toBeGreaterThan(0);
    expect(faseDaCobertura({ espelho_feito: false })).toBe("abertura");
  });
});

describe("os degraus da dor", () => {
  it("o degrau acompanha o checklist e some fora da dor", () => {
    expect(degrauDaCobertura({})).toBeNull();
    const naDor = { abriu_sem_pergunta: true, permissao_pedida: true, pergunta_feita: true };
    expect(degrauDaCobertura(naDor)).toBe("espelho");
    expect(degrauDaCobertura({ ...naDor, espelho_feito: true })).toBe("aprofunda");
    expect(degrauDaCobertura({ ...naDor, espelho_feito: true, dor_aprofundada: true })).toBe(
      "numero",
    );
    expect(
      degrauDaCobertura({
        ...naDor,
        espelho_feito: true,
        dor_aprofundada: true,
        numero_dele: true,
      }),
    ).toBe("ponte");
    expect(
      degrauDaCobertura({
        ...naDor,
        espelho_feito: true,
        dor_aprofundada: true,
        numero_dele: true,
        ponte_feita: true,
      }),
    ).toBeNull();
  });

  it("o prompt ensina os três degraus, na ordem", () => {
    // A mesma trava do checklist: degrau que existe no schema e não existe no
    // prompt nunca é preenchido, e o rótulo some da tela sem ninguém notar.
    const sistema = liveCallSystemPrompt();
    for (const degrau of DEGRAUS_DA_DOR) expect(sistema).toContain(degrau);
    expect(sistema.indexOf('"espelho"')).toBeLessThan(sistema.indexOf('"aprofunda"'));
    expect(sistema.indexOf('"aprofunda"')).toBeLessThan(sistema.indexOf('"numero"'));
    expect(sistema.indexOf('"numero"')).toBeLessThan(sistema.indexOf('"ponte"'));
  });

  it("manda o LEAD dizer o número, e não o SDR", () => {
    // O degrau só vale se o dono quantifica. Número dito pelo SDR não convence
    // ninguém na R1 — foi o dono que precisa ter ouvido a própria conta.
    expect(liveCallSystemPrompt()).toContain("faça o DONO botar quantidade");
  });
});
