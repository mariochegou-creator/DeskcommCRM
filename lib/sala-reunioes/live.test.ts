/**
 * O motor do copiloto de reuniões — os mesmos invariantes do copiloto da
 * ligação, agora por tipo de reunião: a fase é DEDUZIDA do checklist (nunca
 * perguntada ao modelo), o merge do checklist é só-liga (`true` vence, chave
 * estranha é descartada), e o contrato de saída recusa o que a tela não
 * conseguiria mostrar.
 */
import { describe, expect, it } from "vitest";

import {
  faseDaCobertura,
  MAX_CHARS_SUGESTAO_CURTA,
  mesclarCobertura,
  parseLiveMeetingState,
  parseLiveSuggestion,
} from "@/lib/sala-reunioes/live-schema";

describe("faseDaCobertura — R1 (SPIN)", () => {
  it("reunião nova começa na situação (abertura não tem portão)", () => {
    expect(faseDaCobertura("r1", undefined)).toBe("situacao");
    expect(faseDaCobertura("r1", {})).toBe("situacao");
  });

  it("anda pelo roteiro conforme os portões marcam", () => {
    const c: Record<string, boolean> = { numero_coletado: true };
    expect(faseDaCobertura("r1", c)).toBe("situacao"); // falta a meta
    c.meta_declarada = true;
    expect(faseDaCobertura("r1", c)).toBe("problema");
    c.problema_comparativo = true;
    expect(faseDaCobertura("r1", c)).toBe("implicacao");
    c.ticket_medio = true;
    c.tempo_do_problema = true;
    c.implicacao_em_reais = true;
    expect(faseDaCobertura("r1", c)).toBe("necessidade");
    c.contraste_cenarios = true;
    expect(faseDaCobertura("r1", c)).toBe("fechamento");
    c.proximo_passo_datado = true;
    expect(faseDaCobertura("r1", c)).toBe("fechamento");
  });

  it("é 'depois do último marcado' — portão pulado não congela a reunião", () => {
    // A conversa foi direto pra dor e a conta fechou sem a meta declarada:
    // a fase segue adiante em vez de prender em "situacao" para sempre.
    expect(faseDaCobertura("r1", { implicacao_em_reais: true })).toBe("necessidade");
  });
});

describe("faseDaCobertura — R2 (Pits)", () => {
  it("reunião nova começa no diagnóstico", () => {
    expect(faseDaCobertura("r2", {})).toBe("diagnostico");
  });

  it("cada Pit só vem depois do anterior completado", () => {
    const c: Record<string, boolean> = { dores_reconfirmadas: true };
    expect(faseDaCobertura("r2", c)).toBe("objecoes");
    c.pagamento_sondado = true;
    c.decisor_sondado = true;
    c.urgencia_sondada = true;
    expect(faseDaCobertura("r2", c)).toBe("pit1");
    c.pit1_nota = true;
    expect(faseDaCobertura("r2", c)).toBe("pit1"); // nota sem o porquê = Pit 1 incompleto
    c.pit1_porque = true;
    expect(faseDaCobertura("r2", c)).toBe("extracao");
    c.investimento_extraido = true;
    expect(faseDaCobertura("r2", c)).toBe("pit2");
    c.pit2_amarrado = true;
    expect(faseDaCobertura("r2", c)).toBe("fechamento");
  });
});

describe("mesclarCobertura", () => {
  it("true vence sempre — o checklist nunca desmarca", () => {
    const saida = mesclarCobertura("r1", { numero_coletado: true }, { numero_coletado: false });
    expect(saida.numero_coletado).toBe(true);
  });

  it("chave que não pertence ao roteiro do tipo é descartada", () => {
    const saida = mesclarCobertura("r1", undefined, {
      meta_declarada: true,
      pit1_nota: true, // chave da R2
      inventada: true,
    });
    expect(saida.meta_declarada).toBe(true);
    expect("pit1_nota" in saida).toBe(false);
    expect("inventada" in saida).toBe(false);
  });

  it("como a fase sai do merge, ela nunca anda para trás", () => {
    const antes: Record<string, boolean> = {
      numero_coletado: true,
      meta_declarada: true,
      problema_comparativo: true,
    };
    // O modelo alucina um checklist zerado: o merge preserva o que já marcou.
    const depois = mesclarCobertura("r1", antes, {
      numero_coletado: false,
      meta_declarada: false,
      problema_comparativo: false,
    });
    expect(faseDaCobertura("r1", depois)).toBe("implicacao");
  });
});

