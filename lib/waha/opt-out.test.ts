import { describe, expect, it } from "vitest";

import { ehPedidoDeOptOut } from "./opt-out";

describe("ehPedidoDeOptOut", () => {
  describe("os dois falsos positivos que apagaram lead vivo (12/08/2026)", () => {
    it("não bloqueia a resposta comercial que menciona sair de casa", () => {
      // Pousada Love Story — estava respondendo, virou lead morto.
      const msg =
        "Olá! Que bom que nos encontrou por aqui.\nNa *Pousada Love Story*, nós trabalhamos apenas com a chegada na hora. Não fazemos reservas antecipadas.\nO ideal é você entrar em contato com a gente uns 15 a 20 minutos antes de sair de casa para confirmarmos se o quarto que você quer está livre. Se estiver, é só vir direto!\nQuer saber os valores ou detalhes de alguma suíte específica?";
      expect(ehPedidoDeOptOut(msg)).toBe(false);
    });

    it("não bloqueia a nossa própria despedida da cadência", () => {
      // O sistema se auto-bloqueou com o texto que ele mesmo escreveu.
      const msg =
        "Oi, última mensagem minha, prometo. Entendi que agora não é o momento, e tá tudo certo. Vou parar de te escrever pra não virar incômodo. Se um dia isso subir na sua lista, meu contato é este aqui mesmo. Sucesso pra vocês!";
      expect(ehPedidoDeOptOut(msg)).toBe(false);
    });
  });

  describe("a mensagem É a palavra", () => {
    it.each(["PARAR", "parar", "Stop", "STOP", "sair", "Sair.", "Cancelar!", "unsubscribe", "pare"])(
      "%s",
      (msg) => {
        expect(ehPedidoDeOptOut(msg)).toBe(true);
      },
    );

    it("aceita a cortesia em volta", () => {
      expect(ehPedidoDeOptOut("por favor, parar")).toBe(true);
      expect(ehPedidoDeOptOut("PARAR, por favor")).toBe(true);
    });
  });

  describe("frase curta sobre a lista", () => {
    it.each([
      "me tira da lista por favor",
      "quero sair da lista",
      "não quero mais receber essas mensagens",
      "para de me mandar mensagem",
      "pode remover meu numero",
      "quero me descadastrar",
      "agradeço o contato, mas por favor não quero mais receber essas mensagens, obrigado",
    ])("%s", (msg) => {
      expect(ehPedidoDeOptOut(msg)).toBe(true);
    });
  });

  describe("conversa normal continua passando", () => {
    it.each([
      "vou sair agora, te falo mais tarde",
      "preciso parar a produção hoje pra manutenção",
      "pode remover o item 3 do orçamento?",
      "sair de casa cedo aqui é complicado",
      "bom dia! ainda tem o produto?",
      "não quero mais o modelo azul, prefiro o preto",
      "vamos parar por aqui hoje e retomamos amanhã",
    ])("%s", (msg) => {
      expect(ehPedidoDeOptOut(msg)).toBe(false);
    });

    it("textão que menciona a lista de passagem não bloqueia", () => {
      // Acima do teto de palavras: a frase está DENTRO de um assunto, não é o
      // assunto. Ver MAX_PALAVRAS no módulo.
      const msg =
        "bom dia, tudo bem? então, sobre aquele orçamento que a gente conversou semana passada, " +
        "eu falei com meu sócio e ele achou interessante, mas ele quer entender melhor como funciona " +
        "a parte de mensagem automática porque um cliente nosso reclamou e disse que não quero mais " +
        "receber, aí ficamos com receio de incomodar quem compra da gente, entende? me explica melhor";
      expect(ehPedidoDeOptOut(msg)).toBe(false);
    });
  });

  it("vazio e não-texto não bloqueiam", () => {
    expect(ehPedidoDeOptOut(null)).toBe(false);
    expect(ehPedidoDeOptOut(undefined)).toBe(false);
    expect(ehPedidoDeOptOut("")).toBe(false);
    expect(ehPedidoDeOptOut("   ")).toBe(false);
    expect(ehPedidoDeOptOut("👍")).toBe(false);
  });
});
