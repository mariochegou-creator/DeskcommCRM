import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { dispatchWahaEvent, resolveOutboundChatId, type WahaEnvelope } from "@/lib/waha/ingest";

/**
 * O QUE O OPERADOR ENVIA TAMBÉM É A CONVERSA.
 *
 * Bug real, medido no banco de produção em 04/08/2026: 208 mensagens gravadas,
 * TODAS inbound. Nenhuma linha outbound existia. Ao mesmo tempo,
 * `webhook_events_log` provava que 368 eventos `message.any` com `fromMe=true`
 * tinham chegado, com assinatura válida. O ingest recebia e jogava fora.
 *
 * A causa: `handleOutboundFromUserPhone` lia o destinatário de `p.to`. O engine
 * NOWEB **não manda `to`** — para `fromMe` ele põe o outro lado do chat em
 * `from` (espelhado em `_data.key.remoteJid`). Então `p.to ?? ""` virava
 * `parseChatId("")` → `group` → `return` mudo. Sem erro, sem log, sem evento: o
 * inbox mostrava só o que o cliente escreveu, nunca a resposta.
 *
 * ⚠️ Os testes entram por `dispatchWahaEvent` (o caminho do webhook real) e os
 * payloads abaixo são cópias fiéis de `webhook_events_log`, não invenções — um
 * teste com payload idealizado teria passado com o código quebrado.
 */

interface Chamadas {
  rpc: Array<{ fn: string; args: Record<string, unknown> }>;
  insercoes: Array<{ tabela: string; row: Record<string, unknown> }>;
  buscasPorExternalId: string[][];
}

/** Chain builder que responde a qualquer combinação de .select/.eq/.in/.limit. */
function encadeavel(resultado: unknown, aoFiltrarIn?: (vals: string[]) => void) {
  const q: Record<string, unknown> = {};
  const devolve = () => q;
  q.select = devolve;
  q.eq = devolve;
  q.order = devolve;
  q.limit = devolve;
  q.in = (_col: string, vals: string[]) => {
    aoFiltrarIn?.(vals);
    return q;
  };
  q.maybeSingle = async () => resultado;
  q.single = async () => resultado;
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(resultado).then(res, rej);
  return q;
}

