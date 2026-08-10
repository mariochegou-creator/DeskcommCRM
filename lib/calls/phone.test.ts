import { describe, expect, it } from "vitest";

import { formatPhoneBR, toE164BR, toWhatsAppNumber } from "@/lib/calls/phone";

/**
 * O que este teste protege: **o botão "Ligar" não pode discar para outra
 * pessoa.**
 *
 * A tentação de "completar o que falta" é a coisa que faz isso acontecer — um
 * número de 9 dígitos sem DDD ganhando um DDD chutado, um fixo de 10 dígitos
 * virando celular com um 9 inserido. Cada caso desses é uma ligação de
 * prospecção feita para um estranho, em nome da empresa, e o SDR só descobre
 * quando alguém atende.
 */
describe("toE164BR", () => {
  it("normaliza o formato que o CRM tem gravado hoje", () => {
    expect(toE164BR("(77)99812-5024")).toBe("+5577998125024");
    expect(toE164BR("(77) 99812-5024")).toBe("+5577998125024");
    expect(toE164BR("77 99812 5024")).toBe("+5577998125024");
    expect(toE164BR("77998125024")).toBe("+5577998125024");
  });

  it("aceita fixo de 10 dígitos SEM inventar o 9 do celular", () => {
    // Inserir o 9 aqui criaria um celular que pode existir e ser de outra
    // pessoa — o fixo simplesmente continua fixo.
    expect(toE164BR("(77) 3421-5024")).toBe("+557734215024");
  });

  it("passa E.164 adiante intacto, inclusive de outro país", () => {
    expect(toE164BR("+5577998125024")).toBe("+5577998125024");
    // Um contato português não pode ser reescrito pela regra brasileira.
    expect(toE164BR("+351912345678")).toBe("+351912345678");
  });

  it("aceita 55 + DDD + número sem o +", () => {
    expect(toE164BR("5577998125024")).toBe("+5577998125024");
    expect(toE164BR("557734215024")).toBe("+557734215024");
  });

  it("devolve null em vez de adivinhar", () => {
    expect(toE164BR(null)).toBeNull();
    expect(toE164BR(undefined)).toBeNull();
    expect(toE164BR("")).toBeNull();
    expect(toE164BR("   ")).toBeNull();
    expect(toE164BR("998125024")).toBeNull(); // 9 dígitos: falta o DDD
    expect(toE164BR("1234")).toBeNull(); // ramal
    expect(toE164BR("não tem")).toBeNull();
    // 12 dígitos que NÃO começam em 55: cair aqui por coincidência de tamanho
    // seria adivinhar o país.
    expect(toE164BR("351912345678")).toBeNull();
  });
});

describe("formatPhoneBR", () => {
  it("agrupa do jeito que o SDR digita no celular", () => {
    expect(formatPhoneBR("+5577998125024")).toBe("(77) 99812-5024");
    expect(formatPhoneBR("+557734215024")).toBe("(77) 3421-5024");
  });

  it("não força máscara brasileira em número que não é brasileiro", () => {
    expect(formatPhoneBR("+351912345678")).toBe("+351912345678");
  });

  it("vazio vira string vazia, nunca 'null' na tela", () => {
    expect(formatPhoneBR(null)).toBe("");
    expect(formatPhoneBR(undefined)).toBe("");
  });
});

describe("toWhatsAppNumber", () => {
  it("tira o + porque é o que o wa.me espera", () => {
    expect(toWhatsAppNumber("(77)99812-5024")).toBe("5577998125024");
  });

  it("herda a recusa de adivinhar", () => {
    expect(toWhatsAppNumber("998125024")).toBeNull();
  });
});
