import { describe, it, expect } from "vitest";

import {
  KaptarArquivoInvalido,
  camposPersonalizados,
  classificarPresenca,
  extrairPlaceId,
  parseDataBr,
  parseDecimal,
  parseKaptarCsv,
  resumoDeVenda,
} from "@/lib/import/kaptar";

const CABECALHO =
  '"Nome";"Categoria";"Telefone";"E-mail";"Site";"Tem site";"Instagram";"Tem Instagram";' +
  '"Cidade";"Estado";"Status";"Tipo";"Score";"Avaliação";"Nº avaliações";"Fonte";"Google Maps";"Criado em"';

/** Linhas copiadas do export real (kaptar-ativos.csv), inclusive as tortas. */
const LINHA_LIMPA =
  '"Clínica Lavie • Harmonização Facial e Corporal";"Esteticista";"(77) 99904-8626";"";"";"Não";"";"Não";' +
  '"Luís Eduardo Magalhães";"BA";"Novo";"Sem presença";"87";"5";"19";"google_maps";' +
  '"https://www.google.com/maps/place/?q=place_id:ChIJk7FqsrdxSpMRMErXeCyiYV0";"27/07/2026"';

/** O Kaptar pôs o Instagram na coluna Site e ainda marcou "Tem site: Sim". */
const LINHA_SITE_E_INSTAGRAM_TROCADOS =
  '"Clinica de Estética Vall Piress";"Esteticista";"(77) 99950-1602";"";' +
  '"https://www.instagram.com/vallpiressestetica/";"Sim";"";"Não";' +
  '"Luís Eduardo Magalhães";"BA";"Novo";"Presença parcial";"75";"4.8";"31";"google_maps";' +
  '"https://www.google.com/maps/place/?q=place_id:ChIJvdkncyBxSpMRDoObnNxYmz8";"27/07/2026"';

const BOM = "﻿";

function csv(...linhas: string[]): string {
  return [CABECALHO, ...linhas].join("\n");
}

/**
 * `itens[0]` sob noUncheckedIndexedAccess é `T | undefined`. Falhar aqui com
 * mensagem própria diz mais do que um "cannot read property of undefined" a
 * dez linhas de distância.
 */
function primeiro<T>(itens: T[], oQue: string): T {
  const item = itens[0];
  if (item === undefined) throw new Error(`esperava ao menos ${oQue}, veio lista vazia`);
  return item;
}

describe("parseKaptarCsv — o arquivo como o Kaptar entrega", () => {
  it("lê o export real: separador ; e BOM na frente do cabeçalho", () => {
    const { leads, rejeitadas, colunasFaltando } = parseKaptarCsv(BOM + csv(LINHA_LIMPA));

    expect(rejeitadas).toEqual([]);
    expect(colunasFaltando).toEqual([]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      nome: "Clínica Lavie • Harmonização Facial e Corporal",
      telefone: "+5577999048626",
      placeId: "ChIJk7FqsrdxSpMRMErXeCyiYV0",
      categoria: "Esteticista",
      cidade: "Luís Eduardo Magalhães",
      score: 87,
      avaliacao: 5,
      numAvaliacoes: 19,
      criadoEm: "2026-07-27",
      temSite: false,
    });
  });

  it("sem o BOM removido o nome sairia vazio — é a falha silenciosa que o parser evita", () => {
    const { leads } = parseKaptarCsv(BOM + csv(LINHA_LIMPA));
    const lead = primeiro(leads, "um lead");
    expect(lead.nome).not.toBe("");
    expect(Object.keys(lead)).not.toContain(`${BOM}Nome`);
  });

  it("e-mail vazio vira null, não string vazia (o CHECK contacts_email_format recusa \"\")", () => {
    const { leads } = parseKaptarCsv(csv(LINHA_LIMPA));
    expect(primeiro(leads, "um lead").email).toBeNull();
  });

  it("aceita separador vírgula, caso a planilha tenha sido reaberta no Excel", () => {
    const semAspas = CABECALHO.replace(/";"/g, ",").replace(/"/g, "");
    const linha = "Bar do Zé,Bar,(77) 99900-1122,,,Não,,Não,LEM,BA,Novo,Sem presença,60,4.2,8,google_maps,,27/07/2026";
    const { leads } = parseKaptarCsv([semAspas, linha].join("\n"));
    expect(leads[0]).toMatchObject({ nome: "Bar do Zé", telefone: "+5577999001122", score: 60 });
  });
});

