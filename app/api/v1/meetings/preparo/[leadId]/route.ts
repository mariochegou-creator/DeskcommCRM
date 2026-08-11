/**
 * GET   /api/v1/meetings/preparo/[leadId] — tudo que se precisa saber antes de
 *       entrar numa reunião marcada: a reunião, as notas que o time deixou, as
 *       tarefas abertas do negócio e as reuniões anteriores com o mesmo lead.
 * PATCH /api/v1/meetings/preparo/[leadId] — marca (ou desmarca) um item manual
 *       do checklist de preparo.
 *
 * POR QUE UMA ROTA SÓ: a pergunta "o que falta para esta reunião?" se responde
 * com cinco tabelas. Cinco requisições da tela seriam cinco spinners e cinco
 * jeitos de a tela ficar meio pronta — e o preparo é lido em pé, minutos antes
 * da sala abrir.
 *
 * ONDE O CHECKLIST MORA: em `crm_leads.custom_fields.reuniao.checklist`, junto
 * do resto do agendamento. Sem migration, pela mesma decisão dos ganchos de
 * prospecção — campo novo de negócio entra por custom_fields até provar que
 * merece coluna (doutrina DIRC).
 *
 * ESCRITA É LEIA-E-REGRAVE, e o `lerReuniao` é a peneira: ele copia TODO campo
 * conhecido de volta, então o carimbo de lembrete que o cron gravou entre a
 * leitura e a escrita é o único jeito de perder alguma coisa aqui. Perda
 * possível: um lembrete reenviado no tick seguinte. Aceita — a alternativa
 * (lock na linha do lead) custa mais do que o erro que evita.
 *
 * Auth DUAL + admin client com filtro explícito de org: o contrato de toda rota
 * sob /api/v1/meetings (ver lib/sala-reunioes/authz.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { lerReuniao } from "@/lib/agendamento/reuniao";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import { ehItemManual } from "@/lib/sala-reunioes/preparo";
import { toggleItemPreparoSchema } from "@/lib/schemas/sala-reunioes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

/** Notas são lidas, não auditadas: o teto é o que cabe numa rolagem antes da sala abrir. */
const LIMITE_NOTAS = 30;
const LIMITE_TAREFAS = 30;
const LIMITE_REUNIOES = 5;

interface RouteCtx {
  params: Promise<{ leadId: string }>;
}

interface LinhaDeLead {
  id: string;
  title: string | null;
  contact_id: string | null;
  custom_fields: unknown;
  value_cents: number | null;
  currency: string | null;
  tags: string[] | null;
  contacts: {
    id: string;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
  } | null;
  crm_stages: { name: string | null } | null;
}

