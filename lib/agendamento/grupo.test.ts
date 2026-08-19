/**
 * As regras do grupo da reunião, sem banco e sem WhatsApp.
 *
 * O peso dos testes está em `ehPedidoDeRemarcacao` de propósito: é a ÚNICA
 * coisa que faz a automação falar em cima do que uma pessoa escreveu, e ela
 * fala num grupo onde o cliente está lendo. Falso positivo aqui é a Nexo
 * respondendo torto na frente de quem ela quer que a contrate.
 */
import { describe, expect, it } from "vitest";

import {
  ehPedidoDeRemarcacao,
  lerGrupo,
  LIMITE_NOME_DO_GRUPO,
  nomeDoGrupo,
  participantesDoGrupo,
} from "./grupo";

describe("nomeDoGrupo", () => {
  it("põe o nosso nome na frente para o dono reconhecer na lista", () => {
    expect(nomeDoGrupo("Pizzaria Dom Luigi")).toBe("Nexo IA ✕ Pizzaria Dom Luigi");
  });

  it("card sem título não vira 'Nexo IA ✕ '", () => {
    expect(nomeDoGrupo("")).toBe("Nexo IA");
    expect(nomeDoGrupo(null)).toBe("Nexo IA");
    expect(nomeDoGrupo("   ")).toBe("Nexo IA");
  });

  it("corta no espaço, não no meio da palavra", () => {
    const nome = nomeDoGrupo("Distribuidora " + "Muito ".repeat(30) + "Grande");
    expect(nome.length).toBeLessThanOrEqual(LIMITE_NOME_DO_GRUPO);
    expect(nome.endsWith(" ")).toBe(false);
    expect(nome).not.toMatch(/Muit$/);
  });

  it("achata espaço repetido — nome importado vem com sobra", () => {
    expect(nomeDoGrupo("  Loja   do   João ")).toBe("Nexo IA ✕ Loja do João");
  });
});

describe("participantesDoGrupo", () => {
  const base = {
    telefoneDoLead: "+5575988887777",
    telefonesDaEquipe: ["+5575911112222", "+5575933334444"],
    telefoneDaSessao: "5575900000000",
  };

  it("devolve chatId de todo mundo, com o lead primeiro", () => {
    expect(participantesDoGrupo(base)).toEqual([
      "5575988887777@c.us",
      "5575911112222@c.us",
      "5575933334444@c.us",
    ]);
  });

  it("NÃO convida o próprio número da sessão — ele já é o dono", () => {
    const r = participantesDoGrupo({
      ...base,
      telefonesDaEquipe: ["+55 75 90000-0000", "+5575911112222"],
    });
    expect(r).not.toContain("5575900000000@c.us");
    expect(r).toEqual(["5575988887777@c.us", "5575911112222@c.us"]);
  });

  it("compara por dígitos: o mesmo número em formatos diferentes entra uma vez", () => {
    const r = participantesDoGrupo({
      telefoneDoLead: "+55 (75) 98888-7777",
      telefonesDaEquipe: ["5575988887777", "+5575988887777"],
      telefoneDaSessao: null,
    });
    expect(r).toEqual(["5575988887777@c.us"]);
  });

  it("ignora vazio e lixo em vez de mandar '@c.us' pro WhatsApp", () => {
    const r = participantesDoGrupo({
      telefoneDoLead: null,
      telefonesDaEquipe: ["", "   ", "abc", "+5575911112222"],
      telefoneDaSessao: null,
    });
    expect(r).toEqual(["5575911112222@c.us"]);
  });
});

describe("lerGrupo", () => {
  const bom = {
    grupo: {
      chat_id: "120363000000000000@g.us",
      nome: "Nexo IA ✕ Loja X",
      conversation_id: "c-1",
      criado_em: "2026-08-19T12:00:00.000Z",
      criado_por: "u-1",
      participantes: ["5575988887777@c.us"],
      faltaram: [],
    },
  };

  it("lê o que foi gravado", () => {
    expect(lerGrupo(bom)?.chat_id).toBe("120363000000000000@g.us");
    expect(lerGrupo(bom)?.conversation_id).toBe("c-1");
  });

  it("endereço que não é de grupo devolve null — registro quebrado não conta como grupo", () => {
    expect(lerGrupo({ grupo: { ...bom.grupo, chat_id: "5575988887777@c.us" } })).toBeNull();
    expect(lerGrupo({ grupo: { ...bom.grupo, chat_id: "" } })).toBeNull();
    expect(lerGrupo({ grupo: { ...bom.grupo, chat_id: 42 } })).toBeNull();
  });

  it("custom_fields sem grupo, nulo ou array não explode", () => {
    expect(lerGrupo(null)).toBeNull();
    expect(lerGrupo({})).toBeNull();
    expect(lerGrupo([])).toBeNull();
    expect(lerGrupo({ reuniao: {} })).toBeNull();
  });

  it("campos ausentes viram vazio, não undefined solto", () => {
    const g = lerGrupo({ grupo: { chat_id: "1@g.us" } });
    expect(g).not.toBeNull();
    expect(g!.participantes).toEqual([]);
    expect(g!.conversation_id).toBeNull();
  });
});

describe("ehPedidoDeRemarcacao", () => {
  it.each([
    "não vou poder amanhã",
    "Não vou conseguir participar",
    "preciso remarcar",
    "Dá pra mudar pra outro dia?",
    "tem como transferir pra semana que vem",
    "surgiu um imprevisto aqui",
    "vamos remarcar",
    "quero desmarcar a reunião",
    "fica pra outra semana",
    "NAO POSSO nesse horário",
  ])("casa: %s", (texto) => {
    expect(ehPedidoDeRemarcacao(texto)).toBe(true);
  });

  it.each([
    "confirmado",
    "sim",
    "beleza, tô esperando",
    "qual o valor?",
    "não entendi direito o que vocês fazem",
    "o cliente não vou saber dizer", // frase truncada, sem pedido
    "vou poder sim",
    "posso mandar o instagram depois?",
    // Casos que já foram falso positivo em versões anteriores da régua:
    "surgiu um problema no meu site, queria falar disso",
    "esse é outro dia que eu atendo até mais tarde",
    "não vou saber responder isso agora",
    "não vou mentir, achei caro",
    "",
    "   ",
  ])("NÃO casa: %s", (texto) => {
    expect(ehPedidoDeRemarcacao(texto)).toBe(false);
  });

  it("texto nulo não casa", () => {
    expect(ehPedidoDeRemarcacao(null)).toBe(false);
    expect(ehPedidoDeRemarcacao(undefined)).toBe(false);
  });

  it("acento não muda a decisão", () => {
    expect(ehPedidoDeRemarcacao("não vou poder")).toBe(true);
    expect(ehPedidoDeRemarcacao("nao vou poder")).toBe(true);
  });

  it("mensagem longa não dispara — é conversa, não pedido", () => {
    const longa =
      "oi pessoal, tudo bem? " +
      "queria contar o que aconteceu aqui na loja essa semana. ".repeat(8) +
      "enfim, preciso remarcar";
    expect(longa.length).toBeGreaterThan(300);
    expect(ehPedidoDeRemarcacao(longa)).toBe(false);
  });
});