describe("parseKaptarCsv — linhas que não viram lead", () => {
  it("sem telefone é rejeitada com a linha da planilha", () => {
    const semTelefone = LINHA_LIMPA.replace('"(77) 99904-8626"', '""');
    const { leads, rejeitadas } = parseKaptarCsv(csv(semTelefone));
    expect(leads).toEqual([]);
    expect(rejeitadas).toEqual([{ linha: 2, nome: expect.stringContaining("Lavie"), motivo: "Sem telefone." }]);
  });

  it("telefone impossível é rejeitado com o valor original à vista", () => {
    const torto = LINHA_LIMPA.replace('"(77) 99904-8626"', '"123"');
    const { rejeitadas } = parseKaptarCsv(csv(torto));
    expect(primeiro(rejeitadas, "uma rejeitada").motivo).toBe('Telefone inválido: "123".');
  });

  it("o mesmo local repetido no próprio arquivo entra uma vez só", () => {
    const { leads, rejeitadas } = parseKaptarCsv(csv(LINHA_LIMPA, LINHA_LIMPA));
    expect(leads).toHaveLength(1);
    expect(primeiro(rejeitadas, "uma rejeitada").motivo).toContain("Repetido dentro do próprio arquivo");
  });

  it("arquivo que não é do Kaptar falha inteiro, em vez de importar lixo", () => {
    expect(() => parseKaptarCsv("Coluna A;Coluna B\n1;2")).toThrow(KaptarArquivoInvalido);
    expect(() => parseKaptarCsv("Coluna A;Coluna B\n1;2")).toThrow(/faltam as colunas Nome, Telefone/);
  });

  it("arquivo vazio falha inteiro", () => {
    expect(() => parseKaptarCsv("   ")).toThrow(KaptarArquivoInvalido);
  });
});

describe("classificarPresenca — a coluna do Kaptar mente", () => {
  it('Instagram na coluna Site com "Tem site: Sim" NÃO conta como site', () => {
    const { leads } = parseKaptarCsv(csv(LINHA_SITE_E_INSTAGRAM_TROCADOS));
    const lead = primeiro(leads, "um lead");
    expect(lead.temSite).toBe(false);
    expect(lead.site).toBeNull();
    expect(lead.instagram).toBe("https://www.instagram.com/vallpiressestetica/");
  });

  it("site de verdade continua contando como site", () => {
    expect(classificarPresenca("https://clinicalavie.com.br", null)).toEqual({
      site: "https://clinicalavie.com.br",
      instagram: null,
      temSite: true,
    });
  });

  it("sem nada é sem presença", () => {
    expect(classificarPresenca("", "")).toEqual({ site: null, instagram: null, temSite: false });
  });
});

describe("números e datas", () => {
  it("decimal com ponto (o que o Kaptar emite)", () => expect(parseDecimal("4.6")).toBe(4.6));
  it("decimal com vírgula (planilha reaberta no Excel pt-BR)", () => expect(parseDecimal("4,6")).toBe(4.6));
  it("vazio vira null em vez de zero — nota 0 e nota ausente não são a mesma coisa", () => {
    expect(parseDecimal("")).toBeNull();
  });
  it("data BR vira ISO", () => expect(parseDataBr("27/07/2026")).toBe("2026-07-27"));
  it("data impossível é rejeitada em vez de normalizada em silêncio", () => {
    expect(parseDataBr("31/02/2026")).toBeNull();
  });
  it("formato desconhecido vira null", () => expect(parseDataBr("2026-07-27")).toBeNull());
});

describe("extrairPlaceId", () => {
  it("pega o place_id da URL do Google Maps", () => {
    expect(extrairPlaceId("https://www.google.com/maps/place/?q=place_id:ChIJk7FqsrdxSpMRMErXeCyiYV0")).toBe(
      "ChIJk7FqsrdxSpMRMErXeCyiYV0",
    );
  });
  it("URL sem place_id vira null — o lead entra, só sem chave de dedup", () => {
    expect(extrairPlaceId("https://www.google.com/maps")).toBeNull();
    expect(extrairPlaceId("")).toBeNull();
  });
});

describe("o que chega no CRM", () => {
  it("o resumo repete o que você escrevia à mão", () => {
    const { leads } = parseKaptarCsv(csv(LINHA_LIMPA));
    expect(resumoDeVenda(primeiro(leads, "um lead"))).toBe("sem site · 19 avaliações, nota 5 · score 87");
  });

  it("negócio só com Instagram aparece como tal no resumo", () => {
    const { leads } = parseKaptarCsv(csv(LINHA_SITE_E_INSTAGRAM_TROCADOS));
    expect(resumoDeVenda(primeiro(leads, "um lead"))).toContain("sem site · só Instagram");
  });

  it("o contexto vira campo filtrável, não texto solto", () => {
    const { leads } = parseKaptarCsv(csv(LINHA_LIMPA));
    expect(camposPersonalizados(primeiro(leads, "um lead"))).toMatchObject({
      categoria: "Esteticista",
      cidade: "Luís Eduardo Magalhães",
      estado: "BA",
      score_kaptar: 87,
      avaliacao_google: 5,
      num_avaliacoes: 19,
      tem_site: false,
      place_id: "ChIJk7FqsrdxSpMRMErXeCyiYV0",
    });
  });
});
