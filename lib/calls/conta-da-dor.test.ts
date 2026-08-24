import { describe, expect, it } from "vitest";

import { fecharAConta } from "@/lib/calls/conta-da-dor";
import { EIXOS, PALAVRAS_PROIBIDAS, rotuloDoEixo } from "@/lib/calls/palavras-eixo";
import { liveCallSystemPrompt, liveCallUserPrompt } from "@/lib/calls/live-prompt";

describe("fecharAConta", () => {
  it("faz a conta do caderno, com as palavras do caderno", () => {
    // O exemplo literal da aula 05: "duas por semana, oito no mês, R$ 800 cada
    // — isso dá R$ 6.400 por mês". A frase é o produto; se ela mudar de forma,
    // o SDR lê outra coisa em voz alta na frente do dono.
    const c = fecharAConta({ quantidade: 2, periodo: "semana", valorUnitario: 800 });
    expect(c?.porMes).toBe(8);
    expect(c?.reaisPorMes).toBe(6_400);
    expect(c?.frase).toContain("duas por semana");
    expect(c?.frase).toContain("8 no mês");
    expect(c?.frase).toContain("R$ 6.400");
  });

  it("termina sempre em pergunta — quem fecha a conta é o dono", () => {
    // Número que sai da boca dele vira valor; número que sai da do SDR vira
    // achismo e ele desconta pela metade. Por isso a frase nunca afirma.
    const c = fecharAConta({ quantidade: 3, periodo: "dia", valorUnitario: 120 });
    expect(c?.frase.trim().endsWith("?")).toBe(true);
  });

  it("sem o valor unitário, pergunta o valor em vez de inventar um", () => {
    const c = fecharAConta({ quantidade: 4, periodo: "semana", valorUnitario: null });
    expect(c?.reaisPorMes).toBeNull();
    expect(c?.frase).toContain("Quanto vale cada um");
    expect(c?.frase).not.toContain("R$ 0");
  });

  it("não repete 'no mês' quando o dono já falou por mês", () => {
    const c = fecharAConta({ quantidade: 10, periodo: "mes", valorUnitario: 500 });
    expect(c?.porMes).toBe(10);
    expect(c?.frase).toContain("dez por mês");
    expect(c?.frase).not.toContain("10 no mês");
  });

  it("recusa a conta em vez de mostrar número inventado", () => {
    // Transcrição picotada é o caso real: o Whisper devolve um número de
    // telefone no meio da fala e isso viraria "1.200 por mês" na tela, lido em
    // voz alta. Melhor sugestão nenhuma do que uma que o dono desmente.
    expect(fecharAConta(null)).toBeNull();
    expect(fecharAConta({ quantidade: 0, periodo: "semana", valorUnitario: 100 })).toBeNull();
    expect(fecharAConta({ quantidade: -2, periodo: "semana", valorUnitario: 100 })).toBeNull();
    expect(fecharAConta({ quantidade: 999_999, periodo: "dia", valorUnitario: 10 })).toBeNull();
  });

  it("cabe no teto de caractere da sugestão", () => {
    // O schema recusa sugestão acima de 320 caracteres. Uma conta que não passa
    // pelo schema é uma conta que nunca chega na tela.
    const c = fecharAConta({ quantidade: 7, periodo: "semana", valorUnitario: 12_500 });
    expect(c!.frase.length).toBeLessThanOrEqual(320);
  });
});

describe("as palavras-eixo", () => {
  it("são sete, e cada uma tem o que nunca dizer e como dizer", () => {
    expect(EIXOS).toHaveLength(7);
    for (const e of EIXOS) {
      expect(e.ouve.length).toBeGreaterThan(0);
      expect(e.nunca.length).toBeGreaterThan(0);
      expect(e.diga.length).toBeGreaterThan(10);
    }
  });

  it("a tabela inteira entra no prompt do sistema", () => {
    // O defeito silencioso: eixo que existe no vocabulário e não no prompt
    // nunca é escolhido pelo modelo, e ninguém descobre.
    const sistema = liveCallSystemPrompt();
    for (const e of EIXOS) {
      expect(sistema).toContain(e.chave);
      expect(sistema).toContain(e.diga);
    }
  });

  it("as palavras proibidas do caderno estão todas lá", () => {
    for (const p of ["crm", "chatbot", "seo", "dashboard", "tráfego pago", "funil"]) {
      expect(PALAVRAS_PROIBIDAS).toContain(p);
    }
  });

  it("o rótulo cai de pé com chave desconhecida", () => {
    expect(rotuloDoEixo("espera")).toBe("Espera");
    expect(rotuloDoEixo(null)).toBeNull();
    expect(rotuloDoEixo("inventado")).toBe("inventado");
  });
});

describe("o eixo e a conta na mensagem do modelo", () => {
  const base = {
    janela: "chega mensagem de noite e só no outro dia alguém vê",
    ultimoTrecho: "uns 800 reais",
    estado: {},
    segundos: 200,
    contexto: null,
    fase: "dor" as const,
    degrau: "numero" as const,
  };

  it("o eixo travado vai na mensagem e manda repetir a mesma chave", () => {
    // É esta linha que impede a ligação de voltar ao genérico quando a dor
    // original já saiu da janela da transcrição.
    const u = liveCallUserPrompt({ ...base, eixo: "espera" });
    expect(u).toContain('PALAVRA-EIXO JÁ ESCOLHIDA NESTA LIGAÇÃO: "espera"');
  });

  it("a conta chega pronta e o modelo é proibido de recalcular", () => {
    const conta = fecharAConta({ quantidade: 2, periodo: "semana", valorUnitario: 800 });
    const u = liveCallUserPrompt({ ...base, conta });
    expect(u).toContain("R$ 6.400");
    expect(u).toContain("Não recalcule");
  });

  it("na segunda esquiva, a mensagem manda desistir do número", () => {
    // Sem isto o copiloto insiste até o dono ficar incomodado — e a reunião
    // vale mais que o número.
    expect(liveCallUserPrompt({ ...base, desviosDoNumero: 1 })).not.toContain("Pare de perguntar");
    expect(liveCallUserPrompt({ ...base, desviosDoNumero: 2 })).toContain("Pare de perguntar");
  });

  it("sem eixo e sem conta, não inventa seção vazia", () => {
    const u = liveCallUserPrompt(base);
    expect(u).not.toContain("PALAVRA-EIXO");
    expect(u).not.toContain("A CONTA COM OS NÚMEROS");
  });
});
