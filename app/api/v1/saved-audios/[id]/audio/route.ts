/**
 * GET /api/v1/saved-audios/[id]/audio — 302 pra signed URL (TTL 1h) do binário
 * no bucket whatsapp-media. Usada direto como src de <audio> na gaveta do
 * composer (cookie de sessão vai junto por ser same-origin; a RLS de
 * saved_audios decide quem vê).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_S = 3600;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "saved_audios" });
  if (!authz.ok) return authz.response;
  const { org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("saved_audios")
    .select("id, storage_path")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao buscar o áudio.", 500, { requestId });
  if (!row) return fail("not_found", "Áudio não encontrado.", 404, { requestId });

  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from("whatsapp-media")
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_S);
  if (signErr || !signed?.signedUrl) {
    console.error("[saved-audios.audio] createSignedUrl failed", signErr?.message);
    return fail("internal_error", "Áudio indisponível no momento.", 500, { requestId });
  }

  const response = NextResponse.redirect(signed.signedUrl, 302);
  response.headers.set("X-Request-Id", requestId);
  return response;
}
