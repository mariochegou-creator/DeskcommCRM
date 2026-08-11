import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";

/**
 * A CONVERSA QUE VOCÊ ACABOU DE ABRIR PELO WHATSAPP WEB EXISTE — MAS NINGUÉM A VIA.
 *
 * Bug real (06/08/2026): conversa criada só por mensagem ENVIADA tem
 * `last_inbound_at = NULL`. A Fila ordena por `last_inbound_at ASC NULLS LAST`
 * e o cursor keyset fazia `gt` sobre a coluna — comparação com NULL é sempre
 * falsa, então TODA linha NULL era inalcançável depois da página 1 (50 itens).
 * O mesmo vale para a visão default com `last_message_at` NULL (órfãs).
 *
 * A correção acrescenta `<sortCol>.is.null` ao OR do cursor não-nulo: como
 * NULLS LAST vale nas duas direções, a partir de qualquer cursor não-nulo as
 * linhas NULL ainda estão à frente. Estes testes fixam a ordenação de cada
 * visão e esse braço do cursor.
 */

interface Registro {
  ordens: Array<{ coluna: string; ascendente: boolean | undefined; nullsFirst: boolean | undefined }>;
  colunas: string[];
  filtrosEq: Array<{ coluna: string; valor: unknown }>;
  filtrosOr: string[];
  filtrosIs: Array<{ coluna: string; valor: unknown }>;
  filtrosGt: Array<{ coluna: string; valor: unknown }>;
  filtrosLt: Array<{ coluna: string; valor: unknown }>;
  filtrosContains: Array<{ coluna: string; valor: unknown }>;
  limite: number | null;
}

/** Supabase de mentira: registra como a consulta foi montada e devolve `linhas`. */
function supabaseFalso(linhas: Array<Record<string, unknown>>) {
  const registro: Registro = {
    ordens: [],
    colunas: [],
    filtrosEq: [],
    filtrosOr: [],
    filtrosIs: [],
    filtrosGt: [],
    filtrosLt: [],
    filtrosContains: [],
    limite: null,
  };

  const q: Record<string, unknown> = {};
  const devolve = () => q;
  q.select = (colunas: string) => {
    registro.colunas.push(colunas);
    return q;
  };
  q.eq = (coluna: string, valor: unknown) => {
    registro.filtrosEq.push({ coluna, valor });
    return q;
  };
  q.ilike = devolve;
  q.order = (coluna: string, opcoes?: { ascending?: boolean; nullsFirst?: boolean }) => {
    registro.ordens.push({
      coluna,
      ascendente: opcoes?.ascending,
      nullsFirst: opcoes?.nullsFirst,
    });
    return q;
  };
  q.limit = (n: number) => {
    registro.limite = n;
    return q;
  };
  q.or = (expressao: string) => {
    registro.filtrosOr.push(expressao);
    return q;
  };
  q.is = (coluna: string, valor: unknown) => {
    registro.filtrosIs.push({ coluna, valor });
    return q;
  };
  q.gt = (coluna: string, valor: unknown) => {
    registro.filtrosGt.push({ coluna, valor });
    return q;
  };
  q.lt = (coluna: string, valor: unknown) => {
    registro.filtrosLt.push({ coluna, valor });
    return q;
  };
  q.contains = (coluna: string, valor: unknown) => {
    registro.filtrosContains.push({ coluna, valor });
    return q;
  };
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve({ data: linhas, error: null }).then(res, rej);

  return { supabase: { from: () => q }, registro };
}

const CTX = {
  organization_id: "org-1",
  actor: { type: "user" as const, id: "user-1" },
  requestId: "req-1",
};

function cursorDe(sort: string | null, id: string): string {
  return Buffer.from(JSON.stringify({ sort, id }), "utf8").toString("base64url");
}

