import { describe, expect, it } from "vitest";

import { analisarVCard } from "./vcard";

/** O formato que o WAHA NOWEB entrega no `body` de uma mensagem `vcard`. */
const UM_CARTAO = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Silva;João;;;",
  "FN:João Silva",
  "item1.TEL;waid=5573999818151:+55 73 99981-8151",
  "item1.X-ABLabel:Celular",
  "END:VCARD",
].join("\n");

describe("analisarVCard", () => {
  it("lê nome e telefone de um cartão", () => {
    expect(analisarVCard(UM_CARTAO)).toEqual([
      { nome: "João Silva", telefone: "+5573999818151", telefoneCru: "+55 73 99981-8151" },
    ]);
  });

  it("tira o telefone do waid, não do texto do TEL", () => {
    // O texto está escrito como a agenda guardou (com o nono dígito e sujeira
    // no fim); o `waid` é a chave real. Ler o texto é o que partia o contato em
    // dois — mesma lição da migration 0102.
    const cartao = [
      "BEGIN:VCARD",
      "FN:Loja Central",
      "item1.TEL;waid=5573999818151:(73) 9 9981-8151 - loja",
      "END:VCARD",
    ].join("\n");
    expect(analisarVCard(cartao)[0]!.telefone).toBe("+5573999818151");
  });

  it("aceita cartão sem waid (fixo, contato de agenda antiga)", () => {
    const cartao = ["BEGIN:VCARD", "FN:Escritório", "TEL:(73) 3611-2233", "END:VCARD"].join("\n");
    expect(analisarVCard(cartao)[0]!.telefone).toBe("+557336112233");
  });

  it("devolve um item por cartão quando vêm vários (multi_vcard)", () => {
    const dois = [
      UM_CARTAO,
      ["BEGIN:VCARD", "FN:Maria Souza", "item1.TEL;waid=5573988887777:+55 73 98888-7777", "END:VCARD"].join("\n"),
    ].join("\n");
    const lidos = analisarVCard(dois);
    expect(lidos).toHaveLength(2);
    expect(lidos.map((c) => c.nome)).toEqual(["João Silva", "Maria Souza"]);
  });

  it("monta o nome pelo N quando não há FN, com o nome antes do sobrenome", () => {
    const cartao = ["BEGIN:VCARD", "N:Silva;João;;;", "TEL:+5573999818151", "END:VCARD"].join("\n");
    expect(analisarVCard(cartao)[0]!.nome).toBe("João Silva");
  });

  it("desdobra linha continuada (nome longo quebrado pelo remetente)", () => {
    // RFC 6350 §3.2: o PRIMEIRO espaço é o marcador de dobra e some; o segundo
    // é conteúdo. Por isso a linha de continuação abaixo tem dois — quem
    // escrever só um está mandando "Carlosde" de propósito, e o parser tem de
    // entregar isso mesmo em vez de adivinhar um espaço que não veio.
    const cartao = ["BEGIN:VCARD", "FN:João Carlos", "  de Almeida Silva", "TEL:+5573999818151", "END:VCARD"].join("\n");
    expect(analisarVCard(cartao)[0]!.nome).toBe("João Carlos de Almeida Silva");
  });

  it("mantém o cartão sem telefone utilizável, em vez de sumir com ele", () => {
    // A bolha precisa dizer "veio um contato, e não dá para adicionar" — lista
    // vazia contaria que a mensagem estava vazia, que é outra coisa.
    const cartao = ["BEGIN:VCARD", "FN:Sem número", "TEL:123", "END:VCARD"].join("\n");
    expect(analisarVCard(cartao)).toEqual([
      { nome: "Sem número", telefone: null, telefoneCru: "123" },
    ]);
  });

  it("o primeiro número utilizável ganha do segundo TEL", () => {
    const cartao = [
      "BEGIN:VCARD",
      "FN:Loja",
      "item1.TEL;waid=5573999818151:+55 73 99981-8151",
      "item2.TEL:(73) 3611-2233",
      "END:VCARD",
    ].join("\n");
    expect(analisarVCard(cartao)[0]!.telefone).toBe("+5573999818151");
  });

  it("texto que não é vCard não vira cartão nenhum", () => {
    expect(analisarVCard("bom dia, segue o contato")).toEqual([]);
    expect(analisarVCard(null)).toEqual([]);
    expect(analisarVCard("")).toEqual([]);
  });
});
