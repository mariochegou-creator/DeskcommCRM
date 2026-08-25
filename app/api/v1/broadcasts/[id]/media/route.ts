/**
 * POST /api/v1/broadcasts/[id]/media — a mídia da campanha.
 *
 * Dois caminhos, mesma saída:
 *   - multipart `file` → sobe um arquivo novo;
 *   - JSON `{saved_audio_id}` → COPIA um áudio da gaveta (0095).
 *
 * O binário fica em `{org}/library/broadcasts/{id}/…`. `library` no lugar do
 * conversation_id é o mesmo truque da gaveta de áudios: mantém
 * `isMediaPathOwnedBy` intacta (nada fora de uma conversa pode ser enviado
 * direto) e obriga o worker a copiar o objeto para dentro de cada conversa antes
 * de mandar. Parece trabalho extra e é justamente a proteção — afrouxar a posse
 * seria o caminho curto e errado.
 *
 * Copiar da gaveta em vez de referenciar: a campanha vira um SNAPSHOT. Trocar o
 * áudio da gaveta depois não muda o que esta campanha manda, e apagar da gaveta
 * não a quebra no meio.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { extFromMime, MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";
import { anexarMidiaSchema } from "@/lib/schemas/broadcasts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BUCKET = "whatsapp-media";

/** Só estes três chegam bem no WhatsApp por disparo (documento vira anexo mudo). */
const TIPOS_ACEITOS = new Set(["image", "video", "audio"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;

  const supabase = await createClient();
  const { data: campanha } = await supabase
    .from("broadcasts")
    .select("id, status")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();

  if (!campanha) return fail("not_found", "Disparo não encontrado.", 404, { requestId });
  if ((campanha as { status: string }).status !== "draft") {
    return fail("conflict", "A mídia só pode ser trocada enquanto a campanha é rascunho.", 409, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const contentType = req.headers.get("content-type") ?? "";

  let storagePath: string;
  let mime: string;
  let tamanho: number;
  let tipo: string;

  if (contentType.includes("application/json")) {
    // --- Caminho 2: copiar da gaveta de áudios -----------------------------
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
    }
    const parsed = anexarMidiaSchema.safeParse(raw);
    if (!parsed.success) {
      return fail("validation_failed", "Informe o áudio da gaveta.", 422, { requestId });
    }

    const { data: audio } = await supabase
      .from("saved_audios")
      .select("id, storage_path, media_mime, media_size_bytes")
      .eq("id", parsed.data.saved_audio_id)
      .eq("organization_id", org.orgId)
      .maybeSingle();

    if (!audio) return fail("not_found", "Áudio não encontrado na gaveta.", 404, { requestId });
    const a = audio as {
      storage_path: string;
      media_mime: string;
      media_size_bytes: number | null;
    };

    const ext = a.storage_path.split(".").pop()?.toLowerCase() || "ogg";
    storagePath = `${org.orgId}/library/broadcasts/${id}/media-${randomUUID()}.${ext}`;
    const { error: copyErr } = await admin.storage.from(BUCKET).copy(a.storage_path, storagePath);
    if (copyErr) {
      return fail("internal_error", "Não foi possível copiar o áudio da gaveta.", 500, {
        requestId,
      });
    }
    mime = a.media_mime;
    tamanho = a.media_size_bytes ?? 0;
    tipo = "audio";
  } else {
    // --- Caminho 1: upload novo -------------------------------------------
    const declarado = Number(req.headers.get("content-length") ?? 0);
    if (declarado > MAX_MEDIA_BYTES + 1_048_576) {
      return fail("payload_too_large", "Arquivo acima de 50MB.", 413, { requestId });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return fail("validation_failed", "Campo 'file' (multipart) obrigatório.", 422, { requestId });
    }

    mime = file.type || "application/octet-stream";
    const veredito = validateOutboundMedia(mime, file.size);
    if (!veredito.ok) {
      const status =
        veredito.code === "payload_too_large"
          ? 413
          : veredito.code === "unsupported_media_type"
            ? 415
            : 422;
      return fail(veredito.code, veredito.message, status, { requestId });
    }
    if (!TIPOS_ACEITOS.has(veredito.kind)) {
      return fail(
        "unsupported_media_type",
        "Disparo aceita vídeo, áudio ou imagem — documento chega como anexo mudo.",
        415,
        { requestId },
      );
    }

    storagePath = `${org.orgId}/library/broadcasts/${id}/media-${randomUUID()}.${extFromMime(mime)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: mime, upsert: false });
    if (upErr) {
      return fail("internal_error", "Erro ao subir o arquivo.", 500, { requestId });
    }
    tamanho = file.size;
    tipo = veredito.kind;
  }

  const { data, error } = await admin
    .from("broadcasts")
    .update({
      media_storage_path: storagePath,
      media_mime: mime,
      media_size_bytes: tamanho,
      media_type: tipo,
    })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id, media_storage_path, media_mime, media_size_bytes, media_type")
    .single();

  if (error) {
    // Órfão no storage é lixo barato; linha apontando para objeto que não
    // existe quebraria o envio. Limpa e falha explícito.
    await admin.storage.from(BUCKET).remove([storagePath]);
    return fail("internal_error", "Falha ao anexar a mídia.", 500, { requestId });
  }

  await audit({
    action: "broadcast.media_attached",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "broadcast",
    resourceId: id,
    requestId,
    metadata: { media_type: tipo, media_mime: mime, bytes: tamanho },
  });

  return ok(data, { requestId });
}