describe("lista de conversas — ordenação por visão", () => {
  it("visão default (Todas): last_message_at DESC, NULLS LAST — mais recente no topo", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, { limit: 50 });

    const porAtividade = registro.ordens.find((o) => o.coluna === "last_message_at");
    expect(porAtividade, "a visão default não ordena por last_message_at").toBeDefined();
    expect(porAtividade!.ascendente).toBe(false);
    expect(porAtividade!.nullsFirst, "NULLS FIRST poria as órfãs sem preview no topo").toBe(false);
    expect(registro.ordens.find((o) => o.coluna === "id")!.ascendente).toBe(false);
  });

  it("Fila (unassigned): last_inbound_at ASC — quem espera há mais tempo primeiro", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, {
      limit: 50,
      assigned_to: "unassigned",
      status: "open",
    });

    const porEspera = registro.ordens.find((o) => o.coluna === "last_inbound_at");
    expect(porEspera, "a Fila não ordena por last_inbound_at").toBeDefined();
    expect(porEspera!.ascendente).toBe(true);
    expect(registro.ordens.find((o) => o.coluna === "id")!.ascendente).toBe(true);
  });
});

describe("cursor keyset alcança as linhas NULL", () => {
  it("cursor não-nulo inclui o braço `is.null` — senão conversa só-outbound some para sempre", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, {
      limit: 50,
      assigned_to: "unassigned",
      status: "open",
      cursor: cursorDe("2026-08-06T10:00:00Z", "conv-50"),
    });

    expect(registro.filtrosOr).toHaveLength(1);
    expect(registro.filtrosOr[0]).toContain("last_inbound_at.gt.");
    expect(
      registro.filtrosOr[0],
      "sem `last_inbound_at.is.null` no OR, linha NULL é inalcançável após a página 1",
    ).toContain("last_inbound_at.is.null");
  });

  it("na visão default o braço `is.null` usa last_message_at (e anda com lt)", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, {
      limit: 50,
      cursor: cursorDe("2026-08-06T10:00:00Z", "conv-50"),
    });

    expect(registro.filtrosOr[0]).toContain("last_message_at.lt.");
    expect(registro.filtrosOr[0]).toContain("last_message_at.is.null");
  });

  it("cursor já na região NULL: pagina por id, sem OR", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, {
      limit: 50,
      assigned_to: "unassigned",
      status: "open",
      cursor: cursorDe(null, "conv-null-7"),
    });

    expect(registro.filtrosOr).toHaveLength(0);
    expect(registro.filtrosIs).toContainEqual({ coluna: "last_inbound_at", valor: null });
    expect(registro.filtrosGt).toContainEqual({ coluna: "id", valor: "conv-null-7" });
  });
});

describe("filtro por etapa do funil", () => {
  const ETAPA = "999af389-c481-408a-a142-671589a48522";

  it("costura o negócio por INNER JOIN e filtra pela etapa — não por lista de contatos", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, { limit: 50, stage_id: ETAPA });

    expect(registro.colunas[0]).toContain("contacts:contact_id!inner");
    expect(
      registro.colunas[0],
      "sem !inner no negócio, conversa sem card entraria no resultado",
    ).toContain("crm_leads!inner");
    expect(registro.filtrosEq).toContainEqual({
      coluna: "contacts.crm_leads.stage_id",
      valor: ETAPA,
    });
  });

  it("sem etapa escolhida o contato NÃO vira inner join — conversa órfã continua na lista", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, { limit: 50 });

    expect(registro.colunas[0]).not.toContain("!inner");
    expect(registro.filtrosEq.map((f) => f.coluna)).not.toContain(
      "contacts.crm_leads.stage_id",
    );
  });

  it("o negócio embutido sai da resposta — o join é meio, não contrato", async () => {
    const { supabase } = supabaseFalso([
      {
        id: "conv-1",
        last_message_at: "2026-08-11T10:00:00Z",
        contacts: { id: "c-1", name: "Show Motos", crm_leads: [{ stage_id: ETAPA }] },
      },
    ]);

    const r = await listConversationsHandler(supabase as never, CTX, {
      limit: 50,
      stage_id: ETAPA,
    });

    // `contacts` é embed, não coluna de Conversation — daí a leitura solta.
    const contato = (r.conversations[0] as unknown as Record<string, unknown>).contacts;
    expect(contato).toBeDefined();
    expect(contato).not.toHaveProperty("crm_leads");
  });
});

describe("filtro de tag chega ao banco", () => {
  it("q.tag vira contains em tags — o dropdown deixou de ser decorativo", async () => {
    const { supabase, registro } = supabaseFalso([]);

    await listConversationsHandler(supabase as never, CTX, { limit: 50, tag: "quente" });

    expect(registro.filtrosContains).toContainEqual({ coluna: "tags", valor: ["quente"] });
  });
});
