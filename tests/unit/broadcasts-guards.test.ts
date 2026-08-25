/**
 * As guardas por destinatário do disparador (0108).
 *
 * O caso do telefone divergente é o que justifica o arquivo existir: em
 * 21/08/2026, 20 leads apareceram como "enviado" no inbox e nunca receberam
 * nada. Num disparo de 300 isso seria descoberto tarde e sem sintoma — o
 * relatório diria "300 enviadas" e nenhum telefone teria tocado.
 */
import { describe, expect, it } from "vitest";

import {
  motivoParaPular,
  telefoneDivergeDaIdentidade,
  type ContatoParaDisparo,
} from "@/lib/broadcasts/guards";

const bom: ContatoParaDisparo = {
  id: "c1",
  phone_number: "+557399818151",
  wa_identity: "phone:+557399818151",
  is_blocked: false,
  is_anonymized: false,
  is_merged_into: null,
};

describe("telefoneDivergeDaIdentidade", () => {
  it("iguais não divergem", () => {
    expect(telefoneDivergeDaIdentidade("+557399818151", "phone:+557399818151")).toBe(false);
  });

  it("o nono dígito a mais divergindo é pego", () => {
    // O telefone tem o 9 e a identidade do WhatsApp não: o WAHA discaria o
    // número com 9 e a mensagem sairia para o vazio.
    expect(telefoneDivergeDaIdentidade("+5573999818151", "phone:+557399818151")).toBe(true);
  });

  it("identidade @lid não é comparável — não bloqueia", () => {
    expect(telefoneDivergeDaIdentidade("+557399818151", "lid:123456789")).toBe(false);
  });

  it("sem identidade não bloqueia", () => {
    expect(telefoneDivergeDaIdentidade("+557399818151", null)).toBe(false);
  });

  it("ignora formatação ao comparar", () => {
    expect(telefoneDivergeDaIdentidade("+55 73 9981-8151", "phone:+557399818151")).toBe(false);
  });
});

describe("motivoParaPular", () => {
  it("contato bom passa", () => {
    expect(motivoParaPular(bom)).toBeNull();
  });

  it("sem telefone não recebe", () => {
    expect(motivoParaPular({ ...bom, phone_number: null })).toBe("sem_telefone");
  });

  it("quem pediu PARAR nunca recebe", () => {
    expect(motivoParaPular({ ...bom, is_blocked: true })).toBe("bloqueado");
  });

  it("anonimizado por LGPD não recebe", () => {
    expect(motivoParaPular({ ...bom, is_anonymized: true })).toBe("anonimizado");
  });

  it("contato fundido não recebe — quem recebe é o cadastro vivo", () => {
    expect(motivoParaPular({ ...bom, is_merged_into: "c2" })).toBe("contato_fundido");
  });

  it("telefone divergente é pulo, não envio silencioso", () => {
    expect(motivoParaPular({ ...bom, wa_identity: "phone:+5573999818151" })).toBe(
      "telefone_divergente",
    );
  });

  it("bloqueio vence a falta de telefone — a razão mais grave é a que se mostra", () => {
    const veto = motivoParaPular({ ...bom, phone_number: null, is_blocked: true });
    expect(veto).toBe("bloqueado");
  });
});
