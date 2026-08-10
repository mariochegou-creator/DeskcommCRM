/**
 * Excluir funil — o que a rota tem que recusar antes de escrever.
 *
 * O dublê aplica os `eq` de verdade, então os testes de tenant e de estado
 * ficam vermelhos se o filtro sumir da rota; e `escritas` é o que prova a
 * garantia mais importante daqui: recusa não toca o banco.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import {
  ORG_ID,
  OUTRA_ORG,
  PIPE,
  authOk,
  makeDb,
  negocio,
  type LeadRow,
} from "@/tests/helpers/stages-db-double";

const OUTRO_PIPE = "55555555-5555-4555-8555-555555555555";
const url = `http://localhost/api/v1/pipelines/${PIPE}`;

function ctx(id = PIPE) {
  return { params: Promise.resolve({ id }) };
}

function reqDelete(confirmar = false) {
  return new NextRequest(confirmar ? `${url}?confirmar=1` : url, { method: "DELETE" });
}

function reqPatch(body: unknown) {
  return new NextRequest(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function funil(over: Record<string, unknown> & { id: string; name: string }) {
  return {
    organization_id: ORG_ID,
    is_default: false,
    is_archived: false,
    position: 1000,
    ...over,
  };
}

/** Dois funis vivos: o do teste e o vizinho que impede o "é o último". */
function dois(over: Record<string, unknown> = {}) {
  return [
    funil({ id: PIPE, name: "Pedidos", ...over }),
    funil({ id: OUTRO_PIPE, name: "Prospecção", position: 2000 }),
  ];
}

function aberto(id: string): LeadRow {
  return { ...negocio(id, "e1"), status: "open" } as unknown as LeadRow;
}

/** As escritas em `crm_pipelines`, na ordem em que a rota as disparou. */
function updatesDeFunil(db: ReturnType<typeof makeDb>) {
  return db.escritas.filter((e) => e.table === "crm_pipelines");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/v1/pipelines/[id]", () => {
  it("sem auth → repassa a resposta do requireRole, sem escrever", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente. Requer role >= manager.", 403, {}),
    });
    const db = makeDb({ pipelines: dois() });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(true), ctx());
    expect(res.status).toBe(403);
    expect(db.escritas).toEqual([]);
  });

  it("exige manager", async () => {
    authOk();
    makeDb({ pipelines: dois() });
    const { DELETE } = await import("./route");
    await DELETE(reqDelete(true), ctx());
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("manager");
  });

  /**
   * ⭐ O funil EXISTE e o id é o certo — só que é de outro tenant. O dublê
   * aplica o `eq("organization_id", …)`, então apagá-lo da rota fica vermelho.
   */
  it("funil de outra organização → 404 e NENHUMA escrita", async () => {
    authOk();
    const db = makeDb({
      pipelines: [funil({ id: PIPE, name: "Pedidos", organization_id: OUTRA_ORG })],
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(true), ctx());

    expect(res.status).toBe(404);
    expect(db.escritas).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("funil já excluído → 409 e NENHUMA escrita", async () => {
    authOk();
    const db = makeDb({ pipelines: dois({ is_archived: true }) });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(true), ctx());

    expect(res.status).toBe(409);
    expect(db.escritas).toEqual([]);
  });

  /**
   * ⭐ Sem funil não há etapa, e criar funil não existe em tela nenhuma deste
   * produto: excluir o último seria uma porta só de ida.
   */
  it("último funil vivo → 422 e NENHUMA escrita", async () => {
    authOk();
    const db = makeDb({ pipelines: [funil({ id: PIPE, name: "Pedidos" })] });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(true), ctx());
    const body = (await res.json()) as { error: { details?: { unico?: boolean } } };

    expect(res.status).toBe(422);
    expect(body.error.details?.unico).toBe(true);
    expect(db.escritas).toEqual([]);
  });

  /**
   * ⭐ A CONTAGEM VAI EM `details`. A tela precisa do número para perguntar "os
   * N negócios somem junto, tem certeza?" — tirá-lo da frase com regex seria
   * uma segunda régua.
   */
  it("funil com negócios e sem confirmar → 422 com a contagem, e NENHUMA escrita", async () => {
    authOk();
    const db = makeDb({
      pipelines: dois(),
      leads: [aberto("l1"), aberto("l2"), negocio("l3", "e1")],
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(false), ctx());
    const body = (await res.json()) as {
      error: { details?: { precisa_confirmar?: boolean; negocios?: number; abertos?: number } };
    };

    expect(res.status).toBe(422);
    expect(body.error.details?.precisa_confirmar).toBe(true);
    expect(body.error.details?.negocios).toBe(3);
    expect(body.error.details?.abertos).toBe(2);
    expect(db.escritas).toEqual([]);
  });

  /**
   * O formulário não olha `is_archived`: ele continua criando negócio num funil
   * que sumiu da tela. Por isso conta como "não está vazio" mesmo sem lead.
   */
  it("funil vazio com formulário apontando → 422 pedindo confirmação", async () => {
    authOk();
    const db = makeDb({
      pipelines: dois(),
      webhooks: [
        {
          id: "w1",
          organization_id: ORG_ID,
          default_pipeline_id: PIPE,
          is_active: true,
        },
      ],
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(false), ctx());
    const body = (await res.json()) as { error: { details?: { formularios?: number } } };

    expect(res.status).toBe(422);
    expect(body.error.details?.formularios).toBe(1);
    expect(db.escritas).toEqual([]);
  });

  it("funil vazio → arquiva direto, sem confirmar", async () => {
    authOk();
    const db = makeDb({ pipelines: dois() });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(false), ctx());

    expect(res.status).toBe(200);
    expect(updatesDeFunil(db)).toHaveLength(1);
    expect(updatesDeFunil(db)[0]?.patch).toMatchObject({ is_archived: true });
    expect(db.tabelas.crm_pipelines.find((p) => p.id === PIPE)?.is_archived).toBe(true);
  });

  it("com confirmar → arquiva o funil que tem negócios, e os negócios ficam", async () => {
    authOk();
    const db = makeDb({ pipelines: dois(), leads: [aberto("l1")] });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(true), ctx());

    expect(res.status).toBe(200);
    // Nada é apagado nem movido: o funil sai das listas e leva os cards junto.
    expect(db.escritas.filter((e) => e.table === "crm_leads")).toEqual([]);
    expect(db.tabelas.crm_leads).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pipeline.archived" }),
    );
  });

  /**
   * ⭐ `uniq_crm_pipelines_org_default` é único por organização e o quadro lê
   * esse funil para calcular a próxima ação. Arquivar o padrão sem promover
   * outro deixaria a org com ZERO — e o sintoma seria só "a próxima ação sumiu".
   */
  it("era o padrão → libera no mesmo update e promove o próximo da ordem", async () => {
    authOk();
    const db = makeDb({
      pipelines: [
        funil({ id: PIPE, name: "Pedidos", is_default: true }),
        funil({ id: OUTRO_PIPE, name: "Prospecção", position: 2000 }),
      ],
    });
    const { DELETE } = await import("./route");
    const res = await DELETE(reqDelete(true), ctx());
    const body = (await res.json()) as { data: { novo_padrao: { id: string } | null } };

    expect(res.status).toBe(200);
    const updates = updatesDeFunil(db);
    expect(updates[0]?.patch).toEqual({ is_archived: true, is_default: false });
    expect(updates[1]?.patch).toEqual({ is_default: true });
    expect(body.data.novo_padrao?.id).toBe(OUTRO_PIPE);
    expect(db.tabelas.crm_pipelines.find((p) => p.id === OUTRO_PIPE)?.is_default).toBe(true);
  });

  it("não era o padrão → não promove ninguém", async () => {
    authOk();
    const db = makeDb({
      pipelines: [
        funil({ id: PIPE, name: "Pedidos", position: 2000 }),
        funil({ id: OUTRO_PIPE, name: "Prospecção", is_default: true }),
      ],
    });
    const { DELETE } = await import("./route");
    await DELETE(reqDelete(true), ctx());

    expect(updatesDeFunil(db)).toHaveLength(1);
    expect(db.tabelas.crm_pipelines.find((p) => p.id === OUTRO_PIPE)?.is_default).toBe(true);
  });
});

