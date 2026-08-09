/**
 * PATCH  /api/v1/saved-audios/[id] — renomeia o áudio salvo.
 * DELETE /api/v1/saved-audios/[id] — remove a linha E o binário do bucket.
 *
 * O `.eq("organization_id", org.orgId)` é defesa extra, não substitui a RLS
 * `saved_audios_write` — quem não é dono (agent) nem manager (compartilhado)
 * é barrado pela policy antes de chegar aqui.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok, noContent } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { updateSavedAudioSchema } from "@/lib/schemas/saved-audios";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLS =
  "id, organization_id, owner_user_id, title, storage_path, media_mime, media_size_bytes, duration_seconds, created_by_user_id, created_at, updated_at";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "saved_audios" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = updateSavedAudioSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_audios")
    .update({ title: parsed.data.title })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(COLS)
    .single();
  if (error || !data) return fail("not_found", "Áudio não encontrado.", 404, { requestId });

  void audit({
    action: "saved_audio.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "saved_audio",
    resourceId: data.id,
    requestId,
    metadata: { title: parsed.data.title },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "saved_audios" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  // .select() confirma que a linha existia E era apagável pela RLS: sem isso,
  // um DELETE barrado afeta 0 linhas mas retornaria 204 + audit falso (mesma
  // semântica do message-templates).
  const { data: deleted, error } = await supabase
    .from("saved_audios")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id, storage_path")
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao excluir o áudio.", 500, { requestId });
  if (!deleted) return fail("not_found", "Áudio não encontrado.", 404, { requestId });

  // A linha já foi: o binário sem dono é lixo no bucket. Falha aqui não
  // reverte o DELETE (o usuário não veria o áudio de novo mesmo) — só loga.
  const admin = createAdminClient();
  const { error: rmErr } = await admin.storage.from("whatsapp-media").remove([deleted.storage_path]);
  if (rmErr) console.error("[saved-audios] remove failed", deleted.storage_path, rmErr.message);

  void audit({
    action: "saved_audio.deleted",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "saved_audio",
    resourceId: deleted.id,
    requestId,
  });
  return noContent(requestId);
}
