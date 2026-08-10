/**
 * POST /api/v1/calls/[id]/audio
 *
 * O áudio da ligação entra aqui — do popup de gravação (automático, ao encerrar)
 * ou do botão "Subir áudio da ligação" (plano B, gravador do celular).
 *
 * Multipart, campo `file`. Depois de gravar o binário no bucket, emite
 * `call.transcribe_requested` no `event_log` e devolve. O pipeline de
 * transcrição/análise roda no worker: prender o SDR num request enquanto o
 * Whisper mastiga cinco minutos de áudio é como o upload passa a falhar por
 * timeout de gateway — e aí o áudio se perde depois de já ter subido.
 *
 * TENANCY: o upload usa o admin client (service role bypassa RLS), então a org
 * NUNCA vem do body. Ela é lida da própria gravação pelo client do caller, que
 * já passou pela RLS — se a linha não aparece para ele, não é dele.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  CALL_BUCKET,
  MAX_CALL_AUDIO_BYTES,
  callStoragePath,
  isAllowedCallMime,
  normalizeMime,
} from "@/lib/calls/storage";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: callId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_call_recordings" });
  if (!authz.ok) return authz.response;
  const { user } = authz;

  const supabase = await createClient();

  // A gravação vem pela RLS do caller — é ela que prova a org.
  const { data: call, error: callErr } = await supabase
    .from("crm_call_recordings")
    .select("id, organization_id, contact_id, status, storage_path")
    .eq("id", callId)
    .maybeSingle();
  if (callErr) return fail("internal_error", callErr.message, 500, { requestId });
  if (!call) return fail("not_found", "Ligação não encontrada.", 404, { requestId });

  if (call.storage_path) {
    // Reenviar áudio para uma ligação que já tem um trocaria a gravação por
    // outra com a análise antiga ainda na tela. Recusa explícita em vez de
    // sobrescrever: o SDR registra uma ligação nova, que é o que de fato houve.
    return fail("call_audio_already_uploaded", "Esta ligação já tem áudio.", 409, { requestId });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("validation_failed", "Envie o áudio como multipart/form-data.", 422, { requestId });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return fail("validation_failed", "Campo `file` ausente.", 422, { requestId });
  }

  // O mime vem do Blob, NUNCA do nome do arquivo — `file.name` é escolhido por
  // quem sobe. Ver o comentário da allowlist em lib/calls/storage.ts.
  const mime = normalizeMime(file.type);
  if (!isAllowedCallMime(mime)) {
    return fail(
      "unsupported_media_type",
      `Formato de áudio não suportado (${mime || "desconhecido"}).`,
      415,
      { requestId },
    );
  }

  if (file.size === 0) {
    return fail("validation_failed", "Arquivo de áudio vazio.", 422, { requestId });
  }
  if (file.size > MAX_CALL_AUDIO_BYTES) {
    return fail(
      "payload_too_large",
      `Áudio acima do limite de ${Math.floor(MAX_CALL_AUDIO_BYTES / 1024 / 1024)} MB.`,
      413,
      { requestId },
    );
  }

  const durationRaw = form.get("duration_seconds");
  const duration =
    typeof durationRaw === "string" && /^\d{1,6}$/.test(durationRaw)
      ? Number.parseInt(durationRaw, 10)
      : null;

  const admin = createAdminClient();
  const path = callStoragePath(call.organization_id, call.contact_id, call.id, mime);

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from(CALL_BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (uploadErr) {
    logger.error("[calls] upload falhou", {
      call_id: call.id,
      detail: uploadErr.message,
      requestId,
    });
    return fail("storage_upload_failed", uploadErr.message, 502, { requestId });
  }

  // `organization_id` no filtro mesmo com o id sendo único: o admin client
  // bypassa RLS, e a doutrina do repo é filtrar a org à mão em todo caminho que
  // usa service role. Um dia esta rota vira lote, e o filtro já está aqui.
  const { error: updErr } = await admin
    .from("crm_call_recordings")
    .update({
      storage_path: path,
      mime_type: mime,
      size_bytes: buffer.byteLength,
      duration_seconds: duration,
      status: "transcribing",
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
    p_metadata: { source: "calls_upload" },
    p_organization_id: call.organization_id,
  } as never);
  if (emitErr) {
    // O áudio JÁ está no bucket e a linha diz `transcribing`. Sem o evento, o
    // pipeline nunca começa e a tela ficaria em "Transcrevendo…" para sempre —
    // é o estado que mais parece "está funcionando, só demora". Marca como
    // falha com o motivo legível para o SDR poder reagir.
    logger.error("[calls] emit_event falhou", {
      call_id: call.id,
      detail: emitErr.message,
      requestId,
    });
    await admin
      .from("crm_call_recordings")
      .update({
        status: "failed",
        error_detail: `Não foi possível enfileirar o processamento: ${emitErr.message}`,
      })
      .eq("id", call.id)
      .eq("organization_id", call.organization_id);
    return fail("enqueue_failed", "Áudio recebido, mas o processamento não foi enfileirado.", 502, {
      requestId,
    });
  }

  void audit({
    action: "call.audio_uploaded",
    actorUserId: user.id,
    organizationId: call.organization_id,
    resourceType: "crm_call_recordings",
    resourceId: call.id,
    requestId,
    bypassedRls: true,
    metadata: {
      contact_id: call.contact_id,
      mime_type: mime,
      size_bytes: buffer.byteLength,
      duration_seconds: duration,
    },
  });

  return ok(
    { call_id: call.id, status: "transcribing", size_bytes: buffer.byteLength },
    { status: 201, requestId },
  );
}
