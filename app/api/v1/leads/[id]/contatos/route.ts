/**
 * GET  /api/v1/leads/[id]/contatos — quem se chama neste negócio.
 * POST /api/v1/leads/[id]/contatos — vincula mais um (o cartão que o lead mandou).
 *
 * A LISTA JUNTA DUAS ORIGENS e diz qual é qual: o contato de ORIGEM do negócio
 * (`crm_leads.contact_id` — quem respondeu o primeiro toque) e os VINCULADOS
 * (`crm_lead_links`, `target_kind='contact'`, migration 0103). Devolver só os
 * vinculados obrigaria a tela a somar os dois por conta própria, e uma soma
 * feita na tela é como o kanban e o inbox passam a contar diferente.
 *
 * O contato de origem vem com `link_id: null`, e é isso que impede a tela de
 * oferecer "desvincular" nele: tirá-lo não é desvincular, é apagar de onde o
 * negócio nasceu — outra operação, com outro botão, que não é este.
 *
 * A ORG VEM DO LEAD LIDO PELA RLS, nunca do corpo. Mesmo padrão da rota de
 * timeline: quem não pode ler o negócio não passa daqui, e um `lead_id` de
 * outra organização morre no 404 antes de qualquer escrita.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { contatoPorTelefone } from "@/lib/contacts/contato-por-telefone";
import { telefoneE164 } from "@/lib/contacts/telefone";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { ApiError } from "@/lib/api/types";
import { vincularContatoSchema } from "@/lib/schemas/contatos-do-negocio";

export const dynamic = "force-dynamic";

/** Contrato explícito — nunca `select("*")`. */
const COLUNAS_DO_CONTATO =
  "id, name, display_name, phone_number, is_anonymized, is_blocked";

export interface ContatoDoNegocio {
  contact_id: string;
  /** `null` = contato de ORIGEM do negócio; não tem linha de vínculo. */
  link_id: string | null;
  papel: string | null;
  nome: string | null;
  phone_number: string | null;
  is_anonymized: boolean;
  is_blocked: boolean;
  origem: string | null;
  vinculado_em: string | null;
}

type LinhaDeContato = {
  id: string;
  name: string | null;
  display_name: string | null;
  phone_number: string | null;
  is_anonymized: boolean;
  is_blocked: boolean;
};

function nomeVisivel(c: LinhaDeContato): string | null {
  return c.display_name?.trim() || c.name?.trim() || c.phone_number || null;
}

/**
 * Monta a lista completa do negócio. Vive fora do handler porque o POST devolve
 * a MESMA lista já atualizada: sem isso a tela teria de fazer uma segunda volta
 * ao servidor para descobrir o que acabou de criar, e no meio dessas duas voltas
 * o contador do dossiê mostraria o número antigo.
 */
async function listarContatos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  leadId: string,
  contatoDeOrigemId: string | null,
): Promise<{ contatos: ContatoDoNegocio[] } | { erro: string }> {
  const { data: links, error: erroLinks } = await supabase
    .from("crm_lead_links")
    .select("id, target_id, link_kind, metadata, created_at")
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .eq("target_kind", "contact")
    .order("created_at", { ascending: true });
  if (erroLinks) return { erro: erroLinks.message };

  const idsVinculados = (links ?? []).map((l) => l.target_id as string);
  const ids = [...new Set([contatoDeOrigemId, ...idsVinculados].filter(Boolean) as string[])];
  if (ids.length === 0) return { contatos: [] };

  const { data: contatos, error: erroContatos } = await supabase
    .from("contacts")
    .select(COLUNAS_DO_CONTATO)
    .eq("organization_id", orgId)
    .in("id", ids);
  if (erroContatos) return { erro: erroContatos.message };

  const porId = new Map<string, LinhaDeContato>(
    ((contatos ?? []) as LinhaDeContato[]).map((c) => [c.id, c]),
  );

  const lista: ContatoDoNegocio[] = [];

  // O de origem vai PRIMEIRO e sempre: é com ele que a conversa está aberta.
  if (contatoDeOrigemId && porId.has(contatoDeOrigemId)) {
    const c = porId.get(contatoDeOrigemId)!;
    lista.push({
      contact_id: c.id,
      link_id: null,
      papel: null,
      nome: nomeVisivel(c),
      phone_number: c.phone_number,
      is_anonymized: c.is_anonymized,
      is_blocked: c.is_blocked,
      origem: null,
      vinculado_em: null,
    });
  }

  for (const link of links ?? []) {
    const alvo = link.target_id as string;
    // O vínculo que aponta para o próprio contato de origem não vira segunda
    // linha: seria o mesmo número contado duas vezes, que é exatamente o que a
    // unique da 0103 impede na escrita e o que esta guarda impede na leitura de
    // qualquer linha que tenha nascido antes dela.
    if (alvo === contatoDeOrigemId) continue;
    const c = porId.get(alvo);
    if (!c) continue;
    const metadata = (link.metadata ?? {}) as Record<string, unknown>;
    lista.push({
      contact_id: c.id,
      link_id: link.id as string,
      papel: (link.link_kind as string | null) ?? null,
      nome: nomeVisivel(c),
      phone_number: c.phone_number,
      is_anonymized: c.is_anonymized,
      is_blocked: c.is_blocked,
      origem: typeof metadata.origem === "string" ? metadata.origem : null,
      vinculado_em: (link.created_at as string | null) ?? null,
    });
  }

  return { contatos: lista };
}

