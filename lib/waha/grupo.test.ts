/**
 * A resposta do WAHA ao criar um grupo não tem forma única — e perder o
 * `…@g.us` dela é o pior modo de falha desta feature: o grupo existe no celular
 * de todo mundo e o CRM não sabe o endereço, então nenhuma mensagem sai.
 */
import { describe, expect, it } from "vitest";

import { chatIdDeTelefone, ehChatIdDeGrupo, extrairChatIdDoGrupo, participantesQueFaltaram } from "./grupo";

const GID = "120363000000000000@g.us";

describe("extrairChatIdDoGrupo", () => {
  it("NOWEB: id direto", () => {
    expect(extrairChatIdDoGrupo({ id: GID })).toBe(GID);
  });

  it("WEBJS: objeto com _serialized", () => {
    expect(extrairChatIdDoGrupo({ gid: { _serialized: GID, server: "g.us" } })).toBe(GID);
    expect(extrairChatIdDoGrupo({ id: { _serialized: GID } })).toBe(GID);
  });

  it("Baileys cru: user + server", () => {
    expect(extrairChatIdDoGrupo({ id: { user: "120363000000000000", server: "g.us" } })).toBe(GID);
  });

  it("string solta", () => {
    expect(extrairChatIdDoGrupo(GID)).toBe(GID);
  });

  it("recusa o que NÃO é endereço de grupo — melhor falhar do que gravar lixo", () => {
    expect(extrairChatIdDoGrupo({ id: "5575988887777@c.us" })).toBeNull();
    expect(extrairChatIdDoGrupo({ id: "" })).toBeNull();
    expect(extrairChatIdDoGrupo({ id: { user: "123", server: "c.us" } })).toBeNull();
    expect(extrairChatIdDoGrupo({})).toBeNull();
    expect(extrairChatIdDoGrupo(null)).toBeNull();
    expect(extrairChatIdDoGrupo(42)).toBeNull();
  });
});

describe("participantesQueFaltaram", () => {
  it("acha quem o WhatsApp recusou", () => {
    const resposta = {
      id: GID,
      participants: [
        { id: "5575988887777@c.us", code: "200" },
        { id: "5575911112222@c.us", code: "403" },
        { id: "5575933334444@c.us", code: 409 },
      ],
    };
    expect(participantesQueFaltaram(resposta)).toEqual([
      "5575911112222@c.us",
      "5575933334444@c.us",
    ]);
  });

  it("sem código não conta como falha — nem todo engine devolve", () => {
    expect(participantesQueFaltaram({ participants: [{ id: "1@c.us" }] })).toEqual([]);
  });

  it("resposta sem participants não explode", () => {
    expect(participantesQueFaltaram({ id: GID })).toEqual([]);
    expect(participantesQueFaltaram(null)).toEqual([]);
  });
});

describe("chatIdDeTelefone", () => {
  it("limpa o telefone e devolve @c.us", () => {
    expect(chatIdDeTelefone("+55 (75) 98888-7777")).toBe("5575988887777@c.us");
  });

  it("número curto demais é null — não manda '@c.us' pro WhatsApp", () => {
    expect(chatIdDeTelefone("123")).toBeNull();
    expect(chatIdDeTelefone("")).toBeNull();
    expect(chatIdDeTelefone(null)).toBeNull();
  });
});

describe("ehChatIdDeGrupo", () => {
  it("distingue grupo de conversa individual", () => {
    expect(ehChatIdDeGrupo(GID)).toBe(true);
    expect(ehChatIdDeGrupo("5575988887777@c.us")).toBe(false);
    expect(ehChatIdDeGrupo(null)).toBe(false);
  });
});
