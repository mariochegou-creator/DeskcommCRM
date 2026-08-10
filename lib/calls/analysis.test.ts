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
