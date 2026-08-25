/**
 * POST /api/v1/saved-audios/[id]/attach — prepara um áudio salvo pro envio numa
 * conversa. Copia o binário de {org}/library/ pra {org}/{conversa}/out-*.{ext} e
 * devolve o mesmo shape do upload (storage_path/media_mime/media_size_bytes),
 * pra UI seguir pelo POST /messages de sempre.
 *
 * Por que copiar em vez de mandar o path da biblioteca: o envio de mídia exige
 * `isMediaPathOwnedBy(path, org, conversa)` (lib/waha/media-send.ts) — é a
 * checagem que impede mandar a mídia de uma conversa dentro de outra. A cópia
 * mantém essa regra intacta e ainda deixa a mensagem com binário próprio: se o
 * vendedor apagar o áudio da gaveta, o histórico já enviado continua tocando.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { extFromMime } from "@/lib/messaging/media/types";
import { attachSavedAudioSchema } from "@/lib/schemas/saved-audios";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "saved_audios" });
  if (!authz.ok) return authz.response;
  const { org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = attachSavedAudioSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const conversationId = parsed.data.conversation_id;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("saved_audios")
    .select("id, storage_path, media_mime, media_size_bytes")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao buscar o áudio.", 500, { requestId });
  if (!row) return fail("not_found", "Áudio não encontrado.", 404, { requestId });

  // A conversa precisa ser da org ativa (RLS + filtro explícito), senão a cópia
  // aterrissaria numa pasta de conversa que o usuário não pode ver.
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (convErr) return fail("internal_error", "Erro ao validar conversa.", 500, { requestId });
  if (!conv) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const destination = `${org.orgId}/${conversationId}/out-${randomUUID()}.${extFromMime(row.media_mime)}`;
  const admin = createAdminClient();
  const { error: copyErr } = await admin.storage.from("whatsapp-media").copy(row.storage_path, destination);
  if (copyErr) {
    console.error("[saved-audios.attach] copy failed", row.storage_path, copyErr.message);
    return fail("internal_error", "Erro ao preparar o áudio para envio.", 500, { requestId });
  }

  return ok(
    {
      storage_path: destination,
      media_mime: row.media_mime,
      media_size_bytes: row.media_size_bytes,
      // O tipo sai do mime (0109): a mesma gaveta guarda áudio e foto, e é este
      // `kind` que a UI usa como type da mensagem — foto vai como image, com o
      // texto do composer de legenda.
      kind: row.media_mime.startsWith("image/") ? ("image" as const) : ("audio" as const),
    },
    { requestId },
  );
}
