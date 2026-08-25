/**
 * GET  /api/v1/saved-audios — lista os áudios salvos visíveis (pessoais +
 *      compartilhados da org ativa; a RLS `saved_audios_select` já filtra).
 * POST /api/v1/saved-audios — multipart: sobe o binário pro bucket
 *      whatsapp-media sob {org}/library/ e grava a linha. `shared=true` grava
 *      owner_user_id null (compartilhado) e exige manager+; default é pessoal.
 *
 * O path NÃO leva conversation_id de propósito: áudio salvo não pertence a
 * conversa nenhuma. Quem cola uma cópia dentro da conversa na hora do envio é
 * a rota [id]/attach — é ela que mantém a checagem de posse do _handler viva.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK } from "@/lib/auth/types";
import { extFromMime, MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";
import { createSavedAudioSchema } from "@/lib/schemas/saved-audios";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLS =
  "id, organization_id, owner_user_id, title, storage_path, media_mime, media_size_bytes, duration_seconds, created_by_user_id, created_at, updated_at";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "saved_audios" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_audios")
    .select(COLS)
    .eq("organization_id", org.orgId)
    .order("updated_at", { ascending: false });
  if (error) return fail("internal_error", "Erro ao listar áudios salvos.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "saved_audios" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  // Guard de DoS pelo Content-Length declarado, ANTES de bufferizar o corpo
  // (mesmo padrão de conversations/[id]/media); o check autoritativo continua
  // sendo file.size pós-parse.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_MEDIA_BYTES + 1_048_576) {
    return fail("payload_too_large", "Arquivo acima de 50MB.", 413, { requestId });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", "Campo 'file' (multipart) obrigatório.", 422, { requestId });
  }

  const parsed = createSavedAudioSchema.safeParse({
    title: form?.get("title") ?? undefined,
    shared: form?.get("shared") ?? undefined,
    duration_seconds: form?.get("duration_seconds") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { title, shared, duration_seconds } = parsed.data;

  const mime = file.type || "application/octet-stream";
  const verdict = validateOutboundMedia(mime, file.size);
  if (!verdict.ok) {
    const status = verdict.code === "payload_too_large" ? 413 : verdict.code === "unsupported_media_type" ? 415 : 422;
    return fail(verdict.code, verdict.message, status, { requestId });
  }
  // Áudio (a fala repetida) e imagem (o print que o vendedor manda sempre —
  // 0109). Vídeo e documento ficam de fora: pesam no bucket e não são o que se
  // repete. O check da tabela barra igual se algo escapar daqui.
  if (verdict.kind !== "audio" && verdict.kind !== "image") {
    return fail("unsupported_media_type", "Só áudio ou foto pode ser salvo aqui.", 415, { requestId });
  }

  // Compartilhado exige manager+ (espelha message-templates). A RLS with_check
  // barra de qualquer forma; isto só dá o erro claro antes do insert — e antes
  // do upload, pra não deixar binário órfão no bucket.
  if (shared && ROLE_RANK[org.role] < ROLE_RANK.manager) {
    return fail("forbidden", "Só manager+ salva áudio compartilhado.", 403, { requestId });
  }

  const storagePath = `${org.orgId}/library/${randomUUID()}.${extFromMime(mime)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("whatsapp-media")
    .upload(storagePath, buffer, { contentType: mime, upsert: false });
  if (upErr) {
    console.error("[saved-audios] upload failed", upErr.message);
    return fail("internal_error", "Erro ao subir o áudio.", 500, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_audios")
    .insert({
      organization_id: org.orgId,
      owner_user_id: shared ? null : user.id,
      title,
      storage_path: storagePath,
      media_mime: mime,
      media_size_bytes: file.size,
      duration_seconds: duration_seconds ?? null,
      created_by_user_id: user.id,
    })
    .select(COLS)
    .single();
  if (error || !data) {
    // Insert barrado (RLS) ou falho: o binário já subiu — remover, senão fica
    // órfão no bucket sem linha que o aponte (ninguém mais o apagaria).
    await admin.storage.from("whatsapp-media").remove([storagePath]);
    return fail("internal_error", "Erro ao salvar o áudio.", 500, { requestId });
  }

  void audit({
    action: "saved_audio.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "saved_audio",
    resourceId: data.id,
    requestId,
    metadata: { shared, title },
  });
  return ok(data, { requestId, status: 201 });
}
