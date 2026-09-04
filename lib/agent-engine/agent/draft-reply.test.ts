import { describe, expect, it, vi, beforeEach } from "vitest";

import { generateDraftReply, separarSugestoes } from "./draft-reply";
import { loadPublishedAgentConfig, type PublishedAgentConfig } from "./agent-config";
import { getLeadContext, type LeadContextResult } from "../edge/crm/get-lead-context";
import { runModelCall } from "../edge/llm/run-model-call";

vi.mock("./agent-config", () => ({ loadPublishedAgentConfig: vi.fn() }));
vi.mock("../edge/crm/get-lead-context", () => ({ getLeadContext: vi.fn() }));
vi.mock("../edge/llm/run-model-call", () => ({ runModelCall: vi.fn() }));

const mockLoadAgent = vi.mocked(loadPublishedAgentConfig);
const mockGetLeadContext = vi.mocked(getLeadContext);
const mockRunModelCall = vi.mocked(runModelCall);

/** Só a leitura da cola do mercado passa por aqui — o resto do turno é mockado. */
const mockDbQuery = vi.fn<() => Promise<{ rows: { cola: string | null }[] }>>();
const db = { query: mockDbQuery } as never;
const llmCfg = {} as never;
const crmCfg = {} as never;

const input = {
  tenantId: "org-1",
  leadId: "contact-1",
  conversationId: "conv-1",
  channelSessionId: "session-1",
};

const AGENT: PublishedAgentConfig = {
  agentId: "agent-1",
  versionId: "version-1",
  agentName: "Bot Deskcomm",
  systemPrompt: "Você é a vendedora da loja X.",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  credentialId: "cred-1",
  maxSteps: 8,
  historyMessageWindow: 20,
  historyTokenWindow: 1000,
  handoffKeywords: [],
  handoffToolEnabled: false,
  splitMessages: false,
  splitMaxChars: 400,
  multimodalInput: false,
  casesEnabled: false,
  toolIds: [],
  activeKbVersionId: null,
  ragTopK: 5,
  ragSimilarityThreshold: 0.72,
  versionCreatedBy: null,
  agentCreatedBy: null,
};

