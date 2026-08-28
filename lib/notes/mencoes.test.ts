/**
 * O peso está em `acharMencionados`: é ela que decide QUEM recebe o toque no
 * ombro. Falso negativo = a nota some sem avisar ninguém (o defeito de origem);
 * falso positivo = alerta na tela de quem não tem nada com aquilo.
 */
import { describe, expect, it } from "vitest";

import { acharMencionados, resolveArroba } from "./mencoes";

const EQUIPE = [
  { user_id: "u-david", full_name: "David Souza" },
  { user_id: "u-davi", full_name: "Davi Lima" },
  { user_id: "u-mario", full_name: "Mário Chegou" },
  { user_id: "u-sem-nome", full_name: null },
];

describe("acharMencionados", () => {
  it("acha pelo primeiro nome, que é como se escreve", () => {
    expect(acharMencionados("@david olha isso aqui", EQUIPE)).toEqual(["u-david"]);
  });

  it("não confunde Davi com David (a borda depois do nome)", () => {
    expect(acharMencionados("@davi olha isso", EQUIPE)).toEqual(["u-davi"]);
  });

  it("ignora acento nos dois lados", () => {
    expect(acharMencionados("@mario ve isso", EQUIPE)).toEqual(["u-mario"]);
    expect(acharMencionados("@Mário vê isso", EQUIPE)).toEqual(["u-mario"]);
  });

  it("aceita nome completo e não repete o id", () => {
    expect(acharMencionados("@david souza e @david de novo", EQUIPE)).toEqual(["u-david"]);
  });

  it("membro sem nome cadastrado nunca é citado", () => {
    expect(acharMencionados("@ @null olha", EQUIPE)).toEqual([]);
  });

  it("nota sem @ não marca ninguém", () => {
    expect(acharMencionados("david ligou hoje", EQUIPE)).toEqual([]);
  });
});

describe("resolveArroba", () => {
  it("abre no meio do texto, diferente do slash", () => {
    const t = "falei com ele, @dav";
    expect(resolveArroba(t, t.length)).toEqual({ open: true, query: "dav", inicio: 15 });
  });

  it("abre com o @ recém-digitado", () => {
    expect(resolveArroba("@", 1)).toEqual({ open: true, query: "", inicio: 0 });
  });

  it("não abre em e-mail colado", () => {
    const t = "mandei pro contato@nexoialocal.com.br";
    expect(resolveArroba(t, t.length).open).toBe(false);
  });

  it("fecha quando o espaço passa", () => {
    const t = "@david olha";
    expect(resolveArroba(t, t.length).open).toBe(false);
  });
});
