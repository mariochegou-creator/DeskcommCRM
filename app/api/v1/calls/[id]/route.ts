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
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ligacaoAbandonada, MOTIVO_ABANDONO } from "@/lib/calls/abandonadas";
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
    .select("id, organization_id, contact_id, lead_id, activity_id, status, outcome, score, transcript, analysis, error_detail, storage_path, mime_type, duration_seconds, sdr_notes, live_state, created_at, updated_at")
    .eq("id", callId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!call) return fail("not_found", "Ligação não encontrada.", 404, { requestId });

  // A LIGAÇÃO QUE FICOU PELA METADE TERMINA AQUI. Sem isto, uma gravação cujo
  // áudio nunca subiu fica em `pending` para sempre — e `pending` é desenhado
  // como "Analisando…". O card fica girando por dias e o botão "Analisar de
  // novo" não tem o que reanalisar. Ver lib/calls/abandonadas.ts para o
  // critério (silêncio de 15 min numa ligação sem áudio) e para por que marcar
  // `failed` não atrapalha um upload atrasado.
  //
  // Cliente ADMIN e não o do usuário: quem lê esta tela pode ser `viewer`, e um
  // papel de leitura não escreve pela RLS. As condições `status = 'pending'` e
  // `storage_path is null` vão junto no update para que duas abas lendo ao
  // mesmo tempo não sobrescrevam um áudio que acabou de chegar.
  const abandonada = ligacaoAbandonada(call);
  if (abandonada) {
    const { error: encerrarErr } = await createAdminClient()
      .from("crm_call_recordings")
      .update({ status: "failed", error_detail: MOTIVO_ABANDONO })
      .eq("id", call.id)
      .eq("status", "pending")
      .is("storage_path", null);
    if (encerrarErr) {
      // Não derruba a leitura: mostrar erro no lugar da ligação inteira seria
      // pior que mostrar o estado antigo.
      logger.warn("[calls] não consegui encerrar ligação abandonada", {
        call_id: call.id,
        detail: encerrarErr.message,
        requestId,
      });
    }
  }

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
      // Responde já com o desfecho que acabou de ser gravado: reler a linha só
      // para confirmar o que este processo mesmo escreveu seria uma ida a mais
      // ao banco em toda consulta de ligação.
      status: abandonada ? "failed" : call.status,
      outcome: call.outcome,
      score: call.score,
      transcript: call.transcript,
      analysis: call.analysis,
      error_detail: abandonada ? MOTIVO_ABANDONO : call.error_detail,
      duration_seconds: call.duration_seconds,
      mime_type: call.mime_type,
      sdr_notes: call.sdr_notes,
      live_state: call.live_state,
      audio_url,
      audio_url_expires_in: audio_url ? AUDIO_URL_TTL_SECONDS : null,
      created_at: call.created_at,
      updated_at: call.updated_at,
    },
    { requestId },
  );
}

/**
 * PATCH /api/v1/calls/[id] — a anotação que o SDR escreve DURANTE a ligação.
 *
 * Salva sozinha enquanto ele digita (o popup faz debounce), então tem de ser
 * barata e tolerante: sem evento, sem auditoria, sem recalcular nada. O texto
 * vira contexto no prompt da análise final — é o que a transcrição não capta
 * (o tom, a cara que o lead fez, o que ficou combinado por fora).
 *
 * `agent` e não `viewer`: isto ESCREVE. E a escrita vai pelo client do caller,
 * não pelo admin — a RLS é quem decide se esta ligação é da org dele.
 */
const PatchBody = z.object({
  sdr_notes: z.string().max(10_000).nullable(),
});

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: callId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_call_recordings" });
  if (!authz.ok) return authz.response;

  const body = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(body ?? {});
  if (!parsed.success) {
    return fail("validation_failed", "Corpo inválido.", 422, {
      requestId,
      details: { issues: parsed.error.issues },
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_call_recordings")
    .update({ sdr_notes: parsed.data.sdr_notes?.trim() || null })
    .eq("id", callId)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Ligação não encontrada.", 404, { requestId });

  return ok({ id: data.id }, { requestId });
}