function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function carregarLead(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  leadId: string,
): Promise<LinhaDeLead | null> {
  const { data } = await admin
    .from("crm_leads")
    .select(
      "id, title, contact_id, custom_fields, value_cents, currency, tags, contacts:contact_id(id, name, display_name, phone_number), crm_stages:stage_id(name)",
    )
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as unknown as LinhaDeLead | null) ?? null;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const { leadId } = await ctx.params;
  const admin = createAdminClient();

  const lead = await carregarLead(admin, authz.orgId, leadId);
  if (!lead) {
    return withCorsHeaders(fail("not_found", "Negócio não encontrado.", 404, { requestId }), req);
  }

  const contato = um(lead.contacts);
  const etapa = um(lead.crm_stages);

  // A conversa mais recente do contato é a porta das notas internas — é ali que
  // o SDR escreve, e é ali que a nota semeada com os ganchos foi parar.
  const { data: conversa } = lead.contact_id
    ? await admin
        .from("conversations")
        .select("id, last_inbound_at, last_message_at")
        .eq("organization_id", authz.orgId)
        .eq("contact_id", lead.contact_id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const [notas, tarefas, anteriores] = await Promise.all([
    conversa
      ? admin
          .from("conversation_notes")
          .select("id, body, created_by_name, created_at")
          .eq("organization_id", authz.orgId)
          .eq("conversation_id", conversa.id)
          .order("created_at", { ascending: false })
          .limit(LIMITE_NOTAS)
      : Promise.resolve({ data: [] }),
    admin
      .from("crm_tasks")
      .select("id, title, kind, notes, due_at, status, assigned_to_user_id")
      .eq("organization_id", authz.orgId)
      .eq("lead_id", leadId)
      .order("due_at", { ascending: true })
      .limit(LIMITE_TAREFAS),
    // A R1 anterior é o insumo da R2: nota, desfecho e resumo do que o cliente
    // disse. Sem isto, preparar a R2 é reabrir a transcrição inteira.
    admin
      .from("crm_meetings")
      .select("id, meeting_type, status, started_at, score, outcome, summary")
      .eq("organization_id", authz.orgId)
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(LIMITE_REUNIOES),
  ]);

  return withCorsHeaders(
    ok(
      {
        lead: {
          id: lead.id,
          title: lead.title,
          etapa: etapa?.name ?? null,
          value_cents: lead.value_cents,
          currency: lead.currency,
          tags: lead.tags ?? [],
          custom_fields: lead.custom_fields ?? {},
        },
        contato: contato
          ? {
              id: contato.id,
              nome: contato.display_name ?? contato.name ?? null,
              telefone: contato.phone_number,
            }
          : null,
        conversa: conversa
          ? { id: conversa.id, last_inbound_at: conversa.last_inbound_at }
          : null,
        reuniao: lerReuniao(lead.custom_fields),
        notas: notas.data ?? [],
        tarefas: tarefas.data ?? [],
        reunioes_anteriores: anteriores.data ?? [],
      },
      { requestId },
    ),
    req,
  );
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const { leadId } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = toggleItemPreparoSchema.safeParse(body);
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Corpo inválido.", 422, {
        requestId,
        details: { issues: parsed.error.issues },
      }),
      req,
    );
  }

  const admin = createAdminClient();
  const lead = await carregarLead(admin, authz.orgId, leadId);
  if (!lead) {
    return withCorsHeaders(fail("not_found", "Negócio não encontrado.", 404, { requestId }), req);
  }

  const reuniao = lerReuniao(lead.custom_fields);
  if (!reuniao) {
    return withCorsHeaders(
      fail("not_found", "Este negócio não tem reunião marcada.", 404, { requestId }),
      req,
    );
  }

  // Item tem de existir PARA ESTE TIPO de reunião. Sem este gate, o jsonb
  // aceitaria qualquer chave e o checklist viraria depósito de lixo silencioso
  // — o clássico do `custom_fields` sem schema central.
  if (!ehItemManual(parsed.data.item, reuniao.tipo)) {
    return withCorsHeaders(
      fail("invalid_request", "Item de preparo desconhecido para este tipo de reunião.", 422, {
        requestId,
      }),
      req,
    );
  }

  const checklist = { ...(reuniao.checklist ?? {}) };
  if (parsed.data.feito) checklist[parsed.data.item] = new Date().toISOString();
  else delete checklist[parsed.data.item];

  const campos =
    lead.custom_fields && typeof lead.custom_fields === "object" && !Array.isArray(lead.custom_fields)
      ? (lead.custom_fields as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("crm_leads")
    .update({ custom_fields: { ...campos, reuniao: { ...reuniao, checklist } } })
    .eq("id", leadId)
    .eq("organization_id", authz.orgId);

  if (error) {
    return withCorsHeaders(
      fail("internal_error", "Falha ao gravar o item do preparo.", 500, { requestId }),
      req,
    );
  }

  void audit({
    action: "meeting.prep_item_toggled",
    actorUserId: authz.userId,
    organizationId: authz.orgId,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: { item: parsed.data.item, feito: parsed.data.feito, tipo: reuniao.tipo },
  });

  return withCorsHeaders(ok({ reuniao: { ...reuniao, checklist } }, { requestId }), req);
}
