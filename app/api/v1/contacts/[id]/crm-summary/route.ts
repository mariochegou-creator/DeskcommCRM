/**
 * GET /api/v1/contacts/[id]/crm-summary — o resumo de CRM do painel do inbox.
 *
 * POR QUE ESTA ROTA EXISTE (não é organização, é correção de defeito):
 * o `CRMSidePanel` consultava `crm_leads`, `orders` e `crm_lead_activities`
 * DIRETO do navegador, pelo cliente de browser. O cookie de sessão é httpOnly
 * (CLAUDE.md), então o supabase-js do browser não enxerga a sessão e as
 * consultas saem como **anônimas** — provado lendo o `role` do token: `anon`,
 * com um gerente logado na tela.
 *
 * O efeito era pior que um erro:
 *   crm_leads           → a policy chama fn_can_view_lead, que `anon` não pode
 *                         executar → 401 / 42501
 *   crm_lead_activities → a policy usa fn_user_org_ids, que é PUBLIC → `anon`
 *                         chama, avalia falso → **200 com lista vazia**
 *   orders              → idem
 * Um erro e dois silêncios, e a tela traduzia os três para "Sem leads." — uma
 * afirmação sobre o NEGÓCIO feita em cima de uma falha de permissão.
 *
 * A correção **não** é dar EXECUTE a `anon`: `fn_can_view_lead` é primitiva de
 * autorização, e a policy a usa para decidir quem enxerga o quê. É trazer a
 * leitura para o servidor, onde a sessão existe — mesma decisão que o repo já
 * tomou para o fetch do board e para o token de realtime.
 *
 * **Um pedido, um veredito.** As consultas falham juntas de propósito: a
 * alternativa (status por seção) multiplicaria os estados no componente, e a
 * doença que esta rota cura é exatamente estados distintos colapsados num só.
 *
 * ---
 * **O negócio inteiro, não um resumo dele.** O painel mostra o MESMO que o card
 * do Kanban (etapa, valor, dono, probabilidade, tags) e deixa mexer em etapa e
 * tags dali — atender e ter que abrir outra tela para saber em que pé está o
 * negócio era o motivo de ninguém manter o funil em dia. Por isso o lead sai
 * daqui com as colunas TODAS e enriquecido pelas MESMAS funções do board
 * (`lib/leads/enriquecimento`), nunca por uma segunda cópia que diverge.
 *
 * As etapas vêm com `top_position` — a menor posição ocupada na coluna — porque
 * mover pelo painel manda o negócio para o TOPO da etapa de destino, a mesma
 * decisão do arrasto no board (o card que acabou de se mover é o que precisa
 * ficar à vista). Sem esse número o cliente não tem como calcular o `midpoint`
 * e teria que chutar uma posição.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { withOwnerAgents, withScores } from "@/lib/leads/enriquecimento";
import { createClient } from "@/lib/supabase/server";
import type { Pipeline, Stage, StageComTopo } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

export const dynamic = "force-dynamic";

const ORDER_COLS = "id, external_id, status, total_cents, currency, created_at";
/** Acompanha o que a timeline mostra — `reason` e `actor_kind` inclusive. */
const ACTIVITY_COLS = "id, type, source_module, performed_at, payload, reason, actor_kind";

/**
 * O topo de cada coluna, uma consulta por etapa (`order` + `limit 1`).
 *
 * Buscar os leads do funil inteiro para achar o mínimo seria mais simples e
 * ficaria caro do jeito errado: cresce com o tamanho do funil, e esta rota roda
 * a cada conversa aberta. `limit 1` por etapa é indexado e previsível.
 *
 * Falha aqui vira `null` — que o cliente lê como "coluna vazia" e resolve com
 * `midpoint(null, null)`. Uma posição um pouco fora do ideal é infinitamente
 * melhor que recusar a mudança de etapa por causa de um número de ordenação.
 */
