/**
 * GET /api/v1/contacts/[id]/stage-events — as mudanças de etapa desta pessoa,
 * para aparecerem DENTRO da conversa.
 *
 * POR QUE UMA ROTA SÓ PARA ISTO, tendo `crm-summary` e a timeline do dossiê:
 *
 *  · `crm-summary` devolve as 5 atividades MAIS RECENTES de TODOS os tipos, para
 *    a listinha do painel lateral. O thread precisa do contrário: só as de
 *    etapa, em ordem CRESCENTE, o suficiente para cobrir a conversa inteira. Ler
 *    de lá faria o aviso sumir do meio do chat assim que cinco atividades de
 *    outro tipo nascessem — e sumir sem deixar buraco, que é o pior jeito.
 *
 *  · a timeline do dossiê tem o eixo no NEGÓCIO e vive num modal. Aqui o eixo é
 *    o CONTATO, porque é a conversa que está aberta na tela e é dela que o
 *    atendente está falando.
 *
 * Pela ROTA e não pelo cliente do navegador, pelo mesmo motivo do `crm-summary`:
 * o cookie de sessão é httpOnly, então a consulta do browser sairia como `anon`
 * e a policy de `crm_lead_activities` devolveria **200 com lista vazia** — um
 * silêncio que a tela traduziria para "nada aconteceu com este lead".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { comNomeDoAtor } from "@/lib/leads/timeline-query";
import { createClient } from "@/lib/supabase/server";
import type { TimelineItem } from "@/lib/types/contacts";

export const dynamic = "force-dynamic";

/**
 * Teto do que o thread mostra. Alto porque o custo é uma consulta indexada por
 * contato e o aviso é UMA linha fina no chat — e baixo o bastante para um lead
 * que rodou meses de cadência não despejar centenas de chips numa conversa.
 */
const LIMITE = 50;

const COLS =
  "id, organization_id, lead_id, contact_id, source_module, source_id, type, payload, metadata, performed_at, performed_by_user_id, actor_kind, actor_agent_id, reason, evidence";

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

  // DESC no banco (o índice é por `performed_at` decrescente e é assim que o
  // "as 50 mais recentes" fica barato), ASC na resposta — o thread lê de cima
  // para baixo e não deve ter que inverter nada.
  const { data, error } = await supabase
    .from("crm_lead_activities")
    .select(COLS)
    .eq("contact_id", contactId)
    .eq("type", "stage_changed")
    .order("performed_at", { ascending: false })
    .limit(LIMITE);

  // A falha SOBE. Lista vazia aqui seria indistinguível de "este lead nunca
  // mudou de etapa", que é uma afirmação sobre o negócio.
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  const rows = ((data ?? []) as unknown as TimelineItem[]).slice().reverse();
  return ok(await comNomeDoAtor(supabase, rows), { requestId });
}
