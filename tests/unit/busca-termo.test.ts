/**
 * O caso que originou tudo: o contato gravado como
 * `name = "Contraste Móveis e Decorações"` / `display_name = "Sérgio Martins"`
 * não era achado por "sergio" em nenhuma caixa de busca do CRM.
 */
import { describe, it, expect } from "vitest";

import { normalizarBusca, padraoBusca, telefonesBusca, contemBusca } from "@/lib/busca/termo";
import { filtroDeContato } from "@/lib/busca/contatos";
import { applyFilters } from "@/lib/kanban/filters";
import type { Lead } from "@/lib/types/leads";

/** Casa como o Postgres casaria com `imatch` (`~*`). */
function imatch(padrao: string, texto: string): boolean {
  return new RegExp(padrao, "i").test(texto);
}

describe("normalizarBusca", () => {
  it("tira acento, maiúscula e espaço sobrando", () => {
    expect(normalizarBusca("  Sérgio   MARTINS ")).toBe("sergio martins");
    expect(normalizarBusca("Decorações")).toBe("decoracoes");
    expect(normalizarBusca("João Não-Ñoño")).toBe("joao nao-nono");
  });
});

describe("padraoBusca", () => {
  it("acha o nome com acento a partir do termo sem acento", () => {
    const p = padraoBusca("sergio martins")!;
    expect(imatch(p, "Sérgio Martins")).toBe(true);
    expect(imatch(p, "sergio martins")).toBe(true);
  });

  it("também acha quando quem digita usa o acento", () => {
    expect(imatch(padraoBusca("Sérgio")!, "sergio")).toBe(true);
    expect(imatch(padraoBusca("decoracoes")!, "Decorações")).toBe(true);
    expect(imatch(padraoBusca("moveis")!, "Contraste Móveis e Decorações")).toBe(true);
  });

  it("continua não achando quem não tem nada a ver", () => {
    expect(imatch(padraoBusca("sergio")!, "Contraste Móveis")).toBe(false);
    expect(imatch(padraoBusca("fernandes")!, "Sérgio Martins")).toBe(false);
  });

  it("nunca devolve os delimitadores do .or() do PostgREST", () => {
    const p = padraoBusca("silva, (77) 99812-5024")!;
    expect(p).not.toMatch(/[,()]/);
  });

  it("termo vazio é ausência de filtro, não filtro que nega tudo", () => {
    expect(padraoBusca("   ")).toBeNull();
  });
});

describe("telefonesBusca", () => {
  it("gera a forma com e sem o nono dígito", () => {
    const v = telefonesBusca("(73) 99981-8151");
    expect(v).toContain("5573999818151");
    expect(v).toContain("557399818151");
  });

  it("aceita pedaço de número", () => {
    expect(telefonesBusca("9105")).toEqual(["9105"]);
  });

  it("ignora o que não é telefone", () => {
    expect(telefonesBusca("sergio")).toEqual([]);
    expect(telefonesBusca("loja 2")).toEqual([]);
  });
});

describe("filtroDeContato", () => {
  it("procura em name E display_name — o nome da empresa e o de quem atende", () => {
    const f = filtroDeContato("sergio")!;
    expect(f).toContain("name.imatch.");
    expect(f).toContain("display_name.imatch.");
  });

  it("acrescenta as formas do telefone quando o termo é número", () => {
    const f = filtroDeContato("7191054071")!;
    expect(f).toContain("phone_number.ilike.%7191054071%");
  });
});

describe("contemBusca", () => {
  it("ignora acento nos dois sentidos", () => {
    expect(contemBusca("sergio", "Sérgio Martins")).toBe(true);
    expect(contemBusca("Sérgio", "sergio martins")).toBe(true);
  });

  it("olha todos os campos, não só o primeiro", () => {
    expect(contemBusca("sergio", "Contraste Móveis e Decorações", "Sérgio Martins")).toBe(true);
  });

  it("acha pelo telefone mesmo digitado com máscara e com o nono dígito", () => {
    expect(contemBusca("(73) 99981-8151", "Fulano", "+557399818151")).toBe(true);
    expect(contemBusca("99818151", "Fulano", "+557399818151")).toBe(true);
  });

  it("campo vazio não conta como casamento", () => {
    expect(contemBusca("sergio", null, undefined, "")).toBe(false);
  });
});

const LEAD_BASE = {
  id: "l1",
  organization_id: "o1",
  pipeline_id: "p1",
  stage_id: "s1",
  contact_id: "c1",
  title: "Contraste Móveis e Decorações",
  description: null,
  status: "open",
  lost_reason: null,
  position_in_stage: 0,
  value_cents: null,
  currency: null,
  owner_user_id: null,
  owner_kind: null,
  owner_agent_id: null,
  assigned_at: null,
  last_activity_at: null,
  expected_close_date: null,
  closed_at: null,
  source: "import",
  source_metadata: {},
  external_id: null,
  custom_fields: {},
  tags: [],
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  created_by_user_id: null,
} as unknown as Lead;

describe("applyFilters — a busca do quadro", () => {
  const lead: Lead = {
    ...LEAD_BASE,
    client_name: "Contraste Móveis e Decorações",
    client_display_name: "Sérgio Martins",
    client_phone: "+557191054071",
  };

  it("acha o card pelo nome de quem atende, que não está no título", () => {
    expect(applyFilters([lead], { search: "sergio martins" })).toHaveLength(1);
  });

  it("acha pelo título mesmo sem acento", () => {
    expect(applyFilters([lead], { search: "decoracoes" })).toHaveLength(1);
  });

  it("acha pelo telefone", () => {
    expect(applyFilters([lead], { search: "7191054071" })).toHaveLength(1);
  });

  it("não acha o que não é dele", () => {
    expect(applyFilters([lead], { search: "fernandes" })).toHaveLength(0);
  });

  it("negócio sem contato não quebra a busca", () => {
    expect(applyFilters([LEAD_BASE], { search: "sergio" })).toHaveLength(0);
    expect(applyFilters([LEAD_BASE], { search: "contraste" })).toHaveLength(1);
  });
});
