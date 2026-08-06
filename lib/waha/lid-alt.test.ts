import { describe, it, expect, vi } from "vitest";

// O ingest importa @/lib/audit, que puxa `server-only` e mata o vitest.
// Mesmo contorno do tests/unit/waha-outbound-espelhado.test.ts.
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { parseChatIdComAlt, type WahaPayload } from "@/lib/waha/ingest";

/** Payload mínimo com a WAMessageKey — o resto do envelope não importa aqui. */
function payloadCom(key: Record<string, unknown>): WahaPayload {
  return { _data: { key } } as WahaPayload;
}

describe("parseChatIdComAlt — o véu do LID", () => {
  it("chat @lid com remoteJidAlt de telefone resolve para o telefone real", () => {
    // Caso real de 05/08/2026: o 'oi' pro Hotel Rio Branco chegou assim, e sem
    // o alt o contato nasceu fantasma (sem telefone, sem lead, sem gancho).
    const p = payloadCom({ remoteJid: "77124778107040@lid", remoteJidAlt: "557335259222@s.whatsapp.net" });
    expect(parseChatIdComAlt("77124778107040@lid", p)).toEqual({
      kind: "phone",
      phone: "+557335259222",
      lid: null,
    });
  });

  it("chat @lid sem alt continua lid — funcional, só não casa com importados", () => {
    const p = payloadCom({ remoteJid: "77124778107040@lid" });
    expect(parseChatIdComAlt("77124778107040@lid", p)).toEqual({
      kind: "lid",
      phone: null,
      lid: "77124778107040",
    });
  });

  it("chat por telefone ignora o alt — não há véu a levantar", () => {
    const p = payloadCom({ remoteJidAlt: "999@s.whatsapp.net" });
    expect(parseChatIdComAlt("557799990000@c.us", p)).toEqual({
      kind: "phone",
      phone: "+557799990000",
      lid: null,
    });
  });

  it("alt que não é telefone (grupo/estranho) não substitui o lid", () => {
    const p = payloadCom({ remoteJidAlt: "12036302@g.us" });
    expect(parseChatIdComAlt("77124778107040@lid", p)).toEqual({
      kind: "lid",
      phone: null,
      lid: "77124778107040",
    });
  });
});
