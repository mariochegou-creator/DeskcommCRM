import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { garantirUmCartaoPorNumero } from "@/lib/waha/um-numero-uma-conexao";

/**
 * UM NÚMERO, UMA CONEXÃO — a trava que impede o mesmo WhatsApp de virar dois
 * cartões e partir a conversa do lead em dois lugares (o estrago de 12/08/2026:
 * 2 números, 4 sessões, 75 contatos com a conversa dividida).
 *
 * O que estes testes prendem, e que já custou caro quando faltou:
 *   - a irmã é achada pelo `me.id` do WAHA, não só pela coluna `phone_number` —
 *     é justamente a segunda sessão que fica com a coluna VAZIA;
 *   - o aparelho é solto no WAHA ANTES de arquivar: mensagem que chega em canal
 *     arquivado é descartada sem erro visível;
 *   - número que só CAIU e voltou não vira cartão novo — o cartão de sempre
 *     assume a sessão (pedido do Mario, 12/08/2026).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const NUMERO = "557799325325";

type Linha = {
  id: string;
  waha_session_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  created_at: string;
};

const cartaoAntigo: Linha = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  waha_session_name: "org_teste_antigo",
  display_name: "Mario — (77) 9932-5325",
  phone_number: NUMERO,
  status: "WORKING",
  created_at: "2026-08-01T00:00:00.000Z",
};

const cartaoNovo: Linha = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  waha_session_name: "org_teste_novo",
  display_name: null,
  // O buraco de verdade: a segunda sessão do mesmo número fica SEM telefone.
  phone_number: null,
  status: "WORKING",
  created_at: "2026-08-02T00:00:00.000Z",
};

/** Registra a ordem das ações — é ela que evita mensagem descartada. */
function montarMocks(linhas: Linha[]) {
  const ordem: string[] = [];
  const rpc = vi.fn(async (nome: string) => {
    ordem.push(`rpc:${nome}`);
    return { data: { conversas_fundidas: 2, conversas_movidas: 1 }, error: null };
  });
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: async () => ({ data: linhas, error: null }),
          }),
        }),
      }),
    }),
    rpc,
  } as never);

  const waha = {
    listSessions: vi.fn(async () =>
      linhas.map((l) => ({ name: l.waha_session_name, status: "WORKING", me: { id: `${NUMERO}@c.us` } })),
    ),
    getSessionQr: vi.fn(async () => ({ status: "WORKING" })),
    deleteSession: vi.fn(async (nome: string) => {
      ordem.push(`waha:delete:${nome}`);
    }),
  };
  return { rpc, waha, ordem };
}

describe("garantirUmCartaoPorNumero", () => {
  beforeEach(() => vi.clearAllMocks());

  it("um cartão só na org → não mexe em nada", async () => {
    const { rpc, waha } = montarMocks([cartaoAntigo]);
    const r = await garantirUmCartaoPorNumero({
      orgId: ORG,
      sessionId: cartaoAntigo.id,
      numero: NUMERO,
      waha: waha as never,
    });
    expect(r).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(waha.deleteSession).not.toHaveBeenCalled();
  });

  it("mesmo WhatsApp escaneado num segundo cartão → o segundo sai, e o aparelho é solto ANTES do merge", async () => {
    const { rpc, waha, ordem } = montarMocks([cartaoAntigo, cartaoNovo]);
    const r = await garantirUmCartaoPorNumero({
      orgId: ORG,
      sessionId: cartaoNovo.id,
      numero: NUMERO,
      waha: waha as never,
    });

    expect(r?.acao).toBe("repetida_removida");
    expect(r?.cartao_id).toBe(cartaoAntigo.id);
    expect(r?.este_cartao_saiu).toBe(true);
    expect(ordem).toEqual([`waha:delete:${cartaoNovo.waha_session_name}`, "rpc:fn_merge_channel_session"]);
    expect(rpc).toHaveBeenCalledWith("fn_merge_channel_session", {
      p_org: ORG,
      p_from: cartaoNovo.id,
      p_into: cartaoAntigo.id,
    });
  });

  it("acha a irmã escondida pelo me.id do WAHA — a coluna phone_number dela está vazia", async () => {
    const { rpc, waha } = montarMocks([cartaoAntigo, cartaoNovo]);
    const r = await garantirUmCartaoPorNumero({
      orgId: ORG,
      sessionId: cartaoAntigo.id,
      numero: NUMERO,
      waha: waha as never,
    });

    // Olhando só o banco, o cartão antigo pareceria sozinho no número.
    expect(waha.listSessions).toHaveBeenCalled();
    expect(r?.este_cartao_saiu).toBe(false);
    expect(r?.cartao_id).toBe(cartaoAntigo.id);
    expect(waha.deleteSession).toHaveBeenCalledWith(cartaoNovo.waha_session_name);
    expect(rpc).toHaveBeenCalledWith("fn_merge_channel_session", {
      p_org: ORG,
      p_from: cartaoNovo.id,
      p_into: cartaoAntigo.id,
    });
  });

  it("número que só caiu e foi religado pelo '+' → o cartão de sempre assume, não nasce cartão novo", async () => {
    const { rpc, waha } = montarMocks([{ ...cartaoAntigo, status: "FAILED" }, cartaoNovo]);
    waha.getSessionQr = vi.fn(async () => ({ status: "FAILED" }));

    const r = await garantirUmCartaoPorNumero({
      orgId: ORG,
      sessionId: cartaoNovo.id,
      numero: NUMERO,
      waha: waha as never,
    });

    expect(r?.acao).toBe("cartao_reassumiu");
    expect(r?.cartao_id).toBe(cartaoAntigo.id);
    // Nada de desconectar: a sessão que acabou de conectar é a que vale.
    expect(waha.deleteSession).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("fn_adotar_conexao", {
      p_org: ORG,
      p_cartao: cartaoAntigo.id,
      p_nova: cartaoNovo.id,
      p_numero: NUMERO,
    });
  });

  it("dois números DIFERENTES continuam sendo dois cartões", async () => {
    const outroNumero = { ...cartaoNovo, phone_number: "557798980343" };
    const { rpc, waha } = montarMocks([cartaoAntigo, outroNumero]);
    // O WAHA confirma: a outra sessão está logada noutro número.
    waha.listSessions = vi.fn(async () => [
      { name: cartaoAntigo.waha_session_name, status: "WORKING", me: { id: `${NUMERO}@c.us` } },
      { name: outroNumero.waha_session_name, status: "WORKING", me: { id: "557798980343@c.us" } },
    ]);

    const r = await garantirUmCartaoPorNumero({
      orgId: ORG,
      sessionId: cartaoAntigo.id,
      numero: NUMERO,
      waha: waha as never,
    });

    expect(r).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(waha.deleteSession).not.toHaveBeenCalled();
  });
});