async function comTopoDaColuna(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stages: Stage[],
): Promise<StageComTopo[]> {
  const topos = await Promise.all(
    stages.map(async (s) => {
      const { data } = await supabase
        .from("crm_leads")
        .select("position_in_stage")
        .eq("stage_id", s.id)
        .neq("status", "archived")
        .order("position_in_stage", { ascending: true })
        .limit(1)
        .maybeSingle();
      const pos = (data as { position_in_stage: number | null } | null)?.position_in_stage;
      return typeof pos === "number" ? pos : null;
    }),
  );
  return stages.map((s, i) => ({ ...s, top_position: topos[i] ?? null }));
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  // O negócio "desta pessoa" tem DUAS portas: ser o contato de ORIGEM
  // (`crm_leads.contact_id`) ou ter entrado pelo cartão (`crm_lead_links`,
  // target_kind='contact' — migration 0103). Só a primeira fazia a conversa com
  // o sócio dizer "sem negócio", e o diálogo de adicionar contato mandar criar
  // um negócio que já existia.
  const links = await supabase
    .from("crm_lead_links")
    .select("lead_id")
    .eq("target_kind", "contact")
    .eq("target_id", contactId);
  if (links.error) {
    return fail("internal_error", links.error.message, 500, { requestId });
  }
  const idsVinculados = [
    ...new Set((links.data ?? []).map((l) => l.lead_id as string)),
  ];

  let leadsQuery = supabase
    .from("crm_leads")
    .select("*")
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(3);
  leadsQuery = idsVinculados.length
    ? leadsQuery.or(`contact_id.eq.${contactId},id.in.(${idsVinculados.join(",")})`)
    : leadsQuery.eq("contact_id", contactId);

  const [leads, orders, activities] = await Promise.all([
    leadsQuery,
    supabase
      .from("orders")
      .select(ORDER_COLS)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("crm_lead_activities")
      .select(ACTIVITY_COLS)
      .eq("contact_id", contactId)
      .order("performed_at", { ascending: false })
      .limit(5),
  ]);

  // A falha SOBE. Engolir aqui devolveria lista vazia ao cliente e recriaria,
  // do lado do servidor, exatamente a mentira que esta rota veio desfazer.
  const falha = leads.error ?? orders.error ?? activities.error;
  if (falha) {
    return fail("internal_error", falha.message, 500, { requestId });
  }

  const leadRows = (leads.data ?? []) as Lead[];
  const pipelineIds = [...new Set(leadRows.map((l) => l.pipeline_id))];

  let stages: StageComTopo[] = [];
  let pipelines: Pipeline[] = [];
  if (pipelineIds.length > 0) {
    const [pipelinesRes, stagesRes] = await Promise.all([
      supabase.from("crm_pipelines").select("*").in("id", pipelineIds),
      supabase
        .from("crm_stages")
        .select("*")
        .in("pipeline_id", pipelineIds)
        .eq("is_archived", false)
        .order("position"),
    ]);
    if (pipelinesRes.error) {
      return fail("internal_error", pipelinesRes.error.message, 500, { requestId });
    }
    if (stagesRes.error) {
      return fail("internal_error", stagesRes.error.message, 500, { requestId });
    }
    pipelines = (pipelinesRes.data ?? []) as Pipeline[];
    stages = await comTopoDaColuna(supabase, (stagesRes.data ?? []) as Stage[]);
  }

  // O dono agente e a probabilidade pelas MESMAS funções do board: o painel
  // mostra o mesmo negócio, então tem que mostrá-lo do mesmo jeito.
  // `organization_id` sai do próprio lead — linha que a RLS já liberou para
  // este usuário —, nunca do body.
  const organizationId = leadRows[0]?.organization_id ?? null;
  let leadsProntos = leadRows;
  if (organizationId) {
    const comDono = await withOwnerAgents(supabase, organizationId, leadRows);
    if (comDono.error) return fail("internal_error", comDono.error, 500, { requestId });
    const comScore = await withScores(supabase, organizationId, comDono.leads);
    if (comScore.error) return fail("internal_error", comScore.error, 500, { requestId });
    leadsProntos = comScore.leads;
  }

  return ok(
    {
      leads: leadsProntos,
      stages,
      pipelines,
      orders: orders.data ?? [],
      activities: activities.data ?? [],
    },
    { requestId },
  );
}
