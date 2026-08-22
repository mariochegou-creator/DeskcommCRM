/**
 * POST /api/v1/calls/[id]/reanalyze — rodar a análise de novo.
 *
 * POR QUE ISTO EXISTE. Antes, uma análise que falhava só voltava por SQL:
 * devolver o `event_log` para `pending`, zerar `attempts` e mexer no status da
 * gravação à mão. Na prática ninguém fazia — e a ligação, que já tinha sido
 * gravada e transcrita, ficava com um "Falhou" permanente na timeline. Todas as
 * causas reais de falha são passageiras e alheias ao áudio (conta do provedor
 * de IA sem crédito, chave faltando, gateway fora), então o botão que tenta de
 * novo conserta o caso comum sem tocar no banco.
 *
 * A TRANSCRIÇÃO É PRESERVADA de propósito. Se ela já existe, o worker pula o
 * Whisper e vai direto ao modelo: reprocessar custa centavos em vez de pagar
 * outra vez pelo áudio inteiro. É o mesmo desvio que a retentativa automática
 * usa; aqui ele fica disponível para a pessoa.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: callId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_call_recordings" });
  if (!authz.ok) return authz.response;
  const { user } = authz;

  const supabase = await createClient();
  const { data: call, error } = await supabase
    .from("crm_call_recordings")
    .select("id, organization_id, status, storage_path, transcript")
    .eq("id", callId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!call) return fail("not_found", "Ligação não encontrada.", 404, { requestId });

  const temTexto = Boolean(call.transcript?.trim());
  if (!call.storage_path && !temTexto) {
    // Sem áudio e sem texto não há o que analisar — e um evento emitido aqui só
    // faria o worker devolver `skipped` cinco vezes.
    return fail("call_has_no_audio", "Esta ligação não tem gravação para analisar.", 409, {
      requestId,
    });
  }
  if (call.status === "transcribing" || call.status === "analyzing") {
    return fail("call_already_processing", "Esta ligação já está sendo processada.", 409, {
      requestId,
    });
  }

  const admin = createAdminClient();

  // A análise antiga sai da linha ANTES do reprocessamento. Deixá-la ali
  // enquanto a nova roda mostraria ao SDR uma nota que já não vale, sem nada na
  // tela dizendo que ela está sendo refeita.
  const { error: updErr } = await admin
    .from("crm_call_recordings")
    .update({
      status: temTexto ? "analyzing" : "transcribing",
      analysis: null,
      outcome: null,
      score: null,
      error_detail: null,
    })
    .eq("id", call.id)
    .eq("organization_id", call.organization_id);
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "call.transcribe_requested",
    p_entity_kind: "call_recording",
    p_entity_id: call.id,
    p_payload: { call_id: call.id },
    p_metadata: { source: "calls_reanalyze" },
    p_organization_id: call.organization_id,
  } as never);
  if (emitErr) {
    logger.error("[calls] reanalyze: emit_event falhou", {
      call_id: call.id,
      detail: emitErr.message,
      requestId,
    });
    await admin
      .from("crm_call_recordings")
      .update({
        status: "failed",
        error_detail: `Não foi possível enfileirar o reprocessamento: ${emitErr.message}`,
      })
      .eq("id", call.id)
      .eq("organization_id", call.organization_id);
    return fail("enqueue_failed", "O reprocessamento não foi enfileirado.", 502, { requestId });
  }

  void audit({
    action: "call.reanalyze_requested",
    actorUserId: user.id,
    organizationId: call.organization_id,
    resourceType: "crm_call_recordings",
    resourceId: call.id,
    requestId,
    bypassedRls: true,
    metadata: { reaproveitou_transcricao: temTexto },
  });

  return ok({ call_id: call.id, status: temTexto ? "analyzing" : "transcribing" }, { requestId });
}
