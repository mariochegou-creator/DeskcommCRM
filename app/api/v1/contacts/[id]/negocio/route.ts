/**
 * POST /api/v1/contacts/[id]/negocio — o negócio da conversa, criado na hora.
 *
 * POR QUE EXISTE: o diálogo "Adicionar ao negócio" do inbox precisava de um
 * negócio para pôr o cartão dentro — e quando o contato da conversa ainda não
 * tinha nenhum, a tela dizia "crie o negócio primeiro" e mandava a pessoa
 * embora, no meio do atendimento. O caminho certo não é o beco: é criar o
 * negócio DA CONVERSA (contato de origem = quem está falando) e seguir.
 *
 * IDEMPOTENTE DE PROPÓSITO: se o contato já tem negócio aberto, a rota devolve
 * ESSE negócio em vez de criar o segundo. Duas abas, dois cliques, ou o resumo
 * do painel desatualizado — nenhum deles pode virar card duplicado no funil.
 *
 * Onde o card nasce: funil padrão da organização (`is_default`), primeira
 * etapa não-ganho/não-perdido — a mesma prateleira de entrada de qualquer lead
 * novo. Título = nome do contato, que é como todo card deste CRM se chama.
 *
 * A criação passa por `createLeadHandler`, nunca por um insert próprio: é ele
 * que valida etapa×funil, calcula a posição e emite evento + auditoria — um
 * segundo caminho de criação seria o que diverge em seis meses.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const supabase = await createClient();

  const { data: contato, error: contatoErr } = await supabase
    .from("contacts")
    .select("id, name, display_name, phone_number")
    .eq("id", contactId)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (contatoErr) {
    return fail("internal_error", contatoErr.message, 500, { requestId });
  }
  if (!contato) {
    return fail("not_found", "Contato não encontrado.", 404, { requestId });
  }

  // Já tem negócio aberto? É ele que a pessoa quer — devolve em vez de duplicar.
  const { data: existente, error: existenteErr } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existenteErr) {
    return fail("internal_error", existenteErr.message, 500, { requestId });
  }
  if (existente) {
    return ok({ lead: existente, ja_existia: true }, { requestId });
  }

  const { data: pipeline, error: pipelineErr } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", org.orgId)
    .eq("is_archived", false)
    .order("is_default", { ascending: false })
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pipelineErr) {
    return fail("internal_error", pipelineErr.message, 500, { requestId });
  }
  if (!pipeline) {
    return fail("not_found", "A organização não tem funil ativo.", 422, { requestId });
  }

  const { data: etapa, error: etapaErr } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", pipeline.id)
    .eq("is_archived", false)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (etapaErr) {
    return fail("internal_error", etapaErr.message, 500, { requestId });
  }
  if (!etapa) {
    return fail("not_found", "O funil não tem etapa de entrada.", 422, { requestId });
  }

  const nome =
    contato.display_name?.trim() || contato.name?.trim() || contato.phone_number || "";
  const title = (nome.length >= 2 ? nome : "Novo negócio").slice(0, 200);

  try {
    const lead = await createLeadHandler(
      supabase,
      {
        organization_id: org.orgId,
        actor: { type: "user", id: user.id },
        requestId,
      },
      {
        pipeline_id: pipeline.id,
        stage_id: etapa.id,
        title,
        contact_id: contato.id,
        currency: "BRL",
        tags: [],
        source: "inbox",
      },
    );
    return ok({ lead, ja_existia: false }, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
