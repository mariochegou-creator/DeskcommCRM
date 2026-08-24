import { describe, expect, it, vi } from "vitest";

// O worker importa @/lib/supabase/admin, que puxa `server-only` e mata o
// vitest. Mesmo contorno do lib/waha/lid-alt.test.ts — aqui só se usa o
// parseAnalysis, que é função pura; o client admin nunca é tocado.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  buildCallAnalysisPrompt,
  PLACEHOLDER_TRANSCRICAO,
  rawCallAnalysisPrompt,
} from "@/lib/calls/analysis-prompt";
import { CALL_OUTCOMES, CallAnalysisSchema } from "@/lib/calls/analysis-schema";
import { parseAnalysis } from "@/workers/call-analysis-worker";

const ANALISE_VALIDA = {
  resultado: "agendou",
  nota_geral: 7.5,
  criterios: [
    { criterio: "Abertura", nota: 8, comentario: "Quebrou o padrão de telemarketing." },
    { criterio: "Fechamento", nota: 7, comentario: "Propôs dois horários." },
  ],
  acertos: ["Ganhou permissão para continuar."],
  pontos_de_melhoria: ["Fazer o lead verbalizar a dor antes de propor a reunião."],
  frase_para_treinar: "O que hoje mais te atrapalha no atendimento pelo WhatsApp?",
};

describe("prompt de análise", () => {
  /**
   * O prompt É a rubrica de coaching, não implementação. Se o marcador sumir
   * numa edição, a transcrição não entra e o modelo avalia uma ligação que não
   * existe — devolvendo notas plausíveis sobre nada. É a falha mais cara
   * possível aqui, porque ela não parece uma falha.
   */
  it("mantém o marcador da transcrição", () => {
    expect(rawCallAnalysisPrompt()).toContain(PLACEHOLDER_TRANSCRICAO);
  });

  it("substitui o marcador pela transcrição", () => {
    const p = buildCallAnalysisPrompt("SDR: bom dia. LEAD: bom dia.");
    expect(p).toContain("SDR: bom dia. LEAD: bom dia.");
    expect(p).not.toContain(PLACEHOLDER_TRANSCRICAO);
  });

  it("não interpreta $& e $1 da transcrição como referência de captura", () => {
    // `String.replace` faria "$&" virar o texto casado. Numa transcrição isso é
    // corrupção silenciosa do que o modelo vai ler.
    const p = buildCallAnalysisPrompt("o cliente disse $& e depois $1");
    expect(p).toContain("o cliente disse $& e depois $1");
  });

  it("descreve os quatro resultados que o banco aceita", () => {
    const prompt = rawCallAnalysisPrompt();
    for (const r of CALL_OUTCOMES) {
      expect(prompt).toContain(r);
    }
  });
});

describe("parseAnalysis", () => {
  it("aceita JSON puro", () => {
    expect(parseAnalysis(JSON.stringify(ANALISE_VALIDA))?.nota_geral).toBe(7.5);
  });

  it("tolera cerca de código, que é o desvio mais comum", () => {
    const texto = "```json\n" + JSON.stringify(ANALISE_VALIDA) + "\n```";
    expect(parseAnalysis(texto)?.resultado).toBe("agendou");
  });

  it("tolera prosa antes e depois do objeto", () => {
    const texto = `Segue a análise:\n${JSON.stringify(ANALISE_VALIDA)}\nEspero ter ajudado.`;
    expect(parseAnalysis(texto)?.resultado).toBe("agendou");
  });

  it("RECUSA nota fora da faixa em vez de gravar", () => {
    // Uma nota 12 viraria coluna, chip e média semanal. Melhor cair no caminho
    // `done_unformatted`, onde a pessoa lê o texto, do que envenenar o número.
    const texto = JSON.stringify({ ...ANALISE_VALIDA, nota_geral: 12 });
    expect(parseAnalysis(texto)).toBeNull();
  });

  it("RECUSA resultado fora do vocabulário do banco", () => {
    // Sem isto o INSERT bateria no CHECK da 0100 e a análise inteira se perderia
    // num erro de constraint, longe da causa.
    const texto = JSON.stringify({ ...ANALISE_VALIDA, resultado: "quase_agendou" });
    expect(parseAnalysis(texto)).toBeNull();
  });

  it("RECUSA análise vazia com forma de JSON", () => {
    const texto = JSON.stringify({ ...ANALISE_VALIDA, acertos: [], pontos_de_melhoria: [] });
    expect(parseAnalysis(texto)).toBeNull();
  });

  it("devolve null em texto que não tem objeto nenhum", () => {
    expect(parseAnalysis("Não consegui analisar esta ligação.")).toBeNull();
    expect(parseAnalysis("")).toBeNull();
  });
});

describe("CallAnalysisSchema", () => {
  it("aceita nota inteira e fracionada", () => {
    expect(CallAnalysisSchema.safeParse({ ...ANALISE_VALIDA, nota_geral: 10 }).success).toBe(true);
    expect(CallAnalysisSchema.safeParse({ ...ANALISE_VALIDA, nota_geral: 0 }).success).toBe(true);
  });
});

