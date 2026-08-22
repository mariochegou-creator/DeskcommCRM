/**
 * GET /api/v1/cron/conversation-daily-digest
 *
 * Roda 1x/dia (scheduler do compose). Para cada conversa com mensagem nas
 * últimas 24h: UMA chamada de LLM (runModelCall — custo em llm_calls, teto
 * mensal da org respeitado) gera o resumo do dia (nota da conversa, autor
 * RESUMO_NOTE_AUTHOR) e escolhe a tag do cliente entre as geridas pela IA.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET|INTERNAL_SECRET>`,
 * fail-closed. Admin client bypassa RLS — toda query filtra organization_id.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import {
  LlmBudgetExceededError,
  llmEdgeConfigFromEnv,
  runModelCall,
  type ModelMessage,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  aplicarTagDaIa,
  formatNotaResumo,
  montarPromptDigest,
  montarTranscript,
  parseDigest,
  RESUMO_NOTE_AUTHOR,
  TAGS_GERIDAS_PELA_IA,
  type MensagemDaJanela,
} from "@/lib/conversations/digest-diario";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { chaveDaTag } from "@/lib/tags/cores";

export const dynamic = "force-dynamic";

const LOOKBACK_HOURS = 24;
/** Teto de conversas por org por run — acima disso fica pro dia seguinte. */
const LOTE_POR_ORG = 80;

interface ConversaRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let pool;
  try {
    pool = getRequestPool();
  } catch {
    return fail("unavailable", "Digest indisponível (SUPABASE_DB_URL ausente).", 503, { requestId });
  }
  const llmCfg = llmEdgeConfigFromEnv(env);
  const admin = createAdminClient();
  const agora = new Date();
  const cutoffIso = new Date(agora.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: convRows, error: convErr } = await admin
    .from("conversations")
    .select("id, organization_id, contact_id")
    .eq("is_group", false)
    .gte("last_message_at", cutoffIso)
    .order("last_message_at", { ascending: false })
    .limit(500);
  if (convErr) {
    return fail("internal_error", convErr.message, 500, { requestId });
  }

  const porOrg = new Map<string, ConversaRow[]>();
  for (const c of (convRows ?? []) as ConversaRow[]) {
    const lista = porOrg.get(c.organization_id) ?? [];
    if (lista.length < LOTE_POR_ORG) lista.push(c);
    porOrg.set(c.organization_id, lista);
  }

  let notas = 0;
  let tagsAplicadas = 0;
  let jaResumidas = 0;
  let semMensagem = 0;
  let orgsNoTeto = 0;
  const falhas: string[] = [];

  for (const [orgId, conversas] of porOrg) {
    const { data: catalogo } = await admin
      .from("crm_client_tags")
      .select("name")
      .eq("organization_id", orgId);
    const geridas = new Set(TAGS_GERIDAS_PELA_IA);
    const tagsPermitidas = (catalogo ?? [])
      .map((t) => (t as { name: string }).name)
      .filter((nome) => geridas.has(chaveDaTag(nome)));

    for (const conversa of conversas) {
      try {
        const { data: notaExistente } = await admin
          .from("conversation_notes")
          .select("id")
          .eq("organization_id", orgId)
          .eq("conversation_id", conversa.id)
          .eq("created_by_name", RESUMO_NOTE_AUTHOR)
          .is("created_by_user_id", null)
          .gte("created_at", cutoffIso)
          .limit(1);
        if (notaExistente && notaExistente.length > 0) {
          jaResumidas++;
          continue;
        }

        const { data: msgs } = await admin
          .from("messages")
          .select("direction, body, sent_at")
          .eq("organization_id", orgId)
          .eq("conversation_id", conversa.id)
          .gte("sent_at", cutoffIso)
          .order("sent_at", { ascending: true })
          .limit(200);
        const transcript = montarTranscript((msgs ?? []) as MensagemDaJanela[]);
        if (!transcript) {
          semMensagem++;
          continue;
        }

        let contato: {
          id: string;
          name: string | null;
          display_name: string | null;
          tags: string[];
          is_anonymized: boolean;
          is_blocked: boolean;
        } | null = null;
        if (conversa.contact_id) {
          const { data } = await admin
            .from("contacts")
            .select("id, name, display_name, tags, is_anonymized, is_blocked")
            .eq("organization_id", orgId)
            .eq("id", conversa.contact_id)
            .maybeSingle();
          contato = data;
        }
        if (contato?.is_anonymized) continue;

        const prompt = montarPromptDigest({
          transcript,
          tagsPermitidas,
          nomeContato: contato?.display_name ?? contato?.name ?? null,
        });
        const call = await runModelCall(pool, llmCfg, {
          tenantId: orgId,
          leadId: conversa.contact_id,
          purpose: "conversation_digest",
          model: env.DIGEST_MODEL,
          messages: [{ role: "user", content: prompt }] as ModelMessage[],
        });
        const digest = parseDigest(call.result.text, tagsPermitidas);

        const { error: notaErr } = await admin.from("conversation_notes").insert({
          organization_id: orgId,
          conversation_id: conversa.id,
          body: formatNotaResumo(digest.resumo, digest.tag, agora),
          created_by_user_id: null,
          created_by_name: RESUMO_NOTE_AUTHOR,
        });
        if (notaErr) throw new Error(`nota: ${notaErr.message}`);
        notas++;

        if (digest.tag && contato && !contato.is_blocked) {
          const novas = aplicarTagDaIa(contato.tags ?? [], digest.tag);
          if (novas) {
            const { error: tagErr } = await admin
              .from("contacts")
              .update({ tags: novas })
              .eq("organization_id", orgId)
              .eq("id", contato.id);
            if (tagErr) throw new Error(`tag: ${tagErr.message}`);
            tagsAplicadas++;
          }
        }
      } catch (err) {
        if (err instanceof LlmBudgetExceededError) {
          orgsNoTeto++;
          break;
        }
        const detail = err instanceof Error ? err.message : String(err);
        console.error("[conversation-daily-digest] conversa falhou", conversa.id, detail);
        falhas.push(`${conversa.id}:${detail}`);
      }
    }
  }

  await audit({
    action: "conversations.daily_digest_run",
    organizationId: null,
    metadata: {
      orgs: porOrg.size,
      notas,
      tags_aplicadas: tagsAplicadas,
      ja_resumidas: jaResumidas,
      sem_mensagem: semMensagem,
      orgs_no_teto: orgsNoTeto,
      falhas: falhas.length,
      since_ts: cutoffIso,
    },
    requestId,
  });

  return ok(
    {
      orgs: porOrg.size,
      notas,
      tags_aplicadas: tagsAplicadas,
      ja_resumidas: jaResumidas,
      sem_mensagem: semMensagem,
      orgs_no_teto: orgsNoTeto,
      falhas,
    },
    { requestId },
  );
}