describe("PATCH /api/v1/pipelines/[id] — o Desfazer", () => {
  it("funil de outra organização → 404 e NENHUMA escrita", async () => {
    authOk();
    const db = makeDb({
      pipelines: [
        funil({ id: PIPE, name: "Pedidos", organization_id: OUTRA_ORG, is_archived: true }),
      ],
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(reqPatch({ arquivado: false }), ctx());

    expect(res.status).toBe(404);
    expect(db.escritas).toEqual([]);
  });

  it("corpo diferente de { arquivado: false } → 422 e NENHUMA escrita", async () => {
    authOk();
    const db = makeDb({ pipelines: dois({ is_archived: true }) });
    const { PATCH } = await import("./route");
    const res = await PATCH(reqPatch({ name: "Outro nome" }), ctx());

    expect(res.status).toBe(422);
    expect(db.escritas).toEqual([]);
  });

  /**
   * ⭐ Volta como funil COMUM. Enquanto este esteve fora, outro assumiu o posto
   * de padrão — reivindicá-lo aqui bateria no índice único e transformaria o
   * "Desfazer" em erro.
   */
  it("desarquiva sem reivindicar o padrão", async () => {
    authOk();
    const db = makeDb({ pipelines: dois({ is_archived: true }) });
    const { PATCH } = await import("./route");
    const res = await PATCH(reqPatch({ arquivado: false }), ctx());

    expect(res.status).toBe(200);
    expect(updatesDeFunil(db)).toHaveLength(1);
    expect(updatesDeFunil(db)[0]?.patch).toEqual({ is_archived: false });
    expect(db.tabelas.crm_pipelines.find((p) => p.id === PIPE)?.is_archived).toBe(false);
  });

  it("funil que já está no quadro → 200 sem escrever", async () => {
    authOk();
    const db = makeDb({ pipelines: dois() });
    const { PATCH } = await import("./route");
    const res = await PATCH(reqPatch({ arquivado: false }), ctx());

    expect(res.status).toBe(200);
    expect(db.escritas).toEqual([]);
  });
});
