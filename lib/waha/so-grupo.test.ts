import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { ehConexaoSoDeGrupo, type WahaEnvelope } from "@/lib/waha/ingest";

/**
 * A CONEXÃO DA ASSISTENTE É MUDA FORA DO GRUPO.
 *
 * O primeiro número apontado como voz da assistente foi um WhatsApp PESSOAL
 * emprestado — havia chip novo comprado, a compra deu errado, e o que existia
 * era o aparelho na mesa. Sem esta trava, mensagem de família naquele número
 * viraria contato e conversa no inbox do CRM, e o corpo cru ficaria escrito em
 * `webhook_events_log` mesmo se o inbox a ignorasse.
 *
 * Os dois lados importam igualmente: barrar o 1:1 (privacidade) e NÃO barrar o
 * grupo nem o ack (o produto). Um teste que só provasse o descarte deixaria
 * passar a versão que emudece a assistente por inteiro.
 */

const SESSAO = { organization_id: "org-1", waha_session_name: "org_a_assistente" };

/** Admin de mentira: devolve as settings que o teste mandar. */
function adminCom(settings: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { settings }, error: null }) }),
      }),
    }),
  } as never;
}

const ligado = { grupo_da_reuniao: { session_name: "org_a_assistente", so_grupo: true } };

function evento(p: Record<string, unknown>, event = "message"): WahaEnvelope {
  return { event, payload: p } as WahaEnvelope;
}

describe("ehConexaoSoDeGrupo", () => {
  it("barra o 1:1 que CHEGA na conexão da assistente", async () => {
    expect(await ehConexaoSoDeGrupo(adminCom(ligado), SESSAO, evento({ from: "5511999@c.us" }))).toBe(
      true,
    );
  });

  it("barra também o que SAI do aparelho — é lá que mora a conversa pessoal", async () => {
    expect(
      await ehConexaoSoDeGrupo(adminCom(ligado), SESSAO, evento({ fromMe: true, to: "5511999@c.us" })),
    ).toBe(true);
  });

  it("DEIXA passar o grupo — é o único trabalho dela", async () => {
    expect(
      await ehConexaoSoDeGrupo(adminCom(ligado), SESSAO, evento({ from: "12036@g.us" })),
    ).toBe(false);
  });

  it("DEIXA passar o ack, senão a fala da assistente perde entregue/lido", async () => {
    expect(
      await ehConexaoSoDeGrupo(adminCom(ligado), SESSAO, evento({ from: "5511999@c.us" }, "message.ack")),
    ).toBe(false);
  });

  it("não toca em OUTRA conexão: o número que prospecta continua entrando", async () => {
    const outra = { organization_id: "org-1", waha_session_name: "org_a_prospeccao" };
    expect(await ehConexaoSoDeGrupo(adminCom(ligado), outra, evento({ from: "5511999@c.us" }))).toBe(
      false,
    );
  });

  it("sem nada configurado, nada muda", async () => {
    expect(await ehConexaoSoDeGrupo(adminCom(null), SESSAO, evento({ from: "5511999@c.us" }))).toBe(
      false,
    );
  });

  it("`so_grupo: false` libera o 1:1 — o caso do chip dedicado, onde o lead pode responder no privado", async () => {
    const desligado = {
      grupo_da_reuniao: { session_name: "org_a_assistente", so_grupo: false },
    };
    expect(
      await ehConexaoSoDeGrupo(adminCom(desligado), SESSAO, evento({ from: "5511999@c.us" })),
    ).toBe(false);
  });

  it("apontar a conexão sem dizer nada já barra: o padrão protege", async () => {
    const soONome = { grupo_da_reuniao: { session_name: "org_a_assistente" } };
    expect(
      await ehConexaoSoDeGrupo(adminCom(soONome), SESSAO, evento({ from: "5511999@c.us" })),
    ).toBe(true);
  });
});