/** O negócio, lido pela RLS do caller — é ele que prova a org. */
async function lerLead(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadId: string,
  orgId: string,
): Promise<{ id: string; contact_id: string | null; title: string } | null> {
  const { data } = await supabase
    .from("crm_leads")
    .select("id, contact_id, title")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as { id: string; contact_id: string | null; title: string } | null) ?? null;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_lead_links" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();
  const lead = await lerLead(supabase, leadId, org.orgId);
  if (!lead) return fail("not_found", "Negócio não encontrado.", 404, { requestId });

  const r = await listarContatos(supabase, org.orgId, lead.id, lead.contact_id);
  if ("erro" in r) {
    return fail("internal_error", "Falha ao listar os contatos do negócio.", 500, { requestId });
  }
  return ok({ contatos: r.contatos }, { requestId });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_lead_links" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = vincularContatoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const entrada = parsed.data;

  // A normalização é AQUI, não no navegador (ver o cabeçalho do schema): a
  // regra do nono dígito mora num lugar só.
  const telefone = telefoneE164(entrada.telefone);
  if (!telefone) {
    return fail(
      "invalid_request",
      "Número sem DDD ou fora de formato — não dá para saber de quem é.",
      422,
      { requestId },
    );
  }

  const supabase = await createClient();
  const lead = await lerLead(supabase, leadId, org.orgId);
  if (!lead) return fail("not_found", "Negócio não encontrado.", 404, { requestId });

  // Acha-ou-cria pela IDENTIDADE do WhatsApp — a MESMA função que a importação
  // de lista e o formulário de novo lead usam. Um caminho próprio aqui é como o
  // cartão do sócio viraria um segundo cadastro do número que já estava no CRM.
  let contato: { id: string; jaExistia: boolean };
  try {
    contato = await contatoPorTelefone(supabase, {
      organizationId: org.orgId,
      createdByUserId: user.id,
      phone: telefone,
      name: entrada.nome,
      source: entrada.origem === "vcard" ? "whatsapp_vcard" : "manual",
      sourceMetadata: { vinculado_ao_negocio: lead.id },
      requestId,
    });
  } catch (e) {
    // A mensagem do ApiError é escrita para o operador ("Este telefone pertence
    // a um contato mesclado. Abra o contato para reativá-lo.") e é a única
    // coisa na tela que diz o que fazer — trocá-la por um genérico devolveria
    // um beco.
    if (e instanceof ApiError) {
      return fail(e.code, e.message, e.status, { requestId });
    }
    return fail("internal_error", "Falha ao resolver o contato.", 500, { requestId });
  }

  // O contato de ORIGEM não vira vínculo: ele já está no negócio pela coluna
  // `contact_id`. Sem esta guarda, mandar o próprio cartão de volta ("esse é
  // meu número mesmo") criaria uma segunda linha para a mesma pessoa e o
  // dossiê diria "2 contatos" apontando duas vezes para o mesmo telefone.
  if (contato.id === lead.contact_id) {
    const r = await listarContatos(supabase, org.orgId, lead.id, lead.contact_id);
    if ("erro" in r) {
      return fail("internal_error", "Falha ao listar os contatos do negócio.", 500, { requestId });
    }
    return ok(
      { contatos: r.contatos, ja_estava: true, contact_id: contato.id },
      { requestId },
    );
  }

  const { data: link, error: erroLink } = await supabase
    .from("crm_lead_links")
    .insert({
      organization_id: org.orgId,
      lead_id: lead.id,
      target_kind: "contact",
      target_id: contato.id,
      link_kind: entrada.papel,
      created_by_user_id: user.id,
      // Procedência, nunca PII (ver o comment da coluna na 0103).
      metadata: {
        origem: entrada.origem,
        ...(entrada.message_id ? { message_id: entrada.message_id } : {}),
      },
    })
    .select("id")
    .maybeSingle();

  // 23505 = a unique parcial da 0103. Duas abas, dois cliques no mesmo cartão:
  // o segundo não é erro para quem clicou — o contato ESTÁ no negócio, que era
  // o pedido. Devolver 500 aqui ensinaria o SDR a desconfiar do botão.
  const jaEstava = erroLink?.code === "23505";
  if (erroLink && !jaEstava) {
    return fail("internal_error", "Falha ao vincular o contato ao negócio.", 500, { requestId });
  }

  // A timeline registra o acontecimento — fire-and-forget por doutrina: ela
  // descreve a operação, não a sustenta. Sem PII na `reason` (ela aparece na
  // tela e sai no export LGPD), então diz QUE entrou um contato e com qual
  // papel, nunca o nome nem o número.
  if (!jaEstava && link) {
    const r = await emitLeadActivity(supabase, {
      organizationId: org.orgId,
      leadId: lead.id,
      contactId: contato.id,
      type: "contato_vinculado",
      sourceModule: "contatos_do_negocio",
      sourceId: link.id as string,
      actor: { type: "user", id: user.id, role: org.role },
      reason: `Contato adicionado ao negócio (${entrada.papel})`,
      payload: {
        papel: entrada.papel,
        origem: entrada.origem,
        contato_novo: !contato.jaExistia,
      },
    });
    if (!r.ok) {
      logger.warn("[contatos-do-negocio] atividade contato_vinculado não gravada", {
        lead_id: lead.id,
        detail: r.error,
        requestId,
      });
    }
  }

  const r = await listarContatos(supabase, org.orgId, lead.id, lead.contact_id);
  if ("erro" in r) {
    return fail("internal_error", "Falha ao listar os contatos do negócio.", 500, { requestId });
  }

  return ok(
    { contatos: r.contatos, ja_estava: jaEstava, contact_id: contato.id },
    { requestId, status: jaEstava ? 200 : 201 },
  );
}