function adminFalso(opcoes: { jaGravada?: { id: string } | null } = {}) {
  const chamadas: Chamadas = { rpc: [], insercoes: [], buscasPorExternalId: [] };
  const jaGravada = opcoes.jaGravada ?? null;

  const admin = {
    from: (tabela: string) => ({
      select: () =>
        encadeavel({ data: jaGravada, error: null }, (vals) =>
          chamadas.buscasPorExternalId.push(vals),
        ),
      insert: (row: Record<string, unknown>) => {
        chamadas.insercoes.push({ tabela, row });
        return encadeavel({ data: { id: "msg-1" }, error: null });
      },
      update: () => encadeavel({ data: null, error: null }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      chamadas.rpc.push({ fn, args });
      if (fn === "fn_upsert_wa_contact") return { data: "contato-1", error: null };
      if (fn === "fn_upsert_wa_conversation") return { data: "conversa-1", error: null };
      return { data: null, error: null };
    },
  };

  return { admin, chamadas };
}

const SESSAO = { id: "sessao-1", organization_id: "org-1" };

/** Cópia fiel de um evento real: NOWEB, texto, sem `to`. */
const NOWEB_TEXTO: WahaEnvelope = {
  event: "message.any",
  session: "org_22db0b3c_7b08ee",
  me: { id: "557799325325@c.us", lid: "151084416901321@lid" },
  payload: {
    id: "true_246093354901631@lid_3EB0C5CCCBAFBB2A26110C",
    ack: 1,
    body: "ola",
    from: "246093354901631@lid",
    fromMe: true,
    timestamp: 1_785_876_012,
    _data: {
      key: {
        id: "3EB0C5CCCBAFBB2A26110C",
        fromMe: true,
        remoteJid: "246093354901631@lid",
      },
      message: { conversation: "ola" },
    },
  },
};

/** Cópia fiel de um evento real: NOWEB, áudio enviado, body null. */
const NOWEB_AUDIO: WahaEnvelope = {
  event: "message.any",
  session: "org_22db0b3c_7b08ee",
  me: { id: "557799325325@c.us", lid: "151084416901321@lid" },
  payload: {
    id: "true_63853329145912@lid_A575238806AB81F0D124956E444E9C25",
    ack: 1,
    body: null as unknown as undefined,
    from: "63853329145912@lid",
    fromMe: true,
    hasMedia: true,
    media: { url: "http://waha:3000/api/files/x.oga", mimetype: "audio/ogg; codecs=opus" },
    _data: {
      key: { id: "A575238806AB81F0D124956E444E9C25", fromMe: true, remoteJid: "63853329145912@lid" },
      message: { audioMessage: { ptt: true } },
    },
  },
};

function mensagemInserida(chamadas: Chamadas) {
  return chamadas.insercoes.find((i) => i.tabela === "messages")?.row;
}

describe("resolveOutboundChatId", () => {
  it("usa `from` quando o NOWEB não manda `to`", () => {
    expect(resolveOutboundChatId(NOWEB_TEXTO.payload!, NOWEB_TEXTO.me)).toBe(
      "246093354901631@lid",
    );
  });

  it("prefere `to` no WEBJS e NUNCA devolve o número da própria sessão", () => {
    // No WEBJS o `from` de uma fromMe é o operador. Se a ordem invertesse, o CRM
    // criaria um contato do próprio número e abriria conversa consigo mesmo.
    const resolvido = resolveOutboundChatId(
      { id: "x", from: "557799325325@c.us", to: "5511988887777@c.us", fromMe: true },
      { id: "557799325325@c.us", lid: "151084416901321@lid" },
    );
    expect(resolvido).toBe("5511988887777@c.us");
  });

  it("devolve null quando o único candidato é a própria sessão", () => {
    expect(
      resolveOutboundChatId(
        { id: "x", from: "151084416901321@lid", fromMe: true },
        { id: "557799325325@c.us", lid: "151084416901321@lid" },
      ),
    ).toBeNull();
  });
});

describe("mensagem enviada pelo WhatsApp Web entra no histórico", () => {
  it("grava a mensagem de texto como outbound do contato certo", async () => {
    const { admin, chamadas } = adminFalso();

    await dispatchWahaEvent(admin as never, SESSAO as never, NOWEB_TEXTO, "req-1");

    const linha = mensagemInserida(chamadas);
    expect(linha, "nada foi inserido — a mensagem enviada sumiu de novo").toBeDefined();
    expect(linha).toMatchObject({
      direction: "outbound",
      body: "ola",
      type: "text",
      sent_via: "external_device",
      conversation_id: "conversa-1",
      contact_id: "contato-1",
    });
  });

  it("resolve o contato pelo outro lado do chat, não pelo próprio número", async () => {
    const { admin, chamadas } = adminFalso();
    await dispatchWahaEvent(admin as never, SESSAO as never, NOWEB_TEXTO, "req-1");

    const upsert = chamadas.rpc.find((c) => c.fn === "fn_upsert_wa_contact");
    expect(upsert).toBeDefined();
    expect(upsert!.args.p_chat_id).toBe("246093354901631@lid");
    expect(upsert!.args.p_lid).toBe("246093354901631");
    // O número da sessão jamais pode virar contato.
    expect(JSON.stringify(upsert!.args)).not.toContain("557799325325");
    expect(JSON.stringify(upsert!.args)).not.toContain("151084416901321");
  });

  it("NÃO batiza o contato com o nome de quem enviou", async () => {
    // Regressão medida em produção: `notifyName`/`pushName` de uma mensagem
    // fromMe é o nome de QUEM ENVIOU (nós), não o do destinatário. Repassá-lo ao
    // upsert batizou 48 contatos com "David wilkerson Nexoia" e o inbox virou
    // uma lista de conversas com o próprio operador.
    const { admin, chamadas } = adminFalso();
    const comPushNameProprio: WahaEnvelope = {
      ...NOWEB_TEXTO,
      payload: {
        ...NOWEB_TEXTO.payload!,
        _data: { ...NOWEB_TEXTO.payload!._data, pushName: "David wilkerson Nexoia" },
      },
    };

    await dispatchWahaEvent(admin as never, SESSAO as never, comPushNameProprio, "req-1");

    const upsert = chamadas.rpc.find((c) => c.fn === "fn_upsert_wa_contact")!;
    expect(upsert.args.p_notify).toBeNull();
    expect(JSON.stringify(upsert.args)).not.toContain("David wilkerson Nexoia");
    // CONTROLE: a mensagem ainda entra — o conserto é não dar nome, não descartar.
    expect(mensagemInserida(chamadas)).toBeDefined();
  });

  it("carimba a conversa como outbound (senão a lista do inbox não sobe)", async () => {
    const { admin, chamadas } = adminFalso();
    await dispatchWahaEvent(admin as never, SESSAO as never, NOWEB_TEXTO, "req-1");

    const carimbo = chamadas.rpc.find((c) => c.fn === "fn_mark_conversation_message");
    expect(carimbo).toBeDefined();
    expect(carimbo!.args.p_direction).toBe("outbound");
    expect(carimbo!.args.p_preview).toBe("ola");
  });

  it("grava áudio enviado mesmo com body null", async () => {
    // A guarda de conteúdo (`!body && !mediaUrl && !hasMedia`) é o que separa
    // mensagem de verdade de evento vazio de presença — áudio tem que passar.
    const { admin, chamadas } = adminFalso();
    await dispatchWahaEvent(admin as never, SESSAO as never, NOWEB_AUDIO, "req-1");

    const linha = mensagemInserida(chamadas);
    expect(linha, "o áudio enviado foi descartado").toBeDefined();
    expect(linha).toMatchObject({ direction: "outbound", type: "audio" });
    expect(linha!.media_url).toBe("http://waha:3000/api/files/x.oga");
  });
});

describe("eco do próprio composer não duplica", () => {
  it("não insere quando já existe linha com aquele id", async () => {
    // O CRM grava o id CRU (`3EB0…`) na resposta do envio; o webhook devolve o
    // COMPLETO (`true_{chat}_3EB0…`). Sem procurar pelas duas formas, toda
    // mensagem enviada pelo composer apareceria duas vezes no thread.
    const { admin, chamadas } = adminFalso({ jaGravada: { id: "linha-do-composer" } });

    await dispatchWahaEvent(admin as never, SESSAO as never, NOWEB_TEXTO, "req-1");

    expect(mensagemInserida(chamadas)).toBeUndefined();
    expect(chamadas.buscasPorExternalId[0]).toEqual([
      "true_246093354901631@lid_3EB0C5CCCBAFBB2A26110C",
      "3EB0C5CCCBAFBB2A26110C",
    ]);
  });

  it("CONTROLE: sem linha prévia, a mesma mensagem é inserida", async () => {
    // Sem este controle o teste acima passaria mesmo se o ingest tivesse voltado
    // a descartar tudo — provaria a ausência do insert, não a deduplicação.
    const { admin, chamadas } = adminFalso({ jaGravada: null });
    await dispatchWahaEvent(admin as never, SESSAO as never, NOWEB_TEXTO, "req-1");
    expect(mensagemInserida(chamadas)).toBeDefined();
  });
});
