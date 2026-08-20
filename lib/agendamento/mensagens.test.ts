import { describe, expect, it } from "vitest";

import type { Reuniao } from "./reuniao";
import {
  mensagemDaEquipe,
  mensagemDoMaterial,
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

describe("mensagemDaEquipe", () => {
  it("diz tipo, negócio, hora e contato — o essencial de quem vai atender", () => {
    const texto = mensagemDaEquipe(REUNIAO, CTX);
    expect(texto).toContain("Reunião daqui a 1 hora: R1 com Pizzaria Dom Luigi, às 14h.");
    expect(texto).toContain("Contato: Marcos.");
  });

  it("pergunta pelo material — é o que dispara o resto", () => {
    expect(mensagemDaEquipe(REUNIAO, CTX)).toContain("Quer que eu prepare o material?");
  });

  it("sobrevive a card sem nome e contato sem nome", () => {
    const texto = mensagemDaEquipe(REUNIAO, {});
    expect(texto).toContain("R1 com (card sem nome), às 14h.");
    expect(texto).not.toContain("Contato:");
  });
});

describe("mensagemDoMaterial", () => {
  const ROTEIRO = {
    gerado_em: "2026-08-12T16:05:00.000Z",
    resumo: "Pizzaria em Serrinha.",
    dor: "perde pedido no pico",
    gancho: "a entrega até Feira",
    perguntas: ["quantos pedidos por noite?", "quem responde o WhatsApp?"],
    situacao: [],
    problema: [],
    implicacao: [],
    necessidade: [],
    proximo_passo: "mostrar o demo",
    atencao: null,
  };

  it("leva o essencial e o link, numerando as perguntas", () => {
    const texto = mensagemDoMaterial(REUNIAO, CTX, ROTEIRO, "https://crm.x/app/reuniao/1");
    expect(texto).toContain("Material da R1 com Pizzaria Dom Luigi, às 14h.");
    expect(texto).toContain("Quem é: Pizzaria em Serrinha.");
    expect(texto).toContain("1. quantos pedidos por noite?");
    expect(texto).toContain("2. quem responde o WhatsApp?");
    expect(texto).toContain("Roteiro completo: https://crm.x/app/reuniao/1");
    expect(texto).not.toContain("Montado direto do card");
  });

  it("avisa quando o material é de reserva — não pode se passar por pensado", () => {
    const texto = mensagemDoMaterial(
      REUNIAO,
      CTX,
      { ...ROTEIRO, reserva: true },
      "https://crm.x/app/reuniao/1",
    );
    expect(texto).toContain("Montado direto do card");
  });
});
