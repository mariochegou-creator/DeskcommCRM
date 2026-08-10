/**
 * GET /api/v1/calls/[id]
 *
 * O estado da ligação e, quando pronta, a análise. É o que o popup consulta
 * enquanto mostra Enviando… → Transcrevendo… → Analisando… → Concluído, e o que
 * o card da timeline usa para se desenhar.
 *
 * A URL do áudio é ASSINADA E CURTA (10 min). O bucket é privado justamente
 * porque o conteúdo é a voz de uma pessoa que não sabe que foi gravada por um
 * CRM: um link permanente colado num chat de equipe seria uma gravação de voz
 * exposta para sempre, fora de qualquer controle de acesso. Dez minutos cobrem
 * ouvir a ligação; não cobrem virar link compartilhável.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { CALL_BUCKET } from "@/lib/calls/storage";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Tempo de vida da URL assinada do áudio. Ver o cabeçalho para o porquê. */
const AUDIO_URL_TTL_SECONDS = 10 * 60;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: callId } = await ctx.params;

  // `viewer` LÊ. Ouvir a ligação e ler a análise é leitura do histórico do
  // negócio, e é justamente quem coordena o time (nem sempre com role de escrita)
  // que precisa disso para dar feedback.
  const authz = await requireRole("viewer", { requestId, resource: "crm_call_recordings" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();

  const { data: call, error } = await supabase
    .from("crm_call_recordings")
    // Literal de uma linha só, sem concatenação: o typegen do PostgREST infere o
    // shape da linha a partir do TEXTO do `select`, e uma expressão `"a" + "b"`
    // devolve `GenericStringError` — o que aparece depois como "Property 'id'
    // does not exist" em toda leitura, longe da causa.
    .select("id, organization_id, contact_id, lead_id, activity_id, status, outcome, score, transcript, analysis, error_detail, storage_path, mime_type, duration_seconds, created_at, updated_at")
    .eq("id", callId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!call) return fail("not_found", "Ligação não encontrada.", 404, { requestId });

  // A URL assinada precisa do service role (o bucket não tem policy para
  // authenticated). A autorização já aconteceu acima, pela RLS que devolveu a
  // linha — o admin client entra só para assinar o objeto que ela aponta.
  let audio_url: string | null = null;
  if (call.storage_path) {
    const { data: signed, error: signErr } = await createAdminClient()
      .storage.from(CALL_BUCKET)
      .createSignedUrl(call.storage_path, AUDIO_URL_TTL_SECONDS);
    if (signErr) {
      // Não derruba a resposta: a análise é o que o SDR veio ler, e o player
      // ausente é degradação visível. Falhar tudo por causa do áudio esconderia
      // a análise que já custou dinheiro para produzir.
      logger.warn("[calls] signed url falhou", {
        call_id: call.id,
        detail: signErr.message,
        requestId,
      });
    } else {
      audio_url = signed?.signedUrl ?? null;
    }
  }

  return ok(
    {
      id: call.id,
      contact_id: call.contact_id,
      lead_id: call.lead_id,
      activity_id: call.activity_id,
      status: call.status,
      outcome: call.outcome,
      score: call.score,
      transcript: call.transcript,
      analysis: call.analysis,
      error_detail: call.error_detail,
      duration_seconds: call.duration_seconds,
      mime_type: call.mime_type,
      audio_url,
      audio_url_expires_in: audio_url ? AUDIO_URL_TTL_SECONDS : null,
      created_at: call.created_at,
      updated_at: call.updated_at,
    },
    { requestId },
  );
}
