import { describe, expect, it, vi } from "vitest";

// O módulo de handlers importa helpers `server-only` no topo (usados só no
// caminho de ENVIO). Mocka-se para o import não puxar next/headers sob jsdom —
// só a função de LISTAGEM é exercida aqui.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { listMessagesHandler } from "@/app/api/v1/messages/_handler";

/**
 * O INBOX ABRE NO FIM DA CONVERSA, NÃO NO COMEÇO.
 *
 * A primeira versão paginava `sent_at` ASCENDENTE com `limit`. Numa conversa
 * curta ninguém percebia; passando de `limit` mensagens o comportamento virava o
 * contrário do combinado: a primeira página era o COMEÇO da conversa, a
 * mensagem recém-enviada não estava nela, e o botão "Carregar mais antigas"
 * buscava mensagens mais NOVAS. Quem enviava pelo composer via a própria
 * mensagem sumir no primeiro refetch — o sintoma que abriu esta investigação.
 *
 * O mesmo handler alimenta o `crm_get_conversation_history` do MCP: lá o agente
 * recebia as mensagens mais VELHAS da conversa rotuladas como contexto.
 *
 * Estes testes fixam as três coisas que precisam valer juntas: a janela é a mais
 * recente, a leitura dentro dela é cronológica, e o cursor anda para trás.
 */

interface Linha {
  id: string;
  sent_at: string;
}

interface Registro {
  ordens: Array<{ coluna: string; ascendente: boolean | undefined }>;
  filtrosOr: string[];
  limite: number | null;
  /** Payloads de `.update()` por tabela — é assim que se vê o zerar-não-lidas. */
  updates: Array<{ tabela: string; valores: Record<string, unknown> }>;
}

/** Supabase de mentira: registra como a consulta foi montada e devolve `linhas`. */
function supabaseFalso(linhas: Linha[]) {
  const registro: Registro = { ordens: [], filtrosOr: [], limite: null, updates: [] };

  const q = (tabela: string) => {
    const alvo: Record<string, unknown> = {};
    const devolve = () => alvo;
    alvo.select = devolve;
    alvo.eq = devolve;
    alvo.gt = devolve;
    alvo.update = (valores: Record<string, unknown>) => {
      registro.updates.push({ tabela, valores });
      return alvo;
    };
    alvo.order = (coluna: string, opcoes?: { ascending?: boolean }) => {
      registro.ordens.push({ coluna, ascendente: opcoes?.ascending });
      return alvo;
    };
    alvo.limit = (n: number) => {
      registro.limite = n;
      return alvo;
    };
    alvo.or = (expressao: string) => {
      registro.filtrosOr.push(expressao);
      return alvo;
    };
    alvo.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: linhas, error: null }).then(res, rej);
    return alvo;
  };

  return { supabase: { from: (tabela: string) => q(tabela) }, registro };
}

/** O UPDATE que zera o contador de não-lidas, se houve. */
function zerouNaoLidas(registro: Registro): boolean {
  return registro.updates.some(
    (u) => u.tabela === "conversations" && u.valores.unread_count_for_assignee === 0,
  );
}

const CTX = {
  organization_id: "org-1",
  actor: { type: "user" as const, id: "user-1" },
  requestId: "req-1",
};

/** Como o banco devolveria com ORDER BY sent_at DESC: da mais nova para a mais velha. */
const DESCENDENTE: Linha[] = [
  { id: "m4", sent_at: "2026-08-04T10:04:00Z" },
  { id: "m3", sent_at: "2026-08-04T10:03:00Z" },
  { id: "m2", sent_at: "2026-08-04T10:02:00Z" },
  { id: "m1", sent_at: "2026-08-04T10:01:00Z" },
];

