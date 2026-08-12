import { describe, it, expect, vi } from "vitest";

// O ingest importa @/lib/audit, que puxa `server-only` e mata o vitest.
// Mesmo contorno do lid-alt.test.ts.
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { resolveMessageType, textoDosVCards, type WahaPayload } from "@/lib/waha/ingest";
import { analisarVCard } from "@/lib/contacts/vcard";

const VCARD_TACO =
  "BEGIN:VCARD\nVERSION:3.0\nN:Ouro;Hotel Taco De;;;\nFN:Hotel Taco De Ouro\n" +
  "item1.TEL;waid=556384671168:+55 63 8467-1168\nitem1.X-ABLabel:Celular\nEND:VCARD";

/**
 * O payload REAL do WAHA 2026.7.2 (NOWEB) do contato que o David compartilhou
 * em 12/08/2026 — copiado de webhook_events_log.raw_body. Repare em `body:
 * null`, `hasMedia: false` e `media: null`: é por isso que a guarda de conteúdo
 * descartava a mensagem como `skip:sem_conteudo` e o cartão nunca chegava ao
 * inbox, embora aparecesse normalmente no WhatsApp Web.
 */
const PAYLOAD_REAL = {
  id: "false_175707380551730@lid_A512E530D0FC84278D8AAE4FC67AD4B4",
  timestamp: 1786566968,
  from: "175707380551730@lid",
  fromMe: false,
  body: null,
  hasMedia: false,
  media: null,
  ack: 2,
  vCards: [VCARD_TACO],
  _data: {
    key: { remoteJid: "175707380551730@lid", remoteJidAlt: "557798980343@s.whatsapp.net" },
    pushName: "David wilkerson Nexoia",
    message: {
      contactMessage: { displayName: "Hotel Taco De Ouro", vcard: VCARD_TACO },
      messageContextInfo: { deviceListMetadataVersion: 2 },
    },
  },
} as unknown as WahaPayload;

describe("contato compartilhado — o vCard que não vem no body", () => {
  it("acha o cartão no payload real do NOWEB", () => {
    expect(textoDosVCards(PAYLOAD_REAL)).toBe(VCARD_TACO);
  });

  it("o tipo resolve para contact (o NOWEB não manda `type`)", () => {
    expect(resolveMessageType(PAYLOAD_REAL)).toBe("contact");
  });

  it("o texto achado é o que a bolha sabe ler: nome e telefone do waid", () => {
    const [cartao] = analisarVCard(textoDosVCards(PAYLOAD_REAL));
    expect(cartao).toEqual({
      nome: "Hotel Taco De Ouro",
      telefone: "+556384671168",
      telefoneCru: "+55 63 8467-1168",
    });
  });

  it("cai no _data.message quando o topo não trouxe vCards", () => {
    const semTopo = { ...PAYLOAD_REAL, vCards: undefined } as WahaPayload;
    expect(textoDosVCards(semTopo)).toBe(VCARD_TACO);
    expect(resolveMessageType(semTopo)).toBe("contact");
  });

  it("vários cartões numa mensagem só viram vários itens, não o primeiro", () => {
    const outro = VCARD_TACO.replace(/Hotel Taco De Ouro/g, "Posto Central").replace(
      "556384671168",
      "556399990000",
    );
    const varios = { ...PAYLOAD_REAL, vCards: [VCARD_TACO, outro] } as WahaPayload;
    expect(analisarVCard(textoDosVCards(varios)).map((c) => c.telefone)).toEqual([
      "+556384671168",
      "+556399990000",
    ]);
  });

  it("evento sem cartão nenhum continua sem conteúdo (read-receipt, presence)", () => {
    expect(textoDosVCards({ id: "x", from: "5577@c.us" } as WahaPayload)).toBeNull();
    expect(textoDosVCards({ vCards: [] } as unknown as WahaPayload)).toBeNull();
    expect(textoDosVCards({ vCards: ["lixo sem cartão"] } as unknown as WahaPayload)).toBeNull();
  });
});