describe("parseLiveSuggestion", () => {
  it("aceita o JSON mínimo e aplica os defaults", () => {
    const s = parseLiveSuggestion('{"sugestao": "Com 15 fechando, chega nos 25?"}');
    expect(s).not.toBeNull();
    expect(s!.tipo).toBe("falar");
    expect(s!.alerta).toBeNull();
    expect(s!.objecao).toBeNull();
    expect(s!.cobertura).toEqual({});
  });

  it("tolera cerca de código e ignora 'fase' (a fase é calculada, não ouvida)", () => {
    const s = parseLiveSuggestion(
      '```json\n{"sugestao": "Silêncio. Deixe ele responder.", "tipo": "calar", "fase": "abertura"}\n```',
    );
    expect(s).not.toBeNull();
    expect(s!.tipo).toBe("calar");
    expect("fase" in (s as Record<string, unknown>)).toBe(false);
  });

  it("recusa sugestão longa sem objeção — não seria lida", () => {
    const longa = "a".repeat(MAX_CHARS_SUGESTAO_CURTA + 1);
    expect(parseLiveSuggestion(`{"sugestao": "${longa}"}`)).toBeNull();
  });

  it("aceita o script inteiro quando é resposta de objeção da R2", () => {
    const script =
      "Entendo. Por isso o começo é enxuto — e o problema hoje já tá te custando mais que isso parado, você mesmo fez essa conta comigo. Dá pra começar pequeno e crescer quando der resultado.";
    const s = parseLiveSuggestion(JSON.stringify({ sugestao: script, objecao: "ta_caro" }));
    expect(s).not.toBeNull();
    expect(s!.objecao).toBe("ta_caro");
  });

  it("recusa objeção fora do vocabulário", () => {
    expect(
      parseLiveSuggestion('{"sugestao": "Topa começar?", "objecao": "manda_whatsapp"}'),
    ).toBeNull();
  });

  it("extrai números sem calcular (quem calcula é a conta-da-dor)", () => {
    const s = parseLiveSuggestion(
      '{"sugestao": "Quanto vale cada um pra vocês?", "numeros": {"quantidade": 10, "periodo": "dia", "valor_unitario": null}}',
    );
    expect(s).not.toBeNull();
    expect(s!.numeros).toEqual({ quantidade: 10, periodo: "dia", valor_unitario: null });
  });
});

describe("parseLiveMeetingState", () => {
  it("estado sujo (formato antigo ou lixo) vira estado vazio, sem quebrar", () => {
    expect(parseLiveMeetingState("lixo")).toEqual({});
    expect(parseLiveMeetingState(null)).toEqual({});
    // O formato antigo guardava cobertura com valores não-booleanos.
    expect(parseLiveMeetingState({ fase: "pit1", cobertura: { x: "sim" } })).toEqual({});
  });

  it("preserva a memória que sobrevive à janela: eixo, números, esquivas", () => {
    const estado = parseLiveMeetingState({
      fase: "implicacao",
      eixo: "espera",
      numeros: { quantidade: 2, periodo: "semana", valor_unitario: 800 },
      desviou_do_numero: 1,
      contexto: "Padaria do João — gancho: demora no WhatsApp",
    });
    expect(estado.eixo).toBe("espera");
    expect(estado.numeros?.valor_unitario).toBe(800);
    expect(estado.desviou_do_numero).toBe(1);
  });
});