function lerCursor(cursor: string): { sent_at: string; id: string } {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

describe("histórico da conversa", () => {
  it("pede a janela mais recente (sent_at decrescente)", async () => {
    const { supabase, registro } = supabaseFalso(DESCENDENTE);

    await listMessagesHandler(supabase as never, CTX, "conversa-1", { limit: 3 });

    const porSentAt = registro.ordens.find((o) => o.coluna === "sent_at");
    expect(porSentAt, "a consulta não ordena por sent_at").toBeDefined();
    expect(
      porSentAt!.ascendente,
      "ascendente = a primeira página é o COMEÇO da conversa, não o fim",
    ).toBe(false);
    // O desempate por id tem que seguir a mesma direção, senão a paginação pula
    // linhas quando duas mensagens caem no mesmo instante.
    expect(registro.ordens.find((o) => o.coluna === "id")!.ascendente).toBe(false);
  });

  it("devolve a página em ordem cronológica, terminando na mensagem mais nova", async () => {
    const { supabase } = supabaseFalso(DESCENDENTE);

    const r = await listMessagesHandler(supabase as never, CTX, "conversa-1", { limit: 3 });

    expect(r.messages.map((m) => m.id)).toEqual(["m2", "m3", "m4"]);
    expect(r.has_more).toBe(true);
  });

  it("o cursor aponta para a mensagem mais ANTIGA da página", async () => {
    // É o que faz o próximo clique buscar o passado. Apontar para a mais nova
    // devolveria a mesma janela para sempre.
    const { supabase } = supabaseFalso(DESCENDENTE);

    const r = await listMessagesHandler(supabase as never, CTX, "conversa-1", { limit: 3 });

    expect(r.cursor).not.toBeNull();
    expect(lerCursor(r.cursor!).id).toBe("m2");
  });

  it("com cursor, a busca anda para TRÁS no tempo", async () => {
    const { supabase, registro } = supabaseFalso(DESCENDENTE);
    const cursor = Buffer.from(
      JSON.stringify({ sent_at: "2026-08-04T10:02:00Z", id: "m2" }),
      "utf8",
    ).toString("base64url");

    await listMessagesHandler(supabase as never, CTX, "conversa-1", { limit: 3, cursor });

    expect(registro.filtrosOr).toHaveLength(1);
    expect(registro.filtrosOr[0]).toContain("sent_at.lt.");
    expect(
      registro.filtrosOr[0],
      "`gt` traria mensagens mais novas — era o bug do botão 'Carregar mais antigas'",
    ).not.toContain("sent_at.gt.");
  });

  it("CONTROLE: conversa que cabe na página inteira não devolve cursor", async () => {
    // Sem este controle, um handler que devolvesse cursor sempre passaria nos
    // testes acima e faria a UI oferecer "mais antigas" que não existem.
    const { supabase } = supabaseFalso(DESCENDENTE.slice(0, 2));

    const r = await listMessagesHandler(supabase as never, CTX, "conversa-1", { limit: 3 });

    expect(r.has_more).toBe(false);
    expect(r.cursor).toBeNull();
    expect(r.messages.map((m) => m.id)).toEqual(["m3", "m4"]);
  });
});

/**
 * ABRIR A CONVERSA É LER A CONVERSA.
 *
 * O número azul da lista conta mensagem do contato AGUARDANDO RESPOSTA. Nada
 * zerava esse contador, então ele só subia: conversa já respondida continuava
 * marcada, e como a mensagem mais recente era a do próprio operador o badge
 * passava a ser lido como "contei a mensagem que VOCÊ enviou" — o relato que
 * abriu esta investigação. Buscar a janela mais recente é o sinal de leitura que
 * o CRM já tinha em mãos e ignorava.
 */
describe("abrir a conversa zera o não-lido", () => {
  it("primeira página (sem cursor) de um humano zera", async () => {
    const { supabase, registro } = supabaseFalso(DESCENDENTE);

    await listMessagesHandler(supabase as never, CTX, "conversa-1", { limit: 3 });

    expect(zerouNaoLidas(registro)).toBe(true);
  });

  it("paginar o histórico NÃO zera", async () => {
    // Ler o passado não é atender o presente: quem clica em "carregar mais
    // antigas" pode estar procurando contexto sem ter respondido nada.
    const { supabase, registro } = supabaseFalso(DESCENDENTE);
    const cursor = Buffer.from(
      JSON.stringify({ sent_at: "2026-08-04T10:02:00Z", id: "m2" }),
      "utf8",
    ).toString("base64url");

    await listMessagesHandler(supabase as never, CTX, "conversa-1", { limit: 3, cursor });

    expect(zerouNaoLidas(registro)).toBe(false);
  });

  it("agente de IA lendo o histórico NÃO zera", async () => {
    // O mesmo handler serve o `crm_get_conversation_history` do MCP. Se a
    // leitura do agente zerasse, toda conversa com bot ligado chegaria ao
    // humano sem aviso — o agente teria "lido" por ele.
    const { supabase, registro } = supabaseFalso(DESCENDENTE);
    const ctxAgente = {
      ...CTX,
      actor: { type: "ai_agent" as const, id: "agente-1", role: "agent" },
    };

    await listMessagesHandler(supabase as never, ctxAgente, "conversa-1", { limit: 3 });

    expect(zerouNaoLidas(registro)).toBe(false);
  });
});
