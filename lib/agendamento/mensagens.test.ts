import { describe, expect, it } from "vitest";

import type { Reuniao } from "./reuniao";
import {
  mensagemDaVespera,
  mensagemDeConfirmacao,
  mensagemFinal,
  primeiroNome,
} from "./mensagens";

/** Quarta 12/08/2026, 14h Bahia. */
const REUNIAO: Reuniao = {
  tipo: "r1",
  em: "2026-08-12T17:00:00.000Z",
  data: "2026-08-12",
  hora: "14:00",
  criada_em: "2026-08-10T12:00:00.000Z",
  avisos: {},
};

const CTX = { nomeDoContato: "MARCOS ANTONIO", negocio: "Pizzaria Dom Luigi" };

describe("primeiroNome", () => {
  it("desliga o CAPS da lista importada", () => {
    expect(primeiroNome("MARCOS ANTONIO")).toBe("Marcos");
  });

  it("devolve vazio quando não há nome", () => {
    expect(primeiroNome(null)).toBe("");
    expect(primeiroNome("   ")).toBe("");
  });
});

describe("mensagemDeConfirmacao", () => {
  const texto = mensagemDeConfirmacao(REUNIAO, CTX);

  it("repete dia e hora por extenso", () => {
    expect(texto).toContain("quarta-feira (12/08) às 14h");
  });

  it("carrega as três alavancas anti-no-show", () => {
    expect(texto).toContain("@ do Instagram"); // micro-compromisso
    expect(texto).toContain("poucas vagas"); // escassez
    expect(texto).toContain("Combinado?"); // pergunta fechada
  });

  it("assina quem marcou, quando há assinatura", () => {
    expect(mensagemDeConfirmacao(REUNIAO, { ...CTX, quemConduz: "Mario" })).toContain("\nMario");
  });

  it("não escreve 'Olá cliente' quando o contato é anônimo", () => {
    const anonimo = mensagemDeConfirmacao(REUNIAO, { negocio: "Pizzaria Dom Luigi" });
    expect(anonimo.startsWith("fechado!")).toBe(true);
  });
});

describe("mensagemDaVespera", () => {
  it("pede confirmação de uma palavra e diz que o material já existe", () => {
    const texto = mensagemDaVespera(REUNIAO, CTX);
    expect(texto).toContain("amanhã (12/08), às 14h");
    expect(texto).toContain("Já levantei");
    expect(texto).toContain('só "sim"');
  });
});

describe("mensagemFinal", () => {
  it("diz canal e duração, sem prometer relógio", () => {
    const texto = mensagemFinal(REUNIAO, CTX);
    expect(texto).toContain("hoje às 14h");
    expect(texto).toContain("WhatsApp");
    expect(texto).toContain("20 minutos");
    expect(texto).not.toContain("1 hora");
  });
});

describe("nome do negócio na frase", () => {
  it("concorda o artigo com o nome fantasia", () => {
    expect(mensagemDeConfirmacao(REUNIAO, CTX)).toContain("da Pizzaria Dom Luigi");
    expect(
      mensagemDeConfirmacao(REUNIAO, { ...CTX, negocio: "Mercado São Jorge" }),
    ).toContain("do Mercado São Jorge");
  });

  it("cai para 'do seu negócio' sem duplicar artigo quando o card não tem título", () => {
    const texto = mensagemDeConfirmacao(REUNIAO, { nomeDoContato: "Marcos" });
    expect(texto).toContain("diagnóstico do seu negócio");
    expect(texto).not.toContain("do o seu");
  });

  it("idem na véspera, onde o artigo vem solto", () => {
    const texto = mensagemDaVespera(REUNIAO, { nomeDoContato: "Marcos" });
    expect(texto).toContain("com o seu negócio");
    expect(texto).not.toContain("com o o seu");
  });
});
