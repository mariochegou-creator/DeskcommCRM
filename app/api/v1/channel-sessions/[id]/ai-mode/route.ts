/**
 * PATCH /api/v1/channel-sessions/[id]/ai-mode — troca o modo da IA NESTE número.
 *
 * O que estava errado antes desta rota: o freio que impede a IA de falar com o
 * cliente já existia e funcionava (`lib/agent-engine/edge/crm/modo-do-numero.ts`),
 * mas morava só em `channel_sessions.metadata->>'ai_mode'` — sem tela, sem
 * leitura, sem jeito de conferir. Quem operava não tinha como responder "a IA
 * está calada neste número?" a não ser abrindo o banco. Um freio que ninguém vê
 * é um freio em que ninguém confia.
 *
 * ⚠️ PATCH, e não POST: isto não é uma ação com efeito no WAHA (como reconnect),
 * é a edição de um campo do canal. O corpo é `{ ai_mode: 'atendente' | 'copiloto' }`.
 *
 * ⚠️ O `metadata` é lido e reescrito por inteiro, não sobrescrito. É jsonb
 * compartilhado com outras chaves de operação — gravar `{ ai_mode }` puro
 * apagaria o resto em silêncio, e o estrago só apareceria dias depois.
 *
 * Admin only, como todo knob que muda o comportamento de um número inteiro.
 * organization_id vem da sessão — nunca do path/body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODOS = ["atendente", "copiloto"] as const;
type Modo = (typeof MODOS)[number];

function ehModo(v: unknown): v is Modo {
  return typeof v === "string" && (MODOS as readonly string[]).includes(v);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const pedido = (raw ?? {}) as { ai_mode?: unknown };
  if (!ehModo(pedido.ai_mode)) {
    return fail("validation_failed", "Informe ai_mode: 'atendente' ou 'copiloto'.", 422, {
      requestId,
    });
  }
  const novo: Modo = pedido.ai_mode;

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, display_name, phone_number, waha_session_name, metadata")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  const anterior: Modo = metadata.ai_mode === "copiloto" ? "copiloto" : "atendente";

  const { error: upErr } = await supabase
    .from("channel_sessions")
    .update({ metadata: { ...metadata, ai_mode: novo } })
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id);
  if (upErr) return fail("internal_error", upErr.message, 500, { requestId });

  // Auditar mesmo quando não mudou: "quem mexeu nisso e quando" é a pergunta
  // que se faz depois que um número respondeu (ou deixou de responder) sozinho.
  void audit({
    action: "channel.ai_mode_changed",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      de: anterior,
      para: novo,
      numero: session.phone_number,
      waha_session_name: session.waha_session_name,
    },
  });

  return ok({ id, ai_mode: novo, anterior }, { requestId });
}
