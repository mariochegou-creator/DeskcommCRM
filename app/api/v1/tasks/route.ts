/**
 * GET  /api/v1/tasks — as tarefas do time (0101), recortadas por escopo.
 * POST /api/v1/tasks — cria uma tarefa presa a uma conversa/negócio.
 *
 * Client USER-SCOPED na leitura: a RLS de `crm_tasks` já escopa as orgs do
 * usuário, e o filtro explícito da org ATIVA vem junto pela mesma razão da rota
 * do plano — a RLS enxerga TODAS as orgs de quem participa de duas, e a tela é
 * de uma só.
 *
 * O POST valida VÍNCULO por vínculo contra a org ativa (dono, conversa,
 * contato, negócio). A RLS garante que a LINHA nasce na org certa; ela não tem
 * como saber se o `conversation_id` que veio no corpo é de outra organização —
 * e uma tarefa apontando para fora da org é um vazamento silencioso: o título
 * aparece na lista de quem não deveria ver aquele lead.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { criarTarefaSchema, ESCOPOS_DE_TAREFA, type EscopoDeTarefa } from "@/lib/schemas/tarefas";

export const dynamic = "force-dynamic";

/** As colunas que a tela precisa — nunca `select("*")` (contrato explícito). */
const COLUNAS =
  "id, title, kind, notes, due_at, status, assigned_to_user_id, created_by_user_id, conversation_id, contact_id, lead_id, resolved_at, resolved_by_user_id, created_at, updated_at";

/** Teto de linhas por leitura. A aba pagina por status, não por scroll infinito. */
const LIMITE = 200;

function escopoDaQuery(raw: string | null): EscopoDeTarefa {
  return (ESCOPOS_DE_TAREFA as readonly string[]).includes(raw ?? "")
    ? (raw as EscopoDeTarefa)
    : "minhas";
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const url = new URL(req.url);
  const escopo = escopoDaQuery(url.searchParams.get("escopo"));
  const status = url.searchParams.get("status"); // 'abertas' | 'feitas' | 'todas'
  const conversationId = url.searchParams.get("conversation_id");

  const supabase = await createClient();
  let q = supabase.from("crm_tasks").select(COLUNAS).eq("organization_id", org.orgId);

  if (escopo === "minhas") {
    q = q.eq("assigned_to_user_id", user.id);
  } else if (escopo === "criadas") {
    q = q.eq("created_by_user_id", user.id);
  } else if (escopo === "alerta") {
    // O número vermelho do menu: pendente, já vencida, e minha por um dos dois
    // lados (executo ou pedi). `or` do PostgREST — os dois lados na MESMA
    // condição, senão viraria uma segunda consulta e o total contaria duas
    // vezes a tarefa que eu criei para mim mesmo.
    q = q
      .eq("status", "pending")
      .lte("due_at", new Date().toISOString())
      .or(`assigned_to_user_id.eq.${user.id},created_by_user_id.eq.${user.id}`);
  }

  if (escopo !== "alerta") {
    if (status === "feitas") q = q.neq("status", "pending");
    else if (status !== "todas") q = q.eq("status", "pending");
  }

  if (conversationId) q = q.eq("conversation_id", conversationId);

  const { data, error } = await q
    .order("due_at", { ascending: escopo !== "alerta" ? true : false })
    .limit(LIMITE);

  if (error) {
    return fail("internal_error", "Falha ao listar as tarefas.", 500, { requestId });
  }

  return ok({ tasks: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = criarTarefaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const entrada = parsed.data;
  const dono = entrada.assigned_to_user_id ?? user.id;

  // Dono tem de ser membro VIVO da org ativa. Sem esta checagem, um id de outra
  // organização criaria uma tarefa que ninguém daqui consegue resolver e que
  // some da vista de todo mundo — trabalho perdido sem erro nenhum na tela.
  if (dono !== user.id) {
    const membros = isServiceRoleConfigured() ? createAdminClient() : await createClient();
    const { data: membro, error: erroMembro } = await membros
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", org.orgId)
      .eq("user_id", dono)
      .is("revoked_at", null)
      .maybeSingle();
    if (erroMembro) {
      return fail("internal_error", "Falha ao validar o responsável.", 500, { requestId });
    }
    if (!membro) {
      return fail("invalid_request", "Responsável não é membro desta organização.", 422, {
        requestId,
      });
    }
  }

  const supabase = await createClient();

  // Cada vínculo é conferido contra a org ativa (ver o cabeçalho). A leitura é
  // user-scoped de propósito: o que a RLS não deixa a pessoa ler, ela também
  // não pode amarrar numa tarefa.
  const vinculos: Array<[string, string | undefined]> = [
    ["conversations", entrada.conversation_id],
    ["contacts", entrada.contact_id],
    ["crm_leads", entrada.lead_id],
  ];
  for (const [tabela, id] of vinculos) {
    if (!id) continue;
    const { data: achado, error: erroVinculo } = await supabase
      .from(tabela as "conversations")
      .select("id")
      .eq("id", id)
      .eq("organization_id", org.orgId)
      .maybeSingle();
    if (erroVinculo) {
      return fail("internal_error", "Falha ao validar o vínculo da tarefa.", 500, { requestId });
    }
    if (!achado) {
      return fail("invalid_request", `Vínculo inválido nesta organização (${tabela}).`, 422, {
        requestId,
      });
    }
  }

  const { data, error } = await supabase
    .from("crm_tasks")
    .insert({
      organization_id: org.orgId,
      title: entrada.title,
      kind: entrada.kind,
      notes: entrada.notes && entrada.notes.length > 0 ? entrada.notes : null,
      due_at: new Date(entrada.due_at).toISOString(),
      assigned_to_user_id: dono,
      created_by_user_id: user.id,
      conversation_id: entrada.conversation_id ?? null,
      contact_id: entrada.contact_id ?? null,
      lead_id: entrada.lead_id ?? null,
    })
    .select(COLUNAS)
    .single();

  if (error || !data) {
    return fail("internal_error", "Falha ao criar a tarefa.", 500, { requestId });
  }

  await audit({
    action: "task.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "crm_tasks",
    resourceId: data.id,
    metadata: {
      kind: entrada.kind,
      due_at: data.due_at,
      // Delegação é o que se audita aqui: tarefa para si mesmo é lembrete,
      // tarefa para outro é combinado entre duas pessoas.
      delegada: dono !== user.id,
      assigned_to_user_id: dono,
    },
    requestId,
  });

  return ok({ task: data }, { requestId, status: 201 });
}
