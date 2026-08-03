import { describe, it, expect } from "vitest";
import { whatsappLink } from "./whatsapp";

describe("whatsappLink", () => {
  it("monta o link a partir do E.164 do contato", () => {
    expect(whatsappLink("+5573991346237")).toBe("https://wa.me/5573991346237");
  });

  it("aceita fixo com DDD", () => {
    expect(whatsappLink("+557332831835")).toBe("https://wa.me/557332831835");
  });

  it("ignora formatação", () => {
    expect(whatsappLink("+55 (73) 99134-6237")).toBe("https://wa.me/5573991346237");
  });

  it("devolve null sem telefone", () => {
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink(undefined)).toBeNull();
    expect(whatsappLink("")).toBeNull();
  });

  // Os três casos que a lista de prospecção realmente produziu.
  it("recusa número sem DDD", () => {
    expect(whatsappLink("991981763")).toBeNull();
  });

  it("recusa central de atendimento", () => {
    expect(whatsappLink("40030123")).toBeNull();
    expect(whatsappLink("+554003012399")).toBeNull();
    expect(whatsappLink("+5508002004336")).toBeNull();
  });

  it("recusa lixo de digitação", () => {
    expect(whatsappLink("+5573991346237999999")).toBeNull();
  });
});
