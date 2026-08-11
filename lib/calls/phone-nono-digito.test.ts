/**
 * O NONO DÍGITO — as duas conversões que impedem o mesmo celular de virar dois
 * cadastros (migration 0102).
 *
 * Estes casos são de verdade: saíram da base da Nexo em 11/08/2026, onde 168
 * pares estavam partidos exatamente assim — o card num contato, a conversa no
 * outro.
 *
 * A regra em SQL (`fn_telefone_wa`) e a regra aqui precisam concordar. O dia em
 * que discordarem, a importação volta a criar duplicata em silêncio.
 */
import { describe, expect, it } from "vitest";

import { chaveWhatsAppBR, paraDiscarBR } from "./phone";

describe("chaveWhatsAppBR — a identidade", () => {
  it("DDD >= 31: tira o nono dígito (o caso Líder Aluguel de Veículos)", () => {
    expect(chaveWhatsAppBR("+5573999818151")).toBe("+557399818151");
    expect(chaveWhatsAppBR("+5577999930702")).toBe("+557799930702");
    expect(chaveWhatsAppBR("+5549991548535")).toBe("+554991548535");
  });

  it("número que já veio do WhatsApp não muda — a chave é estável", () => {
    expect(chaveWhatsAppBR("+557399818151")).toBe("+557399818151");
    expect(chaveWhatsAppBR(chaveWhatsAppBR("+5573999818151"))).toBe("+557399818151");
  });

  it("DDD 11-28 fica intacto — lá o WhatsApp usa o 9", () => {
    expect(chaveWhatsAppBR("+5511999998888")).toBe("+5511999998888");
    expect(chaveWhatsAppBR("+5521987654321")).toBe("+5521987654321");
  });

  it("fixo não perde dígito — nunca teve nono para perder", () => {
    expect(chaveWhatsAppBR("+557332218151")).toBe("+557332218151");
    expect(chaveWhatsAppBR("+554133334444")).toBe("+554133334444");
  });

  it("estrangeiro passa inteiro", () => {
    expect(chaveWhatsAppBR("+351912345678")).toBe("+351912345678");
  });

  it("aceita número sujo, porque é assim que a planilha chega", () => {
    expect(chaveWhatsAppBR("(73) 99981-8151")).toBe("+557399818151");
    expect(chaveWhatsAppBR("5573999818151")).toBe("+557399818151");
  });

  it("sem número não inventa chave", () => {
    expect(chaveWhatsAppBR(null)).toBeNull();
    expect(chaveWhatsAppBR("")).toBeNull();
    expect(chaveWhatsAppBR("123")).toBeNull();
  });
});

describe("paraDiscarBR — o número que completa a ligação", () => {
  it("devolve o nono dígito ao número que o WhatsApp encurtou", () => {
    expect(paraDiscarBR("+557399818151")).toBe("+5573999818151");
    expect(paraDiscarBR("+554991548535")).toBe("+5549991548535");
  });

  it("número que já tem o 9 não ganha outro", () => {
    expect(paraDiscarBR("+5573999818151")).toBe("+5573999818151");
  });

  it("fixo não vira celular — 2-5 depois do DDD não recebe 9", () => {
    expect(paraDiscarBR("+557332218151")).toBe("+557332218151");
    expect(paraDiscarBR("+551132218151")).toBe("+551132218151");
  });

  it("é o caminho de volta da chave, para celular de DDD >= 31", () => {
    for (const completo of ["+5573999818151", "+5577999930702", "+5549991548535"]) {
      expect(paraDiscarBR(chaveWhatsAppBR(completo))).toBe(completo);
    }
  });
});
