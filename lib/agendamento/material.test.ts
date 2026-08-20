import { describe, expect, it } from "vitest";

import {
  interpretarResposta,
  linkDoRoteiro,
  materialDeReserva,
  montarDossie,
  parseMaterial,
  type DadosDoLead,
} from "./material";
import type { Reuniao } from "./reuniao";

/** Quarta 12/08/2026, 14h Bahia. */
const REUNIAO: Reuniao = {
  tipo: "r1",
  em: "2026-08-12T17:00:00.000Z",
  data: "2026-08-12",
  hora: "14:00",
  criada_em: "2026-08-10T12:00:00.000Z",
  avisos: {},
};

const AGORA = new Date("2026-08-12T16:00:00.000Z");

const DADOS: DadosDoLead = {
  leadId: "lead-1",
  negocio: "Pizzaria Dom Luigi",
  contato: "Marcos",
  descricao: null,
  tags: ["pizzaria"],
  customFields: {
    gancho_abertura: "vi que vocês entregam até Feira",
    Dores: "não responde no horário de pico",
    Cidade: "Serrinha",
    "Google Maps": "https://maps.google.com/x",
  },
  notas: ["SDR ligou, dono pediu pra chamar de tarde"],
  conversa: [
    { de: "nos", texto: "oi Marcos, tudo bem?" },
    { de: "lead", texto: "opa, tudo" },
  ],
};

describe("interpretarResposta", () => {
  it("entende as várias formas de dizer sim", () => {
    for (const texto of ["sim", "Sim!", "SIM", "s", "manda sim", "pode mandar", "quero", "bora"]) {
      expect(interpretarResposta(texto), texto).toBe("sim");
    }
  });

  it("entende as várias formas de dizer não", () => {
    for (const texto of ["não", "nao", "n", "não precisa", "agora não", "deixa pra depois"]) {
      expect(interpretarResposta(texto), texto).toBe("nao");
    }
  });

  it("'pode deixar' é não, não é 'pode'", () => {
    expect(interpretarResposta("pode deixar")).toBe("nao");
    expect(interpretarResposta("pode")).toBe("sim");
  });

  it("sobrevive a emoji e pontuação", () => {
    expect(interpretarResposta("sim 👍")).toBe("sim");
    expect(interpretarResposta("Sim, por favor!!")).toBe("sim");
  });

  it("mensagem longa não é resposta — é assunto novo", () => {
    const texto =
      "ok então amanhã eu preciso que você veja aquele lance do boleto do cliente novo que entrou ontem";
    expect(interpretarResposta(texto)).toBeNull();
  });

  it("mensagem que não responde nada devolve null", () => {
    expect(interpretarResposta("que horas mesmo?")).toBeNull();
    expect(interpretarResposta("")).toBeNull();
    expect(interpretarResposta(null)).toBeNull();
  });
});

describe("montarDossie", () => {
  it("leva negócio, gancho, dossiê da prospecção, notas e conversa", () => {
    const texto = montarDossie(DADOS, REUNIAO);
    expect(texto).toContain("Pizzaria Dom Luigi");
    expect(texto).toContain("vi que vocês entregam até Feira");
    expect(texto).toContain("Dores: não responde no horário de pico");
    expect(texto).toContain("SDR ligou");
    expect(texto).toContain("Lead: opa, tudo");
    expect(texto).toContain("R1");
  });

  it("não quebra com card pelado", () => {
    const texto = montarDossie(
      { ...DADOS, negocio: null, contato: null, customFields: null, notas: [], conversa: [] },
      REUNIAO,
    );
    expect(texto).toContain("(card sem nome)");
    expect(texto).toContain("(sem nome no cadastro)");
  });
});

describe("parseMaterial", () => {
  const bom = JSON.stringify({
    resumo: "Pizzaria em Serrinha.",
    dor: "perde pedido no pico",
    gancho: "a entrega até Feira",
    perguntas: ["quantos pedidos por noite?", "quem responde o WhatsApp?"],
    situacao: ["quem atende?"],
    problema: ["já perdeu pedido?"],
    implicacao: ["quantos por semana?"],
    necessidade: ["o que mudava?"],
    proximo_passo: "mostrar o demo",
    atencao: null,
  });

  it("lê o JSON limpo", () => {
    const r = parseMaterial(bom, AGORA);
    expect(r?.resumo).toBe("Pizzaria em Serrinha.");
    expect(r?.perguntas).toHaveLength(2);
    expect(r?.atencao).toBeNull();
    expect(r?.gerado_em).toBe(AGORA.toISOString());
  });

  it("tolera a cerca de código", () => {
    expect(parseMaterial("```json\n" + bom + "\n```", AGORA)?.resumo).toBe("Pizzaria em Serrinha.");
  });

  it("devolve null sem o mínimo (resumo e ao menos uma pergunta)", () => {
    expect(parseMaterial("não consegui", AGORA)).toBeNull();
    expect(parseMaterial(JSON.stringify({ resumo: "x", perguntas: [] }), AGORA)).toBeNull();
    expect(parseMaterial(JSON.stringify({ perguntas: ["a"] }), AGORA)).toBeNull();
  });

  it("corta o excesso de perguntas — o WhatsApp leva 5", () => {
    const muitas = JSON.stringify({
      resumo: "x",
      perguntas: ["1", "2", "3", "4", "5", "6", "7"],
    });
    expect(parseMaterial(muitas, AGORA)?.perguntas).toHaveLength(5);
  });
});

describe("materialDeReserva", () => {
  it("usa o gancho e a cidade do card, e se marca como reserva", () => {
    const r = materialDeReserva(DADOS, AGORA);
    expect(r.reserva).toBe(true);
    expect(r.gancho).toBe("vi que vocês entregam até Feira");
    expect(r.resumo).toContain("Serrinha");
    expect(r.dor).toContain("não responde no horário de pico");
    expect(r.perguntas.length).toBeGreaterThanOrEqual(5);
  });

  it("funciona com card sem nada", () => {
    const r = materialDeReserva(
      { ...DADOS, negocio: null, customFields: null },
      AGORA,
    );
    expect(r.perguntas.length).toBeGreaterThanOrEqual(5);
    expect(r.dor).toContain("não consta");
  });
});

describe("linkDoRoteiro", () => {
  it("monta o link sem barra dobrada", () => {
    expect(linkDoRoteiro("https://crm.nexoialocal.com.br/", "abc")).toBe(
      "https://crm.nexoialocal.com.br/app/reuniao/abc",
    );
  });
});
