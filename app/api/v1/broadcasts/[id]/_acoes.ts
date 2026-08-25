/**
 * Pausar / retomar / cancelar uma campanha — o miolo compartilhado das três
 * rotas (o repo prefere rota explícita por verbo, ver followup-flows/publish|
 * disable|rollback; a lógica mora aqui para não existir em triplicata).
 *
 * A transição é validada contra o estado atual e é IDEMPOTENTE: pausar o que já
 * está pausado responde 200, não 409. Botão de emergência que devolve erro
 * quando apertado duas vezes é botão que o operador aprende a não confiar.
 *
 * Cancelar é terminal e mata a fila (`pending` → `cancelled`) — o que já saiu
 * não volta, e é isso que o relatório continua mostrando.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AcaoDeCampanha = "pause" | "resume" | "cancel";

/** De quais estados cada ação parte. Fora disso é 409 com frase explicando. */
const ORIGENS: Record<AcaoDeCampanha, string[]> = {
  pause: ["running", "scheduled"],
  resume: ["paused"],
  cancel: ["draft", "scheduled", "running", "paused"],
};

/** Estado em que a ação já está satisfeita — responde 200 sem mexer. */
const JA_ESTA: Record<AcaoDeCampanha, string[]> = {
  pause: ["paused"],
  resume: ["running"],
  cancel: ["cancelled"],
};

const RECUSA: Record<AcaoDeCampanha, string> = {
  pause: "Só dá para pausar campanha em andamento.",
  resume: "Só dá para retomar campanha pausada.",
  cancel: "Esta campanha já terminou.",
};

export async function executarAcao(
  broadcastId: string,
  acao: AcaoDeCampanha,
): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;

  const supabase = await createClient();
  const { data: atual } = await supabase
    .from("broadcasts")
    .select("id, status, scheduled_at")
    .eq("id", broadcastId)
    .eq("organization_id", org.orgId)
    .maybeSingle();

  if (!atual) return fail("not_found", "Disparo não encontrado.", 404, { requestId });
  const campanha = atual as { status: string; scheduled_at: string | null };

  if (JA_ESTA[acao].includes(campanha.status)) {
    return ok({ status: campanha.status, mudou: false }, { requestId });
  }
  if (!ORIGENS[acao].includes(campanha.status)) {
    return fail("conflict", RECUSA[acao], 409, { requestId });
  }

  // Retomar uma campanha que estava agendada para o futuro devolve ela ao
  // agendamento, não dispara na hora.
  const aindaAgendada =
    acao === "resume" && campanha.scheduled_at && new Date(campanha.scheduled_at) > new Date();

  const novoStatus =
    acao === "pause" ? "paused" : acao === "cancel" ? "cancelled" : aindaAgendada ? "scheduled" : "running";

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    status: novoStatus,
    pause_reason: acao === "pause" ? "manual" : null,
  };
  if (acao === "cancel") patch.finished_at = new Date().toISOString();
  if (acao === "resume" && !aindaAgendada) patch.started_at = new Date().toISOString();

  const { error } = await admin
    .from("broadcasts")
    .update(patch)
    .eq("id", broadcastId)
    .eq("organization_id", org.orgId);

  if (error) {
    return fail("internal_error", "Falha ao mudar o estado do disparo.", 500, { requestId });
  }

  // Cancelar esvazia a fila. Quem já foi enviado/pulado fica como está — é o
  // registro do que aconteceu.
  if (acao === "cancel") {
    await admin
      .from("broadcast_recipients")
      .update({ status: "cancelled" })
      .eq("broadcast_id", broadcastId)
      .eq("organization_id", org.orgId)
      .in("status", ["pending", "sending"]);
  }

  await audit({
    action: `broadcast.${acao}`,
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "broadcast",
    resourceId: broadcastId,
    requestId,
    metadata: { de: campanha.status, para: novoStatus },
  });

  return ok({ status: novoStatus, mudou: true }, { requestId });
}
