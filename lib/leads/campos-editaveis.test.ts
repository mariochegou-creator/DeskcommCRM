import { describe, expect, it } from "vitest";

import {
  instagramDoLead,
  normalizarLink,
  patchDosLinks,
  siteDoLead,
} from "./campos-editaveis";

describe("leitura", () => {
  it("acha a chave que a lista genérica grava (maiúscula)", () => {
    expect(siteDoLead({ Site: "https://x.com" })).toBe("https://x.com");
    expect(instagramDoLead({ Instagram: "https://instagram.com/x" })).toBe(
      "https://instagram.com/x",
    );
  });

  it("acha a chave que o Kaptar grava (minúscula)", () => {
    expect(siteDoLead({ site: "https://x.com" })).toBe("https://x.com");
    expect(instagramDoLead({ instagram: "https://instagram.com/x" })).toBe(
      "https://instagram.com/x",
    );
  });

  it("sem chave nenhuma devolve vazio, não undefined", () => {
    expect(siteDoLead({})).toBe("");
    expect(siteDoLead(null)).toBe("");
    expect(instagramDoLead("lixo")).toBe("");
  });

  it("a anotação da varredura é conteúdo do campo, não ausência", () => {
    expect(siteDoLead({ Site: "não tem (conferido nos resultados da web)" })).toBe(
      "não tem (conferido nos resultados da web)",
    );
  });
});

describe("normalizarLink", () => {
  it("domínio sem protocolo vira link — senão a tela não o transforma em link", () => {
    expect(normalizarLink("nexoialocal.com.br", "site")).toBe("https://nexoialocal.com.br");
    expect(normalizarLink("instagram.com/fulano", "instagram")).toBe(
      "https://instagram.com/fulano",
    );
  });

  it("@ do Instagram vira o endereço do perfil", () => {
    expect(normalizarLink("@fulano.marcenaria", "instagram")).toBe(
      "https://www.instagram.com/fulano.marcenaria",
    );
  });

  it("frase não vira link", () => {
    expect(normalizarLink("não tem (conferido nos resultados da web)", "site")).toBe(
      "não tem (conferido nos resultados da web)",
    );
  });

  it("o que já é link passa intacto", () => {
    expect(normalizarLink("http://flsinucas.com/", "site")).toBe("http://flsinucas.com/");
  });
});

describe("patchDosLinks", () => {
  it("grava na chave que o lead já usa — nunca cria a segunda", () => {
    const patch = patchDosLinks(
      { site: "https://antigo.com" },
      { site: "https://novo.com", instagram: "" },
    );
    expect(patch).toEqual({ site: "https://novo.com" });
  });

  it("lead sem chave nenhuma nasce com a convenção desta base", () => {
    const patch = patchDosLinks({}, { site: "https://novo.com", instagram: "@x" });
    expect(patch).toEqual({
      Site: "https://novo.com",
      Instagram: "https://www.instagram.com/x",
    });
  });

  it("campo intocado não entra no patch", () => {
    expect(patchDosLinks({ Site: "https://x.com" }, { site: "https://x.com", instagram: "" })).toEqual(
      {},
    );
  });

  it("limpar o campo apaga a chave em vez de gravar vazio", () => {
    expect(patchDosLinks({ Site: "https://x.com" }, { site: "  ", instagram: "" })).toEqual({
      Site: null,
    });
  });

  it("'Tem site' acompanha, na forma que o lead já guarda", () => {
    expect(
      patchDosLinks(
        { Site: "não tem", "Tem site": "Não" },
        { site: "https://x.com", instagram: "" },
      ),
    ).toEqual({ Site: "https://x.com", "Tem site": "Sim" });

    expect(
      patchDosLinks({ site: "https://x.com", tem_site: true }, { site: "", instagram: "" }),
    ).toEqual({ site: null, tem_site: false });
  });

  it("'Tem site' que o lead não tem NÃO é inventado", () => {
    expect(patchDosLinks({ Site: "" }, { site: "https://x.com", instagram: "" })).toEqual({
      Site: "https://x.com",
    });
  });

  it("anotação não conta como presença", () => {
    expect(
      patchDosLinks({ Site: "https://x.com", "Tem site": "Sim" }, { site: "não tem", instagram: "" }),
    ).toEqual({ Site: "não tem", "Tem site": "Não" });
  });
});
