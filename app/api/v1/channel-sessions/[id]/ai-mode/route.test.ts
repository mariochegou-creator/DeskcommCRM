import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/api/wrappers";
import type { AuthUser } from "@/lib/auth/types";

/**
 * PATCH /api/v1/channel-sessions/[id]/ai-mode — trocar quem responde o cliente.
 *
 * O que o teste protege é o estrago silencioso: o `metadata` é jsonb
 * compartilhado, e gravar `{ ai_mode }` puro apagaria as outras chaves de
 * operação sem erro nenhum na tela — o tipo de defeito que só aparece dias
 * depois, quando falta algo que ninguém lembra de ter configurado. Também trava
 * o default `atendente` para valor ausente ou lixo, que é o mesmo lado para o
 * qual o `lerModoDoNumero` erra: a tela e o motor têm que concordar.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
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

function makeSupabaseStub(metadata: Record<string, unknown> | null) {
  const state = { updatePatch: null as Record<string, unknown> | null };
  const client = {
    from() {
      const b = {
        select() {
          return b;
        },
        update(patch: Record<string, unknown>) {
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
          return Promise.resolve({
            data: {
              id: SESSION_ID,
              display_name: "Comercial",
              phone_number: "5577999990000",
              waha_session_name: "org_abcd1234_ef56",
              metadata,
            },
            error: null,
          });
        },
        then(resolve: (v: { error: unknown }) => unknown) {
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return b;
    },
    __state: state,
  };
  return client;
}

function req(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/channel-sessions/${SESSION_ID}/ai-mode`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: SESSION_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/v1/channel-sessions/[id]/ai-mode", () => {
  it("sem permissão de admin → repassa authz.response", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden", "Admin required.", 403, {}),
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ai_mode: "copiloto" }), params);
    expect(res.status).toBe(403);
  });

  it("modo inválido → 422 e nada é gravado", async () => {
    mockAuthzOk();
    const stub = makeSupabaseStub({ ai_mode: "atendente" });
    vi.mocked(createClient).mockResolvedValue(stub as never);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ai_mode: "mudo" }), params);
    expect(res.status).toBe(422);
    expect(stub.__state.updatePatch).toBeNull();
  });

  it("preserva as outras chaves do metadata ao gravar o modo", async () => {
    mockAuthzOk();
    const stub = makeSupabaseStub({ ai_mode: "atendente", limite_diario: 40, apelido: "chip 1" });
    vi.mocked(createClient).mockResolvedValue(stub as never);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ai_mode: "copiloto" }), params);
    expect(res.status).toBe(200);
    expect(stub.__state.updatePatch).toEqual({
      metadata: { ai_mode: "copiloto", limite_diario: 40, apelido: "chip 1" },
    });
  });

  it("metadata sem a chave → o anterior é 'atendente' e o novo entra", async () => {
    mockAuthzOk();
    const stub = makeSupabaseStub({});
    vi.mocked(createClient).mockResolvedValue(stub as never);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ai_mode: "copiloto" }), params);
    const body = (await res.json()) as { data: { ai_mode: string; anterior: string } };
    expect(body.data).toMatchObject({ ai_mode: "copiloto", anterior: "atendente" });
    expect(stub.__state.updatePatch).toEqual({ metadata: { ai_mode: "copiloto" } });
  });

  it("metadata nulo não quebra — vira objeto novo", async () => {
    mockAuthzOk();
    const stub = makeSupabaseStub(null);
    vi.mocked(createClient).mockResolvedValue(stub as never);
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ ai_mode: "atendente" }), params);
    expect(res.status).toBe(200);
    expect(stub.__state.updatePatch).toEqual({ metadata: { ai_mode: "atendente" } });
  });
});