describe("o prompt da análise com o material do copiloto (0106)", () => {
  it("inclui a anotação do SDR", () => {
    const p = buildCallAnalysisPrompt("SDR: bom dia.", {
      notas: "ele pediu pra ligar depois das 18h",
    });
    expect(p).toContain("ANOTAÇÃO DO SDR");
    expect(p).toContain("depois das 18h");
  });

  it("lista o que o roteiro não cobriu, em português", () => {
    const p = buildCallAnalysisPrompt("SDR: bom dia.", {
      cobertura: {
        abriu_sem_pergunta: true,
        entendeu_o_negocio: true,
        dor_declarada: true,
        decisor_identificado: false,
        reuniao_proposta: false,
        dia_e_hora_confirmados: false,
      },
    });
    expect(p).toContain("quem decide");
    expect(p).not.toContain("decisor_identificado");
  });

  it("não cita o checklist quando tudo foi coberto", () => {
    const p = buildCallAnalysisPrompt("SDR: bom dia.", {
      cobertura: {
        abriu_sem_pergunta: true,
        permissao_pedida: true,
        pergunta_feita: true,
        espelho_feito: true,
        dor_aprofundada: true,
        numero_dele: true,
        ponte_feita: true,
        decisor_identificado: true,
        reuniao_proposta: true,
        dia_e_hora_confirmados: true,
      },
    });
    expect(p).not.toContain("ITENS DO ROTEIRO");
  });

  it("sem extras, o prompt é o de sempre — a rubrica não muda", () => {
    // A rubrica é de quem treina o time. Se esta asserção quebrar, alguém mexeu
    // na nota que o SDR recebe sem que ninguém visse acontecer.
    const antes = buildCallAnalysisPrompt("SDR: bom dia.");
    const depois = buildCallAnalysisPrompt("SDR: bom dia.", { notas: null, cobertura: null });
    expect(depois).toBe(antes);
    expect(antes.endsWith("SDR: bom dia.")).toBe(true);
  });

  it("pede a nota do negócio, e manda copiar as palavras do dono", () => {
    // É a única parte da análise que não fala do SDR — e a que alimenta o
    // preparo da R1 dias depois. Se ela sair do prompt, o campo vem sempre null
    // e a nota do negócio some sem ninguém notar: a análise continua saindo
    // inteira, só que muda.
    const p = buildCallAnalysisPrompt("SDR: bom dia.");
    expect(p).toContain("nota_do_negocio");
    expect(p).toContain("COM AS PALAVRAS DELE");
    expect(p).toContain("Copie, não interprete");
  });

  it("ligação sem dor pode devolver a nota nula — e o schema aceita", () => {
    // Forçar o campo faria o modelo inventar nota para caixa postal e número
    // errado, e essa invenção iria parar no dossiê do negócio.
    const base = {
      resultado: "nao_atendeu_ou_invalida",
      nota_geral: 0,
      criterios: [{ criterio: "Abertura", nota: 0, comentario: "caiu na caixa postal" }],
      acertos: ["discou o número certo"],
      pontos_de_melhoria: ["tentar em outro horário"],
      frase_para_treinar: "bom dia, falo com o dono?",
    };
    expect(CallAnalysisSchema.safeParse(base).success).toBe(true);
    expect(CallAnalysisSchema.parse(base).nota_do_negocio).toBeNull();

    const comNota = CallAnalysisSchema.parse({
      ...base,
      nota_do_negocio: { headline: "Dor de espera", corpo: "so no outro dia alguem ve" },
    });
    expect(comNota.nota_do_negocio?.corpo).toContain("outro dia");
  });

  it("ligação que não completou pode não ter acerto nenhum", () => {
    // O defeito real, visto em 24/08: caixa postal e numero bloqueado nao tem
    // acerto, o modelo devolvia `acertos: []` — e o schema recusava a analise
    // INTEIRA. O SDR via "a analise deu erro" numa ligacao em que o modelo tinha
    // acertado. Exigir um elogio so ensina o modelo a inventar elogio.
    const semAcerto = {
      resultado: "nao_atendeu_ou_invalida",
      nota_geral: 0,
      criterios: [{ criterio: "Abertura", nota: 0, comentario: "número bloqueado para chamadas" }],
      acertos: [],
      pontos_de_melhoria: ["testar o headset antes de discar"],
      frase_para_treinar: "bom dia, o senhor consegue me ouvir?",
    };
    expect(CallAnalysisSchema.safeParse(semAcerto).success).toBe(true);
  });

  it("mas resposta sem NENHUM apontamento continua recusada", () => {
    // É `pontos_de_melhoria` que separa "análise honesta de ligação vazia" de
    // "JSON vazio com forma de análise" — esse mínimo não pode cair junto.
    const vazia = {
      resultado: "nao_atendeu_ou_invalida",
      nota_geral: 0,
      criterios: [{ criterio: "Abertura", nota: 0, comentario: "nada aconteceu" }],
      acertos: [],
      pontos_de_melhoria: [],
      frase_para_treinar: "bom dia",
    };
    expect(CallAnalysisSchema.safeParse(vazia).success).toBe(false);
  });
});
