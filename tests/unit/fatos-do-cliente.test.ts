import { describe, expect, it } from "vitest";

import { extractExtras, extractGanchos } from "@/lib/leads/ganchos";
import {
  extractFatos,
  fatosIguais,
  FATOS_KEY,
  FATOS_VAZIO,
  MAX_FATOS,
  mesclarFatos,
  serializarFatos,
} from "@/lib/leads/fatos-do-cliente";

const AGORA = "2026-08-26T20:00:00.000Z";

describe("extractFatos", () => {
  it("lê decisor, fatos e carimbo do custom_fields", () => {
    const f = extractFatos({
      [FATOS_KEY]: {
        decisor: "Sérgio — dono",
        fala_com_decisor: true,
        fatos: ["Não fecha por telefone."],
        atualizado_em: AGORA,
      },
    });
    expect(f.decisor).toBe("Sérgio — dono");
    expect(f.falaComDecisor).toBe(true);
    expect(f.fatos).toEqual(["Não fecha por telefone."]);
    expect(f.atualizadoEm).toBe(AGORA);
  });

  it("negócio sem o campo devolve vazio, nunca lança", () => {
    expect(extractFatos(null)).toEqual(FATOS_VAZIO);
    expect(extractFatos({ gancho_abertura: "oi" })).toEqual(FATOS_VAZIO);
    expect(extractFatos("lixo")).toEqual(FATOS_VAZIO);
  });

  it("lixo dentro do campo não vira fato (webhook gravando qualquer coisa)", () => {
    const f = extractFatos({ [FATOS_KEY]: { fatos: ["ok", "", 42, null] } });
    expect(f.fatos).toEqual(["ok"]);
  });
});

describe("mesclarFatos", () => {
  it("acrescenta o novo no fim e ignora o repetido, mesmo com acento e caixa diferentes", () => {
    const antes = { ...FATOS_VAZIO, fatos: ["Não fecha por telefone."] };
    const depois = mesclarFatos(
      antes,
      { decisor: null, falaComDecisor: null, fatos: ["nao fecha por telefone", "Compra por indicação."] },
      AGORA,
    );
    expect(depois.fatos).toEqual(["Não fecha por telefone.", "Compra por indicação."]);
  });

  /**
   * A regra que salva o dossiê: a maioria das conversas não fala de quem
   * decide. Se o silêncio apagasse o decisor, o nome do dono achado num áudio
   * sumiria já na varredura do dia seguinte.
   */
  it("varredura sem decisor PRESERVA o decisor que já se sabia", () => {
    const antes = { ...FATOS_VAZIO, decisor: "Sérgio — dono", falaComDecisor: true };
    const depois = mesclarFatos(antes, { decisor: null, falaComDecisor: null, fatos: [] }, AGORA);
    expect(depois.decisor).toBe("Sérgio — dono");
    expect(depois.falaComDecisor).toBe(true);
  });

  it("decisor novo substitui o antigo — a conversa corrigiu quem manda", () => {
    const antes = { ...FATOS_VAZIO, decisor: "Atendente" };
    const depois = mesclarFatos(
      antes,
      { decisor: "Sérgio — dono", falaComDecisor: false, fatos: [] },
      AGORA,
    );
    expect(depois.decisor).toBe("Sérgio — dono");
    expect(depois.falaComDecisor).toBe(false);
  });

  it("estourando o teto quem sai é o mais ANTIGO, não o recém-descoberto", () => {
    const antes = { ...FATOS_VAZIO, fatos: Array.from({ length: MAX_FATOS }, (_, i) => `fato ${i}`) };
    const depois = mesclarFatos(antes, { decisor: null, falaComDecisor: null, fatos: ["fato novo"] }, AGORA);
    expect(depois.fatos).toHaveLength(MAX_FATOS);
    expect(depois.fatos).not.toContain("fato 0");
    expect(depois.fatos.at(-1)).toBe("fato novo");
  });

  it("carimba a hora da varredura", () => {
    expect(mesclarFatos(FATOS_VAZIO, { decisor: null, falaComDecisor: null, fatos: [] }, AGORA).atualizadoEm).toBe(
      AGORA,
    );
  });
});

describe("fatosIguais", () => {
  it("nada mudou → o chamador pula o UPDATE", () => {
    const a = { ...FATOS_VAZIO, decisor: "X", fatos: ["um"] };
    expect(fatosIguais(a, { ...a, atualizadoEm: "outro carimbo" })).toBe(true);
  });

  it("um fato a mais é diferente", () => {
    const a = { ...FATOS_VAZIO, fatos: ["um"] };
    expect(fatosIguais(a, { ...a, fatos: ["um", "dois"] })).toBe(false);
  });
});

/**
 * O CAMPO NÃO PODE SUJAR O DOSSIÊ DE PROSPECÇÃO. `extractExtras` mostra todo
 * custom_field cru na barra lateral; sem esta garantia, ligar os fatos daria
 * uma linha ilegível no painel de todo lead que já foi varrido.
 */
describe("convivência com o dossiê de prospecção", () => {
  const CAMPOS = {
    gancho_abertura: "Voltei aqui...",
    Cidade: "Lauro de Freitas",
    [FATOS_KEY]: serializarFatos({
      decisor: "Sérgio — dono",
      falaComDecisor: true,
      fatos: ["Não fecha por telefone."],
      atualizadoEm: AGORA,
    }),
  };

  it("os fatos não aparecem como linha crua do dossiê", () => {
    const chaves = extractExtras(CAMPOS).map(([k]) => k);
    expect(chaves).toEqual(["Cidade"]);
  });

  it("e não são confundidos com gancho de abertura", () => {
    expect(extractGanchos(CAMPOS)).toEqual(["Voltei aqui..."]);
  });

  it("o que foi serializado volta igual pela leitura", () => {
    expect(extractFatos(CAMPOS).decisor).toBe("Sérgio — dono");
    expect(extractFatos(CAMPOS).fatos).toEqual(["Não fecha por telefone."]);
  });
});