function contextResult(overrides: Partial<LeadContextResult & { ok: true }> = {}): LeadContextResult {
  return {
    ok: true,
    tokenCount: 42,
    lgpd: {
      isAnonymized: false,
      isProspecting: false,
      legalBasis: { basis: null, legalBasisRef: null, consentGranted: false, dataOrigin: "whatsapp" },
    },
    context: {
      lead_id: input.leadId,
      contact: { name: "Rafael", phone: "+551199", email: null, tags: [], is_blocked: false },
      conversation_id: input.conversationId,
      last_human_decision: null,
      messages: [
        { direction: "inbound", body: "Oi, quero saber o preço do produto X.", sent_at: "2026-07-22T10:00:00Z" },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: org sem cola preenchida — o estado de quem ainda não escreveu nada.
  mockDbQuery.mockResolvedValue({ rows: [{ cola: null }] });
});

describe("generateDraftReply", () => {
  it("agente publicado + contexto com histórico → chama runModelCall SEM tools/maxSteps e retorna o rascunho", async () => {
    mockLoadAgent.mockResolvedValue(AGENT);
    mockGetLeadContext.mockResolvedValue(contextResult());
    mockRunModelCall.mockResolvedValue({
      result: { text: "  Olá! O produto X custa R$ 99,90.  " },
      callId: "call-1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costCents: 1,
      latencyMs: 1,
    } as never);

    const result = await generateDraftReply(db, llmCfg, crmCfg, input);

    // Resposta sem separador vira UMA opção com o texto inteiro — o formato é
    // pedido, não garantido, e falhar aqui seria negar ajuda a quem clicou.
    expect(result).toEqual({
      ok: true,
      sugestoes: [{ angulo: "sugestão", texto: "Olá! O produto X custa R$ 99,90." }],
      fontes: ["a única mensagem desta conversa"],
    });
    expect(mockRunModelCall).toHaveBeenCalledTimes(1);
    const call = mockRunModelCall.mock.calls[0]!;
    const runInput = call[2];
    expect(runInput.purpose).toBe("draft_suggestion");
    expect(runInput.tenantId).toBe(input.tenantId);
    expect(runInput.leadId).toBe(input.leadId);
    expect(runInput).not.toHaveProperty("tools");
    expect(runInput).not.toHaveProperty("maxSteps");
  });

  it("sem agente publicado → no_agent, sem chamar runModelCall", async () => {
    mockLoadAgent.mockResolvedValue(null);

    const result = await generateDraftReply(db, llmCfg, crmCfg, input);

    expect(result).toEqual({ ok: false, reason: "no_agent" });
    expect(mockGetLeadContext).not.toHaveBeenCalled();
    expect(mockRunModelCall).not.toHaveBeenCalled();
  });

  it("contato bloqueado → blocked, sem chamar runModelCall", async () => {
    mockLoadAgent.mockResolvedValue(AGENT);
    mockGetLeadContext.mockResolvedValue(
      contextResult({
        context: {
          lead_id: input.leadId,
          contact: { name: "Rafael", phone: null, email: null, tags: [], is_blocked: true },
          conversation_id: input.conversationId,
          last_human_decision: null,
          messages: [],
        },
      }),
    );

    const result = await generateDraftReply(db, llmCfg, crmCfg, input);

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(mockRunModelCall).not.toHaveBeenCalled();
  });

  it("contato anonimizado (lgpd.isAnonymized) → blocked, sem chamar runModelCall", async () => {
    mockLoadAgent.mockResolvedValue(AGENT);
    mockGetLeadContext.mockResolvedValue(
      contextResult({
        lgpd: {
          isAnonymized: true,
          isProspecting: false,
          legalBasis: { basis: null, legalBasisRef: null, consentGranted: false, dataOrigin: "whatsapp" },
        },
      }),
    );

    const result = await generateDraftReply(db, llmCfg, crmCfg, input);

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(mockRunModelCall).not.toHaveBeenCalled();
  });

  it("erro de leitura do CRM (getLeadContext ok:false) → error, não blocked, sem chamar runModelCall", async () => {
    mockLoadAgent.mockResolvedValue(AGENT);
    mockGetLeadContext.mockResolvedValue({ ok: false, reason: "crm_unavailable" } as never);

    const result = await generateDraftReply(db, llmCfg, crmCfg, input);

    expect(result).toEqual({ ok: false, reason: "error" });
    expect(mockRunModelCall).not.toHaveBeenCalled();
  });

  it("histórico vazio (sem mensagens) → empty, sem chamar runModelCall", async () => {
    mockLoadAgent.mockResolvedValue(AGENT);
    mockGetLeadContext.mockResolvedValue(
      contextResult({
        context: {
          lead_id: input.leadId,
          contact: { name: "Rafael", phone: null, email: null, tags: [], is_blocked: false },
          conversation_id: input.conversationId,
          last_human_decision: null,
          messages: [],
        },
      }),
    );

    const result = await generateDraftReply(db, llmCfg, crmCfg, input);

    expect(result).toEqual({ ok: false, reason: "empty" });
    expect(mockRunModelCall).not.toHaveBeenCalled();
  });

  it("result.text vazio/whitespace → empty", async () => {
    mockLoadAgent.mockResolvedValue(AGENT);
    mockGetLeadContext.mockResolvedValue(contextResult());
    mockRunModelCall.mockResolvedValue({
      result: { text: "   " },
      callId: "call-1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costCents: 1,
      latencyMs: 1,
    } as never);

    const result = await generateDraftReply(db, llmCfg, crmCfg, input);

    expect(result).toEqual({ ok: false, reason: "empty" });
  });
});

describe("o rascunho conhece a decisão do vendedor", () => {
  /** O `system` que efetivamente foi ao modelo — é o que está sob nosso controle. */
  async function systemGerado(
    decisao: { action: string; decision: "approved" | "dismissed"; at: string } | null,
  ): Promise<string> {
    mockLoadAgent.mockResolvedValue(AGENT);
    const base = contextResult() as Extract<LeadContextResult, { ok: true }>;
    mockGetLeadContext.mockResolvedValue({
      ...base,
      context: { ...base.context, last_human_decision: decisao },
    });
    mockRunModelCall.mockResolvedValue({
      result: { text: "Claro! Segue o valor." },
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costCents: 1,
      latencyMs: 1,
    } as never);

    await generateDraftReply(db, llmCfg, crmCfg, input);
    const chamada = mockRunModelCall.mock.calls[0]?.[2] as { system: string };
    return chamada.system;
  }

  it("proposta DESCARTADA entra como instrução de NÃO repropor", async () => {
    // O caso que fecha a promessa da Wave 4: sem isto, o vendedor recusa uma
    // proposta, pede um rascunho, e o rascunho sugere o que ele acabou de negar
    // — escrito COMO ELE, sem disclosure. O botão "Ignorar" viraria mentira.
    const system = await systemGerado({
      action: "ligar para o Carlos amanhã",
      decision: "dismissed",
      at: "2026-07-25T10:00:00Z",
    });
    expect(system).toContain("DESCARTOU");
    expect(system).toContain("ligar para o Carlos amanhã");
    expect(system).toMatch(/NÃO sugira/i);
  });

  it("proposta APROVADA entra como instrução de APOIAR, não de substituir", async () => {
    const system = await systemGerado({
      action: "enviar a proposta revisada",
      decision: "approved",
      at: "2026-07-25T10:00:00Z",
    });
    expect(system).toContain("APROVOU");
    expect(system).toContain("enviar a proposta revisada");
  });

  it("sem decisão nenhuma o prompt NÃO ganha bloco vazio", async () => {
    // Um "[DECISÃO DO VENDEDOR]" sem conteúdo gastaria contexto e ensinaria o
    // modelo a preencher lacuna — pior que não dizer nada.
    const system = await systemGerado(null);
    expect(system).not.toContain("DECISÃO DO VENDEDOR");
    expect(system).toContain("[MODO RASCUNHO]");
  });
});

describe("a cola do mercado entra no rascunho", () => {
  async function systemComCola(cola: string | null): Promise<string> {
    mockLoadAgent.mockResolvedValue(AGENT);
    mockGetLeadContext.mockResolvedValue(contextResult());
    mockDbQuery.mockResolvedValue({ rows: [{ cola }] });
    mockRunModelCall.mockResolvedValue({
      result: { text: "Segue." },
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costCents: 1,
      latencyMs: 1,
    } as never);
    await generateDraftReply(db, llmCfg, crmCfg, input);
    return (mockRunModelCall.mock.calls[0]?.[2] as { system: string }).system;
  }

  it("o texto da org vai INTEIRO para o prompt", async () => {
    // Inteiro, não um trecho: as travas do "o que nunca dizer" moram longe da
    // objeção, e um recorte por relevância as deixaria de fora justamente
    // quando o modelo mais precisa delas.
    const cola = `## Dor 1
Ele perde cliente por não responder.

## Nunca dizer
Não fale de presença digital no primeiro toque.`;
    const system = await systemComCola(cola);
    expect(system).toContain("[COLA DO MERCADO]");
    expect(system).toContain(cola);
  });

  it("org sem cola não ganha bloco vazio", async () => {
    // Mesma razão do bloco de decisão: cabeçalho sem conteúdo gasta contexto e
    // ensina o modelo a preencher lacuna.
    expect(await systemComCola(null)).not.toContain("COLA DO MERCADO");
  });

  it("cola só com espaço em branco conta como vazia", async () => {
    // O campo é uma caixa de texto livre: apagar o conteúdo costuma deixar
    // quebras de linha para trás, e isso não pode virar um bloco fantasma.
    expect(await systemComCola(" \n\n ")).not.toContain("COLA DO MERCADO");
  });

  it("manda o modelo classificar a última mensagem antes de escrever", async () => {
    // É o que separa a sugestão da pergunta genérica que o vendedor ignora.
    const system = await systemComCola(null);
    expect(system).toContain("[COMO RESPONDER]");
    expect(system).toMatch(/última mensagem/i);
  });
});

/**
 * O parser das três opções.
 *
 * ⚠️ Testado sozinho, e com entrada torta de propósito: o formato é PEDIDO ao
 * modelo, não garantido por ele. Todo caso aqui é coisa que modelo faz de
 * verdade — negritar o rótulo, pôr a mensagem entre aspas, mandar separador a
 * mais, esquecer o rótulo. Em nenhum deles o vendedor pode ficar sem resposta:
 * ele clicou pedindo ajuda.
 */
describe("separarSugestoes", () => {
  it("três blocos no formato pedido viram três opções", () => {
    const bruto = [
      "ANGULO: pergunta direta",
      "Quem responde o WhatsApp aí hoje?",
      "---",
      "ANGULO: prova",
      "Fiz a busca e tirei um print.",
      "---",
      "ANGULO: convite",
      "Fica melhor segunda ou terça?",
    ].join("\n");

    expect(separarSugestoes(bruto)).toEqual([
      { angulo: "pergunta direta", texto: "Quem responde o WhatsApp aí hoje?" },
      { angulo: "prova", texto: "Fiz a busca e tirei um print." },
      { angulo: "convite", texto: "Fica melhor segunda ou terça?" },
    ]);
  });

  it("texto sem separador nenhum ainda entrega uma opção", () => {
    expect(separarSugestoes("Bom dia, tudo certo?")).toEqual([
      { angulo: "sugestão", texto: "Bom dia, tudo certo?" },
    ]);
  });

  it("rótulo negritado e mensagem entre aspas são limpos", () => {
    const bruto = '**ANGULO:** *prova social*\n"Fiz a busca hoje de manhã."';
    expect(separarSugestoes(bruto)).toEqual([
      { angulo: "prova social", texto: "Fiz a busca hoje de manhã." },
    ]);
  });

  it("separador com traços a mais e espaços em volta continua separando", () => {
    const r = separarSugestoes("ANGULO: a\nprimeira\n  -----  \nANGULO: b\nsegunda");
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ angulo: "b", texto: "segunda" });
  });

  it("corta em três mesmo se o modelo mandar mais", () => {
    const bruto = ["um", "dois", "três", "quatro", "cinco"]
      .map((n) => `ANGULO: ${n}\nmensagem ${n}`)
      .join("\n---\n");
    expect(separarSugestoes(bruto)).toHaveLength(3);
  });

  it("bloco sem texto é descartado, não vira opção vazia", () => {
    const r = separarSugestoes("ANGULO: vazio\n\n---\nANGULO: cheio\ntem texto");
    expect(r).toEqual([{ angulo: "cheio", texto: "tem texto" }]);
  });

  it("resposta vazia devolve lista vazia — quem chama trata como 'empty'", () => {
    expect(separarSugestoes("")).toEqual([]);
    expect(separarSugestoes("   \n  ---  \n ")).toEqual([]);
  });
});
