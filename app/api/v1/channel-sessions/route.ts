/**
 * GET  /api/v1/channel-sessions — lista os canais WhatsApp da org (do DB).
 *   Acessível a qualquer membro (usado pelo seletor do inbox e pela sidebar).
 * POST /api/v1/channel-sessions — conecta um NOVO número (cria a sessão com
 *   nome único e inicia no WAHA). Admin only.
 *
 * organization_id resolvido da sessão (cookie) — nunca do body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { createChannelSchema } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

export const CHANNEL_COLUMNS =
  "id, waha_session_name, display_name, phone_number, status, status_reason, last_health_check_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at";

/**
 * O modo da IA vive em `metadata->>'ai_mode'` (ver `modo-do-numero.ts`), e sai
 * daqui como campo próprio — só a chave, nunca o `metadata` inteiro, que é jsonb
 * de operação e não tem por que atravessar a API.
 */
const COLUNA_AI_MODE = "ai_mode:metadata->>ai_mode";

/**
 * ⚠️ Na dúvida responde `atendente`, igual ao `lerModoDoNumero` do motor.
 * Os dois lados têm que errar para o MESMO lado: se a tela dissesse "copiloto"
 * enquanto o motor entrega `send_message`, o número responderia sozinho com a
 * tela jurando que não. Errar para o lado visível é o certo aqui também.
 */
function comAiMode<T extends { ai_mode?: string | null }>(c: T) {
  return { ...c, ai_mode: c.ai_mode === "copiloto" ? "copiloto" : "atendente" };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const [{ data, error }, { data: atividade }] = await Promise.all([
    supabase
      .from("channel_sessions")
      .select(`${CHANNEL_COLUMNS}, ${COLUNA_AI_MODE}`)
      .eq("organization_id", activeOrg.orgId)
      // Número removido pelo usuário (0096) sai daqui — e com isso do seletor do
      // inbox, do sinal da sidebar e da Central. O histórico dele fica no banco.
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    // Atividade (0097): é o que distingue número vivo de número esquecido.
    // Status não distingue — dois "Conectado" já levaram à remoção do errado.
    supabase
      .from("v_channel_session_atividade")
      .select("channel_session_id, ultima_mensagem_em, conversas_7d, conversas_total")
      .eq("organization_id", activeOrg.orgId),
  ]);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const porSessao = new Map(
    (atividade ?? []).map((a) => [a.channel_session_id as string, a]),
  );

  const comAtividade = (data ?? []).map((c) => {
    const a = porSessao.get(c.id as string);
    return comAiMode({
      ...c,
      ultima_mensagem_em: (a?.ultima_mensagem_em as string | null) ?? null,
      conversas_7d: (a?.conversas_7d as number | undefined) ?? 0,
      conversas_total: (a?.conversas_total as number | undefined) ?? 0,
    });
  });

  return ok(comAtividade, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const waha = getWahaClient();
  if (!waha) {
    return fail(
      "waha_not_configured",
      "O serviço do WhatsApp (WAHA) não está ativo. Suba o container e tente de novo.",
      503,
      { requestId },
    );
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createChannelSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  // Nome de sessão único por canal — o hardcode `org_<8>` era 1 número por org.
  const sessionName = `org_${activeOrg.orgId.slice(0, 8)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;

  const { data: created, error: insErr } = await supabase
    .from("channel_sessions")
    .insert({
      organization_id: activeOrg.orgId,
      waha_session_name: sessionName,
      display_name: parsed.data.display_name ?? null,
      engine: "NOWEB",
      webhook_path_token: randomUUID().replace(/-/g, ""),
      webhook_secret_encrypted: Buffer.from([0]),
      status: "STARTING",
      last_status_change_at: new Date().toISOString(),
      consecutive_health_fails: 0,
      daily_message_limit: 250,
      metadata: {},
    })
    .select(`${CHANNEL_COLUMNS}, ${COLUNA_AI_MODE}`)
    .single();
  if (insErr || !created) {
    return fail("internal_error", insErr?.message ?? "channel_session_insert_failed", 500, { requestId });
  }

  try {
    await waha.startSession(sessionName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // Rollback: sem WAHA no ar, não deixamos um canal fantasma preso em STARTING.
    await supabase
      .from("channel_sessions")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .eq("id", created.id);
    return fail("waha_error", wahaFriendlyError(msg), 502, { requestId });
  }

  void audit({
    action: "channel.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: created.id,
    requestId,
    metadata: { waha_session_name: sessionName },
  });

  // Canal novo nasce com `metadata: {}` — sem a chave, e portanto `atendente`,
  // que é como todo número sempre se comportou. A tela precisa do campo mesmo
  // assim, senão o cartão recém-criado aparece sem modo até o próximo refetch.
  return ok(comAiMode(created), { requestId, status: 201 });
}
