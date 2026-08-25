/**
 * POST /api/v1/broadcasts/[id]/activate — o ponto de não-retorno.
 *
 * Aqui o filtro vira LINHA: cada contato do público ganha uma linha em
 * `broadcast_recipients` ANTES de qualquer envio. Depois disto o worker só
 * consome o que já está escrito — o funil não é consultado de novo. Isso é o
 * que torna o disparo previsível: um lead que entrar no funil amanhã não é
 * arrastado para a campanha de hoje.
 *
 * A INSERÇÃO É IDEMPOTENTE por construção (`on conflict do nothing` sobre a
 * unique `(broadcast_id, contact_id)`). Ativar duas vezes, ou reativar depois de
 * uma pausa, não duplica destinatário nem reenvia para quem já recebeu — é a
 * mesma disciplina que a 0064 impôs à cadência depois do dia em que 38 leads
 * viraram 4.566 inscrições.
 *
 * Quem já vem reprovado nos guards (sem telefone, bloqueado, telefone
 * divergente) entra JÁ como `skipped`, com o motivo. Duas razões: o relatório
 * final soma o público inteiro, e o worker não gasta tick com quem nunca teve
 * chance.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { resolverPublico } from "@/lib/broadcasts/audience";
import { lerConfigDeDisparos } from "@/lib/broadcasts/interruptor";
import { ativarDisparoSchema } from "@/lib/schemas/broadcasts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FiltroDePublico } from "@/lib/broadcasts/audience";

export const dynamic = "force-dynamic";

/** Lote do insert. O PostgREST aguenta mais, mas 500 mantém a request curta. */
const LOTE = 500;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    // Body vazio é aceitável: a confirmação de contagem é opcional.
  }
  const parsed = ativarDisparoSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data: campanhaRaw } = await supabase
    .from("broadcasts")
    .select(
      "id, name, status, body_template, media_storage_path, media_type, audience, scheduled_at, max_recipients",
    )
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();

  if (!campanhaRaw) return fail("not_found", "Disparo não encontrado.", 404, { requestId });
  const campanha = campanhaRaw as {
    id: string;
    name: string;
    status: string;
    body_template: string | null;
    media_storage_path: string | null;
    media_type: string | null;
    audience: unknown;
    scheduled_at: string | null;
    max_recipients: number;
  };

  if (campanha.status !== "draft") {
    return fail("conflict", "Esta campanha já foi ativada.", 409, { requestId });
  }
  if (!campanha.body_template?.trim() && !campanha.media_storage_path) {
    return fail("validation_failed", "A campanha precisa de um texto ou de uma mídia.", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();

  // Interruptor da org ANTES de materializar: ativar com os disparos desligados
  // criaria uma campanha `running` que não anda, e o operador ficaria olhando
  // para uma barra parada sem explicação.
  const cfg = await lerConfigDeDisparos(admin, org.orgId);
  if (cfg === null || !cfg.enabled) {
    return fail(
      "conflict",
      "Os disparos estão desligados nas configurações da organização.",
      409,
      { requestId },
    );
  }

  // Teto de campanhas simultâneas: todas dividem o mesmo chip e o mesmo teto
  // diário, então rodar cinco juntas não manda mais rápido — só embaralha a
  // ordem em que os leads recebem.
  const { count: rodando } = await admin
    .from("broadcasts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId)
    .in("status", ["running", "scheduled"]);

  if ((rodando ?? 0) >= cfg.max_running) {
    return fail(
      "conflict",
      `Já há ${rodando} campanha(s) em andamento (limite ${cfg.max_running}). Espere terminar ou pause uma.`,
      409,
      { requestId },
    );
  }

  // Público resolvido com o client do USUÁRIO (RLS) — a mesma porta do preview.
  let candidatos;
  try {
    candidatos = await resolverPublico(
      supabase,
      org.orgId,
      (campanha.audience ?? {}) as FiltroDePublico,
      campanha.max_recipients,
    );
  } catch {
    return fail("internal_error", "Falha ao montar o público.", 500, { requestId });
  }

  if (candidatos.length === 0) {
    return fail("conflict", "Nenhum contato casou com esse filtro.", 409, { requestId });
  }

  // O público mudou entre a revisão e o clique? Parar é melhor que disparar
  // para gente que a pessoa não viu na tela.
  const confirmado = parsed.data.confirmed_count;
  if (confirmado !== undefined && confirmado !== candidatos.length) {
    return fail(
      "conflict",
      `O público mudou desde a revisão (era ${confirmado}, agora ${candidatos.length}). Confira de novo antes de ativar.`,
      409,
      { requestId },
    );
  }

  // Insert em lotes, ignorando duplicata: a unique (broadcast_id, contact_id) é
  // quem garante um envio por contato, mesmo com o botão clicado duas vezes.
  let inseridos = 0;
  for (let i = 0; i < candidatos.length; i += LOTE) {
    const lote = candidatos.slice(i, i + LOTE).map((c) => ({
      organization_id: org.orgId,
      broadcast_id: id,
      contact_id: c.contact_id,
      lead_id: c.lead_id,
      status: c.motivoDePulo ? "skipped" : "pending",
      skip_reason: c.motivoDePulo,
    }));
    const { data, error } = await admin
      .from("broadcast_recipients")
      .upsert(lote, { onConflict: "broadcast_id,contact_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      return fail("internal_error", `Falha ao montar a fila: ${error.message}`, 500, { requestId });
    }
    inseridos += (data ?? []).length;
  }

  const agendada = campanha.scheduled_at && new Date(campanha.scheduled_at) > new Date();
  const { error: upErr } = await admin
    .from("broadcasts")
    .update({
      status: agendada ? "scheduled" : "running",
      pause_reason: null,
      started_at: agendada ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", org.orgId);

  if (upErr) {
    return fail("internal_error", "A fila foi montada mas a campanha não iniciou.", 500, {
      requestId,
    });
  }

  const aptos = candidatos.filter((c) => !c.motivoDePulo).length;

  await audit({
    action: "broadcast.activated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "broadcast",
    resourceId: id,
    requestId,
    metadata: {
      publico: candidatos.length,
      aptos,
      pulados: candidatos.length - aptos,
      inseridos,
      agendada: Boolean(agendada),
    },
  });

  return ok(
    {
      status: agendada ? "scheduled" : "running",
      publico: candidatos.length,
      aptos,
      pulados: candidatos.length - aptos,
    },
    { requestId },
  );
}
