/**
 * GET  /api/v1/conversations/[id]/notes — lista notas internas da conversa (nunca vai ao WhatsApp).
 * POST /api/v1/conversations/[id]/notes — cria nota interna (autor = user.id, org de authz).
 *
 * Ambos confirmam antes que a conversa pertence à org ativa (`.select("id").maybeSingle()`)
 * pra devolver 404 honesto em vez de vazar existência cross-org.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { extractGanchos, formatGanchoNote, GANCHO_NOTE_AUTHOR } from "@/lib/leads/ganchos";
import { createNoteSchema } from "@/lib/schemas/notes";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isServiceRoleConfigured } from "@/lib/audit";

export const dynamic = "force-dynamic";
const COLS =
  "id, conversation_id, body, created_by_user_id, created_by_name, created_at, mentions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversation_notes" });
  if (!authz.ok) return authz.response;
  const { org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (!conversation) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const { data, error } = await supabase
    .from("conversation_notes")
    .select(COLS)
    .eq("conversation_id", id)
    .eq("organization_id", org.orgId)
    .order("created_at", { ascending: true });
  if (error) return fail("internal_error", "Erro ao listar notas.", 500, { requestId });

  let notes = data ?? [];

  // Ganchos de abertura da prospecção viram nota NA PRIMEIRA ABERTURA da
  // conversa — não na importação, porque lá a conversa ainda não existe (lead
  // importado só ganha conversa quando alguém puxa papo). Semear aqui é o
  // único ponto que cobre todos os caminhos de criação de conversa (WAHA,
  // automação, handoff) sem tocar em cada um. Dedupe pelo autor-marcador: já
  // tem nota do GANCHO_NOTE_AUTHOR → não semeia de novo (apagar a nota é
  // decisão do time e fica apagada). Falha na semeadura não derruba a
  // listagem — gancho é enriquecimento, não gate.
  const jaSemeada = notes.some(
    (n) => n.created_by_user_id === null && n.created_by_name === GANCHO_NOTE_AUTHOR,
  );
  if (!jaSemeada && conversation.contact_id) {
    const { data: leadsDoContato } = await supabase
      .from("crm_leads")
      .select("custom_fields")
      .eq("organization_id", org.orgId)
      .eq("contact_id", conversation.contact_id)
      .order("created_at", { ascending: false })
      .limit(5);
    const ganchos = (leadsDoContato ?? []).flatMap((l) => extractGanchos(l.custom_fields));
    if (ganchos.length > 0) {
      const { data: semeada } = await supabase
        .from("conversation_notes")
        .insert({
          organization_id: org.orgId,
          conversation_id: id,
          body: formatGanchoNote(ganchos),
          created_by_user_id: null,
          created_by_name: GANCHO_NOTE_AUTHOR,
        })
        .select(COLS)
        .single();
      if (semeada) notes = [...notes, semeada];
    }
  }

  return ok(notes, { requestId });
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversation_notes" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (!conversation) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const raw = await req.json().catch(() => null);
  const parsed = createNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  // 0110 — quem foi citado com @. A tela manda ids; aqui se confere que cada um
  // é MEMBRO ATIVO da org ativa antes de gravar: id vindo do navegador é entrada
  // de fora, e sem a conferência qualquer uuid entraria na coluna que decide o
  // sino de outra pessoa. O próprio autor sai da lista — marcar a si mesmo
  // acenderia um aviso que já se sabe.
  //
  // A leitura usa service role + filtro explícito de org (mesma doutrina de
  // /api/v1/team/assignable): a RLS de `user_organizations` só mostra o PRÓPRIO
  // vínculo a um agent, então sem ela a conferência reprovaria todo mundo.
  const pedidas = (parsed.data.mentions ?? []).filter((uid) => uid !== user.id);
  let mentions: string[] = [];
  if (pedidas.length > 0) {
    const membrosClient = isServiceRoleConfigured() ? createAdminClient() : supabase;
    const { data: membros } = await membrosClient
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", org.orgId)
      .is("revoked_at", null)
      .neq("role", "viewer")
      .in("user_id", pedidas);
    mentions = (membros ?? []).map((m) => m.user_id as string);
  }

  const { data, error } = await supabase
    .from("conversation_notes")
    .insert({
      organization_id: org.orgId,
      conversation_id: id,
      body: parsed.data.body,
      created_by_user_id: user.id,
      created_by_name: user.full_name ?? null,
      mentions,
    })
    .select(COLS)
    .single();
  if (error || !data) return fail("internal_error", "Erro ao criar nota.", 500, { requestId });

  void audit({
    action: "conversation.note_added",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation_note",
    resourceId: data.id,
    requestId,
    metadata: { conversation_id: id, mentions: mentions.length },
  });
  return ok(data, { requestId, status: 201 });
}
