/**
 * GET    /api/v1/channel-sessions/[id] — health check AO VIVO de um canal.
 * DELETE /api/v1/channel-sessions/[id] — remove o número da Central (admin).
 *
 * O GET consulta o status real no WAHA, grava `last_health_check_at` (+
 * sincroniza `status`) no DB e devolve o estado atual. É a fonte de verdade
 * quando o usuário abre a Central de Conexões ou aguarda o QR ser escaneado.
 *
 * Qualquer membro da org pode consultar. organization_id vem da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { isChannelStatus } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, waha_session_name, display_name, phone_number, status")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const waha = getWahaClient();
  if (!waha) {
    // Sem WAHA ativo: devolve o que está no DB, sinalizando que não deu p/ checar ao vivo.
    return ok({ ...session, waha_configured: false }, { requestId });
  }

  let liveStatus = session.status as string;
  let phoneNumber = session.phone_number as string | null;
  try {
    const remote = (await waha.getSessionQr(session.waha_session_name)) as {
      status?: string;
      me?: { id?: string; pushName?: string };
    };
    if (remote.status) liveStatus = remote.status;
    // WAHA expõe o número (JID `<phone>@c.us`) quando a sessão está WORKING.
    // Vale MAIS que a coluna do banco: quando o mesmo telefone está vinculado
    // em duas sessões, a unique (org, phone_number) deixa a coluna vazia numa
    // delas — e foi o card em branco que fez o número certo ser removido por
    // engano em 09/08/2026. Aqui a resposta sempre carrega o número de verdade.
    const jid = remote.me?.id;
    if (jid) phoneNumber = jid.replace(/@.*/, "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    // 404 no WAHA = sessão não iniciada lá → considera STOPPED.
    if (msg.includes("404")) liveStatus = "STOPPED";
    // outros erros: mantém o status do DB (não sobrescreve com ruído transitório).
  }

  // Sincroniza o DB: sempre carimba o health check; atualiza status/telefone só se válido.
  const patch: Record<string, unknown> = { last_health_check_at: new Date().toISOString() };
  if (isChannelStatus(liveStatus) && liveStatus !== session.status) {
    patch.status = liveStatus;
    patch.last_status_change_at = new Date().toISOString();
  }
  if (phoneNumber && phoneNumber !== session.phone_number) patch.phone_number = phoneNumber;

  const alvo = () =>
    supabase.from("channel_sessions").update(patch).eq("organization_id", activeOrg.orgId).eq("id", id);
  const { error: upErr } = await alvo();
  if (upErr && patch.phone_number) {
    // Mesmo telefone vinculado em duas sessões → colide na unique
    // (organization_id, phone_number). Antes o erro era engolido e o
    // last_health_check_at NUNCA avançava nesse canal ("Ainda não verificado"
    // para sempre). Regrava sem o telefone: o carimbo de saúde é o que importa
    // no banco, e o número correto já vai na resposta abaixo.
    delete patch.phone_number;
    await alvo();
  }

  return ok(
    {
      id: session.id,
      waha_session_name: session.waha_session_name,
      display_name: session.display_name,
      phone_number: phoneNumber,
      status: liveStatus,
      last_health_check_at: patch.last_health_check_at,
      waha_configured: true,
    },
    { requestId },
  );
}

/**
 * DELETE /api/v1/channel-sessions/[id] — remove o número da Central. Admin.
 *
 * Dois desfechos, decididos pelo próprio banco:
 *
 * 1. **Número virgem** (nenhuma conversa e nenhuma mensagem apontando pra ele
 *    — erro de digitação, QR nunca escaneado): apaga a linha de verdade. Não
 *    sobra nada.
 * 2. **Número com histórico**: carimba `archived_at`. Some de Conexões, do
 *    seletor do inbox, do canal do agente/roteador e do webhook — e as
 *    conversas antigas continuam abrindo. Um DELETE aqui seria recusado pelo
 *    banco de qualquer jeito (`conversations`/`messages` referenciam com
 *    ON DELETE RESTRICT); arquivar é o que o usuário quer dizer com "remover".
 *
 * O `phone_number` é zerado no arquivamento porque a unique
 * (organization_id, phone_number) bloquearia reconectar o MESMO número depois.
 * O rótulo é preservado em `display_name` antes de zerar.
 *
 * A sessão no WAHA é parada em best-effort: se o container estiver fora do ar,
 * a remoção acontece do mesmo jeito (o ingest descarta evento de sessão
 * arquivada, então nada volta a entrar).
 */
export async function DELETE(
  _req: NextRequest,
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

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, waha_session_name, display_name, phone_number, archived_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });
  if (session.archived_at) {
    return fail("already_archived", "Este número já foi removido.", 409, { requestId });
  }

  // Best-effort: parar + APAGAR no WAHA. O stop sozinho não resolve — a sessão
  // fica salva em disco e volta a WORKING no próximo restart do container, com
  // o aparelho ainda plugado no celular do dono. WAHA fora do ar não pode
  // travar a remoção no painel, por isso o try/catch.
  const waha = getWahaClient();
  if (waha) {
    try {
      await waha.stopSession(session.waha_session_name);
      await waha.deleteSession(session.waha_session_name);
    } catch {
      // container fora / sessão inexistente — segue para a remoção no DB
    }
  }

  // Tem histórico pendurado? Uma linha de cada tabela basta para decidir.
  const [{ count: convCount }, { count: msgCount }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .eq("channel_session_id", id),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .eq("channel_session_id", id),
  ]);
  const temHistorico = (convCount ?? 0) > 0 || (msgCount ?? 0) > 0;

  const rotulo = session.display_name || session.phone_number || session.waha_session_name;

  if (!temHistorico) {
    const { error: delErr } = await supabase
      .from("channel_sessions")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);
    // FK RESTRICT que escapou da checagem acima (corrida com uma mensagem
    // chegando neste exato instante): cai para o arquivamento em vez de 500.
    if (!delErr) {
      void audit({
        action: "channel.removed",
        actorUserId: user.id,
        organizationId: activeOrg.orgId,
        resourceType: "channel_session",
        resourceId: id,
        requestId,
        metadata: { waha_session_name: session.waha_session_name, modo: "apagado" },
      });
      return ok({ id, modo: "apagado" as const, rotulo }, { requestId });
    }
  }

  const { error: arqErr } = await supabase
    .from("channel_sessions")
    .update({
      archived_at: new Date().toISOString(),
      status: "STOPPED",
      status_reason: "removido pelo usuário",
      last_status_change_at: new Date().toISOString(),
      // Libera a unique (org, phone_number) para reconectar o mesmo número.
      display_name: rotulo,
      phone_number: null,
    })
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id);
  if (arqErr) return fail("internal_error", arqErr.message, 500, { requestId });

  void audit({
    action: "channel.removed",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      waha_session_name: session.waha_session_name,
      modo: "arquivado",
      conversas: convCount ?? 0,
    },
  });

  return ok({ id, modo: "arquivado" as const, rotulo, conversas: convCount ?? 0 }, { requestId });
}
