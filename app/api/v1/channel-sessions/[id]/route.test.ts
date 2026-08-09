import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient } from "@/lib/waha/client";
import { fail } from "@/lib/api/wrappers";
import type { AuthUser } from "@/lib/auth/types";

/**
 * DELETE /api/v1/channel-sessions/[id] — remover número da Central.
 *
 * O ponto do teste é a bifurcação: número virgem some do banco, número com
 * histórico é arquivado (o DELETE de verdade seria recusado pelo ON DELETE
 * RESTRICT de conversations/messages) e tem o phone_number zerado — sem isso a
 * unique (org, phone_number) impediria reconectar o mesmo número depois.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn(), resolveActiveOrg: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/waha/client", () => ({ getWahaClient: vi.fn(), wahaFriendlyError: (m: string) => m }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

function mockAuthzOk() {
  const user: AuthUser = {
    id: USER_ID,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "admin" }],
  };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG_ID, name: "Org", role: "admin" },
  });
}

type Sessao = {
  id: string;
  waha_session_name: string;
  display_name: string | null;
  phone_number: string | null;
  archived_at: string | null;
};

/**
 * Stub do supabase server client cobrindo as três tabelas que o DELETE toca.
 * `counts` decide se o número tem histórico; `deleteErro` simula o RESTRICT
 * disparando numa corrida.
 */
function makeSupabaseStub(opts: {
  sessao: Sessao | null;
  conversas: number;
  mensagens: number;
  deleteErro?: { message: string };
}) {
  const state = {
    deleteTentado: false,
    updatePatch: null as Record<string, unknown> | null,
  };

  const client = {
    from(table: string) {
      if (table === "channel_sessions") {
        // `op` é por cadeia (cada from() abre uma nova) — é o que separa o
        // erro do delete do sucesso do update que vem logo depois.
        let op: "select" | "delete" | "update" = "select";
        const b = {
          select() {
            return b;
          },
          delete() {
            op = "delete";
            state.deleteTentado = true;
            return b;
          },
          update(patch: Record<string, unknown>) {
            op = "update";
            state.updatePatch = patch;
            return b;
          },
          eq() {
            return b;
          },
          is() {
            return b;
          },
          maybeSingle() {
            return Promise.resolve({ data: opts.sessao, error: null });
          },
          // update()/delete() terminam sem maybeSingle — o await cai no then.
          then(resolve: (v: { error: unknown }) => unknown) {
            const error = op === "delete" ? (opts.deleteErro ?? null) : null;
            return Promise.resolve({ error }).then(resolve);
          },
        };
        return b;
      }
      // conversations / messages — só a contagem importa (head: true).
      const count = table === "conversations" ? opts.conversas : opts.mensagens;
      const c = {
        select() {
          return c;
        },
        eq() {
          return c;
        },
        then(resolve: (v: { count: number; error: null }) => unknown) {
          return Promise.resolve({ count, error: null }).then(resolve);
        },
      };
      return c;
    },
    __state: state,
  };
  return client;
}

function req() {
  return new NextRequest(`http://localhost/api/v1/channel-sessions/${SESSION_ID}`, {
    method: "DELETE",
  });
}

const params = { params: Promise.resolve({ id: SESSION_ID }) };

const SESSAO_BASE: Sessao = {
  id: SESSION_ID,
  waha_session_name: "org_abcd1234_ef56",
  display_name: null,
  phone_number: "5577999990000",
  archived_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWahaClient).mockReturnValue(null as never);
});

describe("DELETE /api/v1/channel-sessions/[id]", () => {
  it("sem permissão de admin → repassa authz.response", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden", "Admin required.", 403, {}),
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(403);
  });

  it("canal inexistente → 404", async () => {
    mockAuthzOk();
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseStub({ sessao: null, conversas: 0, mensagens: 0 }) as never,
    );
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(404);
  });

  it("já removido antes → 409 (não arquiva duas vezes)", async () => {
    mockAuthzOk();
    vi.mocked(createClient).mockResolvedValue(
      makeSupabaseStub({
        sessao: { ...SESSAO_BASE, archived_at: "2026-08-09T00:00:00.000Z" },
        conversas: 0,
        mensagens: 0,
      }) as never,
    );
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(409);
  });

  it("número que nunca conversou → apaga a linha", async () => {
    mockAuthzOk();
    const stub = makeSupabaseStub({ sessao: SESSAO_BASE, conversas: 0, mensagens: 0 });
    vi.mocked(createClient).mockResolvedValue(stub as never);
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    const body = (await res.json()) as { data: { modo: string } };
    expect(res.status).toBe(200);
    expect(body.data.modo).toBe("apagado");
    expect(stub.__state.deleteTentado).toBe(true);
    expect(stub.__state.updatePatch).toBeNull();
  });

  it("número com conversas → arquiva e zera o phone_number, preservando o rótulo", async () => {
    mockAuthzOk();
    const stub = makeSupabaseStub({ sessao: SESSAO_BASE, conversas: 12, mensagens: 340 });
    vi.mocked(createClient).mockResolvedValue(stub as never);
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    const body = (await res.json()) as { data: { modo: string; conversas: number } };
    expect(res.status).toBe(200);
    expect(body.data.modo).toBe("arquivado");
    expect(body.data.conversas).toBe(12);
    expect(stub.__state.deleteTentado).toBe(false);
    expect(stub.__state.updatePatch).toMatchObject({
      status: "STOPPED",
      phone_number: null,
      // rótulo veio do phone_number porque display_name era nulo
      display_name: "5577999990000",
    });
    expect(stub.__state.updatePatch?.archived_at).toEqual(expect.any(String));
  });

  it("RESTRICT dispara numa corrida → cai para arquivamento em vez de 500", async () => {
    mockAuthzOk();
    const stub = makeSupabaseStub({
      sessao: SESSAO_BASE,
      conversas: 0,
      mensagens: 0,
      deleteErro: { message: "violates foreign key constraint" },
    });
    vi.mocked(createClient).mockResolvedValue(stub as never);
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    const body = (await res.json()) as { data: { modo: string } };
    expect(res.status).toBe(200);
    expect(body.data.modo).toBe("arquivado");
  });
});
