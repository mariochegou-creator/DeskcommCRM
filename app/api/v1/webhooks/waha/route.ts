/**
 * POST /api/v1/webhooks/waha — global webhook receiver (no path token).
 *
 * Usado quando o WAHA tem um único WHATSAPP_HOOK_URL global (docker-compose
 * atual). Resolve a channel_session por `body.session` (= waha_session_name).
 * A variante /waha/[token] é a rota per-tenant canônica de produção.
 *
 * Pipeline: lookup session -> verifica HMAC SHA512 -> loga em
 * webhook_events_log -> dispatchWahaEvent (ingestão compartilhada, ver
 * lib/waha/ingest.ts). Idempotência e resolução atômica de contato/conversa
 * vivem no módulo compartilhado.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  dispatchWahaEvent,
  ehConexaoSoDeGrupo,
  verifyHmacSha512,
  type WahaEnvelope,
} from "@/lib/waha/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();

  const rawBody = await req.text();
  let envelope: WahaEnvelope;
  try {
    envelope = JSON.parse(rawBody) as WahaEnvelope;
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }

  const sessionName = envelope.session;
  if (!sessionName) {
    return fail("invalid_request", "missing session field", 400, { requestId });
  }

  const admin = createAdminClient();

  const { data: session, error: sessErr } = await admin
    .from("channel_sessions")
    .select(
      "id, organization_id, waha_session_name, webhook_secret_encrypted, status, is_warmup_complete, warmup_started_at, archived_at",
    )
    .eq("waha_session_name", sessionName)
    .maybeSingle();

  if (sessErr) {
    return fail("internal_error", sessErr.message, 500, { requestId });
  }
  if (!session) {
    // Sessão ainda não registrada no nosso DB — aceita e ignora (200 p/ WAHA
    // não ficar retentando). Comum quando a sessão foi iniciada pelo dashboard
    // antes da nossa linha existir. Deixa rastro: sem esta linha o evento
    // sumia sem registro nenhum e "não chegou" era indistinguível de
    // "chegou com o nome de sessão errado".
    await admin.from("webhook_events_log").insert({
      organization_id: null,
      channel_session_id: null,
      provider: "waha",
      webhook_path_token: null,
      http_method: "POST",
      raw_body: rawBody,
      payload_parsed: envelope as unknown as Record<string, unknown>,
      event_type: envelope.event ?? "unknown",
      external_id: envelope.payload?.id ?? null,
      status: "error",
      error_message: `session_not_registered:${sessionName}`,
      attempts: 0,
    });
    return ok(
      { accepted: false, reason: "session_not_registered", session: sessionName },
      { requestId },
    );
  }

  // Número removido pelo usuário (0096): o DELETE já parou a sessão no WAHA,
  // mas se ele voltar a emitir (container reiniciado com a sessão salva) o
  // evento é descartado — não pode ressuscitar conversa de um canal que sumiu
  // da tela. 200 de propósito: retentativa não mudaria nada.
  if (session.archived_at) {
    await admin.from("webhook_events_log").insert({
      organization_id: session.organization_id,
      channel_session_id: session.id,
      provider: "waha",
      webhook_path_token: null,
      http_method: "POST",
      raw_body: rawBody,
      payload_parsed: envelope as unknown as Record<string, unknown>,
      event_type: envelope.event ?? "unknown",
      external_id: envelope.payload?.id ?? null,
      status: "error",
      error_message: "skip:channel_archived",
      attempts: 0,
    });
    return ok({ accepted: false, reason: "channel_archived" }, { requestId });
  }

  // HMAC — pula em dev quando o secret é o placeholder.
  const sigHeader = req.headers.get("x-webhook-hmac") ?? req.headers.get("X-Webhook-Hmac");
  let validSignature = false;
  let hmacSkipped = false;
  try {
    const dec = await admin.rpc("fn_decrypt_oauth", {
      ciphertext: session.webhook_secret_encrypted,
    });
    if (dec.error || !dec.data || (typeof dec.data === "string" && dec.data.length < 4)) {
      hmacSkipped = true;
    } else {
      validSignature = verifyHmacSha512(rawBody, sigHeader, dec.data as string);
    }
  } catch {
    hmacSkipped = true;
  }

  if (!hmacSkipped && !validSignature) {
    await audit({
      action: "nuvemshop.webhook_invalid_signature",
      organizationId: session.organization_id,
      metadata: { provider: "waha", session: session.waha_session_name, event: envelope.event },
    });
    // Rastro no log (antes o 401 acontecia ANTES do INSERT e o evento sumia).
    await admin.from("webhook_events_log").insert({
      organization_id: session.organization_id,
      channel_session_id: session.id,
      provider: "waha",
      webhook_path_token: null,
      http_method: "POST",
      raw_body: rawBody,
      payload_parsed: envelope as unknown as Record<string, unknown>,
      signature_header: sigHeader ?? null,
      valid_signature: false,
      event_type: envelope.event ?? "unknown",
      external_id: envelope.payload?.id ?? null,
      status: "error",
      error_message: "invalid_signature",
      attempts: 0,
    });
    return fail("unauthenticated", "invalid_signature", 401, { requestId });
  }

  // A conexão da assistente entra SÓ pelos grupos. O corte é aqui, antes do
  // log: `raw_body` guarda o corpo cru de todo evento, e sem esta saída uma
  // conversa pessoal no número emprestado ficaria escrita no banco do CRM
  // mesmo sem nunca aparecer no inbox. Fica o registro de que chegou — sem o
  // conteúdo.
  if (await ehConexaoSoDeGrupo(admin, session, envelope)) {
    await admin.from("webhook_events_log").insert({
      organization_id: session.organization_id,
      channel_session_id: session.id,
      provider: "waha",
      webhook_path_token: null,
      http_method: "POST",
      raw_body: "",
      payload_parsed: { event: envelope.event ?? "unknown" },
      signature_header: sigHeader ?? null,
      valid_signature: validSignature || hmacSkipped,
      event_type: envelope.event ?? "unknown",
      external_id: null,
      status: "processed",
      processed_at: new Date().toISOString(),
      error_message: "skip:so_grupo",
      attempts: 0,
    });
    return ok({ accepted: true }, { requestId });
  }

  const eventType = envelope.event ?? "unknown";
  const externalId = envelope.payload?.id ?? null;

  const headersJson: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("authorization")) return;
    if (key.toLowerCase() === "cookie") return;
    headersJson[key] = value;
  });
  const { data: logRow } = await admin
    .from("webhook_events_log")
    .insert({
      organization_id: session.organization_id,
      channel_session_id: session.id,
      provider: "waha",
      webhook_path_token: null,
      http_method: "POST",
      headers: headersJson,
      raw_body: rawBody,
      payload_parsed: envelope as unknown as Record<string, unknown>,
      signature_header: sigHeader ?? null,
      valid_signature: validSignature || hmacSkipped,
      event_type: eventType,
      external_id: externalId,
      status: "received",
      attempts: 0,
    })
    .select("id")
    .maybeSingle();

  // O resultado do dispatch é carimbado no log: `processed` + motivo de skip,
  // ou `error` com a exceção. É o que torna "evento chegou mas não virou
  // mensagem" diagnosticável com um SELECT.
  try {
    const motivo = await dispatchWahaEvent(admin, session, envelope, requestId);
    if (logRow?.id) {
      await admin
        .from("webhook_events_log")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          error_message: motivo ? `skip:${motivo}` : null,
        })
        .eq("id", logRow.id);
    }
  } catch (err) {
    console.error("[waha.webhook] handler failed", err);
    if (logRow?.id) {
      await admin
        .from("webhook_events_log")
        .update({ status: "error", error_message: String(err) })
        .eq("id", logRow.id);
    }
  }

  return ok({ accepted: true }, { requestId });
}
