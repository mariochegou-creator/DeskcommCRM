import { describe, it, expect } from "vitest";
import { telLink, formatarTelefone } from "./telefone";

describe("telLink", () => {
  it("disca celular com DDI", () => {
    expect(telLink("+5573991346237")).toBe("tel:+5573991346237");
  });

  it("disca fixo com DDI — o caso dos 27 leads sem WhatsApp", () => {
    expect(telLink("+557332831835")).toBe("tel:+557332831835");
  });

  it("assume Brasil quando falta o DDI", () => {
    expect(telLink("7332831835")).toBe("tel:+557332831835");
    expect(telLink("73991346237")).toBe("tel:+5573991346237");
  });

  it("ignora formatação", () => {
    expect(telLink("(73) 3283-1835")).toBe("tel:+557332831835");
  });

  // A diferença deliberada em relação ao whatsappLink.
  it("ACEITA central de atendimento, que o WhatsApp recusa", () => {
    expect(telLink("40030123")).toBe("tel:40030123");
    expect(telLink("0800 200 4336")).toBe("tel:08002004336");
    expect(telLink("+5508002004336")).toBe("tel:08002004336");
  });

  it("recusa número sem DDD", () => {
    expect(telLink("991981763")).toBeNull();
  });

  it("recusa vazio e lixo de digitação", () => {
    expect(telLink(null)).toBeNull();
    expect(telLink("")).toBeNull();
    expect(telLink("+5573991346237999999")).toBeNull();
  });
});

describe("formatarTelefone", () => {
  it("formata celular", () => {
    expect(formatarTelefone("+5573991346237")).toBe("(73) 99134-6237");
  });

  it("formata fixo", () => {
    expect(formatarTelefone("+557332831835")).toBe("(73) 3283-1835");
  });

  it("formata central", () => {
    expect(formatarTelefone("40030123")).toBe("4003-0123");
  });

  it("devolve como veio o que não reconhece", () => {
    expect(formatarTelefone("991981763")).toBe("991981763");
  });

  it("devolve null sem telefone", () => {
    expect(formatarTelefone(null)).toBeNull();
  });
});
