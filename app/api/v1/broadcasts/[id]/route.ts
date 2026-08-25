/**
 * GET   /api/v1/broadcasts/[id] — a campanha e o relatório dela.
 * PATCH /api/v1/broadcasts/[id] — edita, SÓ enquanto rascunho.
 *
 * Por que PATCH só em rascunho: depois de ativar existe fila. Trocar o texto no
 * meio faria a mesma campanha mandar duas mensagens diferentes e o relatório
 * deixaria de descrever o que foi enviado — quem recebeu antes da edição sumiria
 * do registro. Para mudar o texto: pausa, duplica, ativa a nova.
 *
 * O RELATÓRIO responde quatro perguntas, e as três últimas não têm coluna:
 * "quantos saíram" (status), "chegou?" (messages.ack >= 2), "leram?" (ack >= 3)
 * e "responderam?" (a conversa teve inbound DEPOIS do envio). Nenhuma delas
 * vira contador na tabela de propósito — contador sincronizado por cron é o
 * anti-pattern nº 5 do repo, e aqui a fonte já existe.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { editarDisparoSchema } from "@/lib/schemas/broadcasts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, name, status, pause_reason, body_template, media_type, media_storage_path, media_mime, media_size_bytes, audience, scheduled_at, daily_cap, max_recipients, send_as_user_id, channel_session_id, started_at, finished_at, created_at, updated_at";

/** Teto do drill-down de falhas/pulos na tela. */
const LIMITE_DE_DETALHE = 200;

interface LinhaDeDestinatario {
  status: string;
  skip_reason: string | null;
  last_error: string | null;
  sent_at: string | null;
  contacts: { display_name: string | null; name: string | null; phone_number: string | null } | null;
  messages: { ack: number | null } | null;
  conversations: { last_inbound_at: string | null } | null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();
  const { data: campanha, error } = await supabase
    .from("broadcasts")
    .select(COLUNAS)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();

  if (error) return fail("internal_error", "Falha ao ler o disparo.", 500, { requestId });
  if (!campanha) return fail("not_found", "Disparo não encontrado.", 404, { requestId });

  const { data: linhas } = await supabase
    .from("broadcast_recipients")
    .select(
      "status, skip_reason, last_error, sent_at, contacts:contact_id (display_name, name, phone_number), messages:message_id (ack), conversations:conversation_id (last_inbound_at)",
    )
    .eq("broadcast_id", id)
    .eq("organization_id", org.orgId)
    .order("created_at", { ascending: true })
    .limit(10000);

  const destinatarios = (linhas ?? []) as unknown as LinhaDeDestinatario[];

  const porStatus: Record<string, number> = {};
  const porMotivoDePulo: Record<string, number> = {};
  let entregues = 0;
  let lidos = 0;
  let responderam = 0;

  for (const d of destinatarios) {
    porStatus[d.status] = (porStatus[d.status] ?? 0) + 1;
    if (d.status === "skipped" && d.skip_reason) {
      porMotivoDePulo[d.skip_reason] = (porMotivoDePulo[d.skip_reason] ?? 0) + 1;
    }
    if (d.status !== "sent") continue;

    const ack = d.messages?.ack ?? 0;
    if (ack >= 2) entregues += 1;
    if (ack >= 3) lidos += 1;

    // Respondeu = a conversa recebeu mensagem do contato DEPOIS de o disparo
    // sair. Comparação de ISO em UTC, que é como o banco devolve.
    const inbound = d.conversations?.last_inbound_at;
    if (inbound && d.sent_at && inbound > d.sent_at) responderam += 1;
  }

  const problemas = destinatarios
    .filter((d) => d.status === "failed" || d.status === "skipped")
    .slice(0, LIMITE_DE_DETALHE)
    .map((d) => ({
      nome: d.contacts?.display_name ?? d.contacts?.name ?? null,
      telefone: d.contacts?.phone_number ?? null,
      status: d.status,
      motivo: d.skip_reason ?? d.last_error ?? null,
    }));

  return ok(
    {
      ...campanha,
      relatorio: {
        total: destinatarios.length,
        por_status: porStatus,
        por_motivo_de_pulo: porMotivoDePulo,
        entregues,
        lidos,
        responderam,
      },
      problemas,
    },
    { requestId },
  );
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = editarDisparoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  const { data: atual } = await supabase
    .from("broadcasts")
    .select("id, status")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();

  if (!atual) return fail("not_found", "Disparo não encontrado.", 404, { requestId });
  if ((atual as { status: string }).status !== "draft") {
    return fail(
      "conflict",
      "Esta campanha já foi ativada — só rascunho pode ser editado. Duplique para mudar o texto.",
      409,
      { requestId },
    );
  }

  const e = parsed.data;
  const patch: Record<string, unknown> = {};
  if (e.name !== undefined) patch.name = e.name;
  if (e.body_template !== undefined) patch.body_template = e.body_template;
  if (e.audience !== undefined) patch.audience = e.audience;
  if (e.scheduled_at !== undefined) patch.scheduled_at = e.scheduled_at;
  if (e.daily_cap !== undefined) patch.daily_cap = e.daily_cap;
  if (e.max_recipients !== undefined) patch.max_recipients = e.max_recipients;
  if (e.channel_session_id !== undefined) patch.channel_session_id = e.channel_session_id;

  if (Object.keys(patch).length === 0) {
    return fail("validation_failed", "Nada para alterar.", 422, { requestId });
  }

  const { data, error } = await supabase
    .from("broadcasts")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(COLUNAS)
    .single();

  if (error) {
    if (error.code === "23514") {
      return fail("validation_failed", "A campanha precisa de um texto ou de uma mídia.", 422, {
        requestId,
      });
    }
    return fail("internal_error", "Falha ao salvar o disparo.", 500, { requestId });
  }

  await audit({
    action: "broadcast.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "broadcast",
    resourceId: id,
    requestId,
    metadata: { campos: Object.keys(patch) },
  });

  return ok(data, { requestId });
}
