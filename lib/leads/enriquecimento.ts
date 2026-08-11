/**
 * O que um lead cru do banco NÃO responde sozinho: quem é o dono agente e qual
 * é a probabilidade.
 *
 * Nasceu extraído da rota do board, quando o painel do inbox passou a mostrar o
 * mesmo negócio que o card do Kanban mostra. Copiar as duas funções para lá
 * criaria dois enriquecedores do MESMO lead — e no mês em que um deles ganhasse
 * um campo, o board e o inbox diriam coisas diferentes sobre o mesmo negócio,
 * que é exatamente o defeito que o painel veio corrigir.
 *
 * Puro de I/O externo: só fala com o Supabase que recebe (sessão do caller,
 * RLS aplicada), nunca com o admin client.
 */
import type { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/lib/types/leads";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Roda um `.in(...)` em lotes e junta os resultados.
 *
 * O PostgREST recebe a lista de ids na URL, e o cliente HTTP do Node recusa
 * cabeçalho+URL acima de 16 KB — com `Headers Overflow Error`, que sobe como um
 * `TypeError: fetch failed` sem dizer o motivo. Um UUID custa ~37 bytes, então o
 * teto chega perto de 440 ids: o quadro funcionava e passou a falhar INTEIRO no
 * dia em que a importação cruzou essa marca, sem nada no log e sem relação
 * visível com a mudança que estivesse no ar. Em 200 a URL fica em ~7 KB, metade
 * do limite — folga suficiente para não voltar a acontecer por crescimento.
 */
export async function emLotes<T>(
  ids: string[],
  consulta: (
    lote: string[],
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanho = 200,
): Promise<{ data: T[]; error: string | null }> {
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += tamanho) lotes.push(ids.slice(i, i + tamanho));

  const resultados = await Promise.all(lotes.map((lote) => consulta(lote)));
  const falha = resultados.find((r) => r.error);
  if (falha?.error) return { data: [], error: falha.error.message };

  return { data: resultados.flatMap((r) => r.data ?? []), error: null };
}

/**
 * Anexa a identidade do agente dono (nome + versão publicada) aos leads que têm
 * `owner_kind='ai'`.
 *
 * **Sem filtro de `is_active`/`archived_at` de propósito.** Quem é o dono é
 * pergunta de EXIBIÇÃO e vale para qualquer agente: desativar um bot não pode
 * transformar os negócios dele em cards anônimos. A lista de agentes que PODEM
 * receber um lead (o picker, `/api/v1/ai/agents/assignable`) é outra pergunta e
 * lá os filtros estão certos.
 *
 * `organization_id` é filtrado explicitamente — vem de fonte confiável (o
 * pipeline já validado pela RLS do caller), nunca do body.
 */
export async function withOwnerAgents(
  supabase: Supabase,
  organizationId: string,
  leads: Lead[],
): Promise<{ leads: Lead[]; error: string | null }> {
  const agentIds = [
    ...new Set(
      leads
        .filter((l) => l.owner_kind === "ai" && l.owner_agent_id)
        .map((l) => l.owner_agent_id as string),
    ),
  ];
  if (agentIds.length === 0) return { leads, error: null };

  const { data: agents, error: agentsErr } = await supabase
    .from("ai_agents")
    .select("id, name, published_version_id")
    .eq("organization_id", organizationId)
    .in("id", agentIds);
  if (agentsErr) return { leads, error: agentsErr.message };

  const agentRows = (agents ?? []) as Array<{
    id: string;
    name: string;
    published_version_id: string | null;
  }>;

  const publishedIds = agentRows
    .map((a) => a.published_version_id)
    .filter((v): v is string => !!v);
  const versionById = new Map<string, number>();
  if (publishedIds.length > 0) {
    const { data: versions, error: versionsErr } = await supabase
      .from("ai_agent_versions")
      .select("id, version_number")
      .eq("organization_id", organizationId)
      .in("id", publishedIds);
    if (versionsErr) return { leads, error: versionsErr.message };
    for (const v of (versions ?? []) as Array<{ id: string; version_number: number }>) {
      versionById.set(v.id, v.version_number);
    }
  }

  const byId = new Map(agentRows.map((a) => [a.id, a]));
  return {
    leads: leads.map((lead) => {
      if (lead.owner_kind !== "ai" || !lead.owner_agent_id) return lead;
      const agent = byId.get(lead.owner_agent_id);
      if (!agent) return lead;
      return {
        ...lead,
        owner_agent: {
          id: agent.id,
          name: agent.name,
          version_number: agent.published_version_id
            ? (versionById.get(agent.published_version_id) ?? null)
            : null,
        },
      };
    }),
    error: null,
  };
}

/**
 * Anexa o score aos leads que o têm — LEFT JOIN, nunca INNER.
 *
 * Score ausente é estado legítimo (sinal insuficiente, cenário 17). Um INNER
 * apagaria do quadro justamente os leads sem sinal, que são os que mais
 * precisam de atenção humana — o oposto do que o produto existe para fazer.
 *
 * A faixa vem PERSISTIDA e é entregue como está: recalculá-la aqui (ou na UI)
 * ignoraria a histerese e devolveria o card piscando na fronteira, no único
 * lugar onde o CHECK de coerência não alcança.
 */
export async function withScores(
  supabase: Supabase,
  organizationId: string,
  leads: Lead[],
): Promise<{ leads: Lead[]; error: string | null }> {
  if (leads.length === 0) return { leads, error: null };

  const { data, error } = await emLotes(
    leads.map((l) => l.id),
    (lote) =>
      supabase
        .from("crm_lead_scores")
        .select(
          "lead_id, ai_probability, ai_probability_reason, ai_probability_band, ai_probability_evidence, ai_probability_at",
        )
        .eq("organization_id", organizationId)
        .in("lead_id", lote),
  );
  if (error) return { leads, error };

  const porLead = new Map<string, NonNullable<Lead["score"]>>();
  for (const row of (data ?? []) as Array<{
    lead_id: string;
    ai_probability: number | string | null;
    ai_probability_reason: string | null;
    ai_probability_band: string | null;
    ai_probability_evidence: { factors?: unknown } | null;
    ai_probability_at: string | null;
  }>) {
    // `numeric` chega como string no supabase-js; `null` continua null — e a
    // diferença entre null e 0 é justamente o que não pode se perder aqui.
    if (row.ai_probability === null || row.ai_probability_band === null) continue;
    const factors = Array.isArray(row.ai_probability_evidence?.factors)
      ? (row.ai_probability_evidence.factors as NonNullable<Lead["score"]>["factors"])
      : [];
    porLead.set(row.lead_id, {
      probability: Number(row.ai_probability),
      reason: row.ai_probability_reason ?? "",
      band: row.ai_probability_band as NonNullable<Lead["score"]>["band"],
      factors,
      at: row.ai_probability_at,
    });
  }

  return {
    leads: leads.map((lead) => {
      const score = porLead.get(lead.id);
      return score ? { ...lead, score } : lead;
    }),
    error: null,
  };
}
