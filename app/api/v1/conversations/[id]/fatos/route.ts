/**
 * POST /api/v1/conversations/[id]/fatos — varre a conversa AGORA e grava
 * "O que o cliente contou" no negócio do funil.
 *
 * POR QUE EXISTE ao lado do cron: o resumo diário roda 07:00 na Bahia. Um áudio
 * que chega às 16h45 só entraria no dossiê no dia seguinte — e o momento em que
 * esse dossiê vale alguma coisa é justamente a hora antes da reunião, que
 * costuma ser no mesmo dia. Este é o botão que não deixa o dono da conversa
 * depender do relógio.
 *
 * Custa UMA chamada de LLM por clique, no mesmo teto mensal da org (runModelCall
 * grava em llm_calls). Reusa o prompt do digest inteiro em vez de ter um próprio:
 * dois prompts para ler o mesmo texto divergiriam, e o dossiê passaria a
 * depender de qual dos dois caminhos rodou por último.
 *
 * A TAG e a NOTA do dia NÃO são gravadas aqui, embora o modelo as devolva. A
 * nota é o diário da conversa e tem dono (o cron, 1x/dia, com dedupe por autor);
 * deixar um botão criar nota fora de hora encheria o histórico de resumos
 * parciais do mesmo dia.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import {
  LlmBudgetExceededError,
  llmEdgeConfigFromEnv,
  runModelCall,
  type ModelMessage,
} from "@/lib/agent-engine/edge/llm/run-model-call";
import { ok, fail } from "@/lib/api/wrappers";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  montarPromptDigest,
  montarTranscript,
  parseDigest,
  TAGS_GERIDAS_PELA_IA,
  type MensagemDaJanela,
} from "@/lib/conversations/digest-diario";
import { serializarFatos } from "@/lib/leads/fatos-do-cliente";
import { gravarFatosDoContato, lerFatosDoContato } from "@/lib/leads/fatos-gravar";
import { createAdminClient } from "@/lib/supabase/admin";
import { chaveDaTag } from "@/lib/tags/cores";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Quantas mensagens a varredura do botão lê. Bem mais que a janela de 24h do
 * cron de propósito: o clique é "põe em dia o que sabemos desta pessoa", e o
 * que o dono contou na semana passada vale igual. O teto de caracteres do
 * transcript (8000) é quem corta de verdade.
 */
const MAX_MENSAGENS = 200;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const orgId = authz.org.orgId; // cookie validado, nunca o body

  if (!isServiceRoleConfigured()) {
    return fail("unavailable", "Varredura indisponível nesta instalação.", 503, { requestId });
  }

  let pool;
  try {
    pool = getRequestPool();
  } catch {
    return fail("unavailable", "Varredura indisponível (banco não configurado).", 503, {
      requestId,
    });
  }

  const admin = createAdminClient();

  const { data: conversa } = await admin
    .from("conversations")
    .select("id, organization_id, contact_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conversa) {
    return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  }
  const contactId = (conversa as { contact_id: string | null }).contact_id;
  if (!contactId) {
    return fail("unprocessable_entity", "Esta conversa não tem contato.", 422, { requestId });
  }

  const { data: contato } = await admin
    .from("contacts")
    .select("id, name, display_name, is_anonymized")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  if ((contato as { is_anonymized?: boolean } | null)?.is_anonymized) {
    return fail("unprocessable_entity", "Contato anonimizado (LGPD).", 422, { requestId });
  }

  // Sem negócio no funil não há onde guardar — e dizer isso é melhor que gastar
  // uma chamada de LLM para jogar o resultado fora.
  const jaSabido = await lerFatosDoContato(admin, orgId, contactId);
  if (!jaSabido) {
    return fail(
      "unprocessable_entity",
      "Este contato não tem negócio no funil — crie o negócio para guardar o que o cliente contou.",
      422,
      { requestId },
    );
  }

  // Últimas N mensagens: desc no banco (índice), ordem de leitura no prompt.
  const { data: msgs } = await admin
    .from("messages")
    .select("direction, body, sent_at, media_derived_text")
    .eq("organization_id", orgId)
    .eq("conversation_id", id)
    .order("sent_at", { ascending: false })
    .limit(MAX_MENSAGENS);
  const emOrdem = [...((msgs ?? []) as MensagemDaJanela[])].reverse();
  const transcript = montarTranscript(emOrdem);
  if (!transcript) {
    return fail("unprocessable_entity", "Esta conversa ainda não tem texto para ler.", 422, {
      requestId,
    });
  }

  const { data: catalogo } = await admin
    .from("crm_client_tags")
    .select("name")
    .eq("organization_id", orgId);
  const geridas = new Set(TAGS_GERIDAS_PELA_IA);
  const tagsPermitidas = (catalogo ?? [])
    .map((t) => (t as { name: string }).name)
    .filter((nome) => geridas.has(chaveDaTag(nome)));

  const c = contato as { name: string | null; display_name: string | null } | null;
  const prompt = montarPromptDigest({
    transcript,
    tagsPermitidas,
    nomeContato: c?.display_name ?? c?.name ?? null,
    fatosConhecidos: jaSabido.fatos.fatos,
  });

  let texto: string;
  try {
    const call = await runModelCall(pool, llmEdgeConfigFromEnv(env), {
      tenantId: orgId,
      leadId: contactId,
      purpose: "conversation_fatos",
      model: env.DIGEST_MODEL,
      messages: [{ role: "user", content: prompt }] as ModelMessage[],
    });
    texto = call.result.text;
  } catch (err) {
    if (err instanceof LlmBudgetExceededError) {
      return fail("unprocessable_entity", "O orçamento de IA do mês foi atingido.", 422, {
        requestId,
      });
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[conversation.fatos] LLM falhou", id, detail);
    return fail("internal_error", "A IA não respondeu. Tente de novo.", 500, { requestId });
  }

  const digest = parseDigest(texto, tagsPermitidas);

  let resultado;
  try {
    resultado = await gravarFatosDoContato(
      admin,
      orgId,
      contactId,
      { decisor: digest.decisor, falaComDecisor: digest.falaComDecisor, fatos: digest.fatos },
      new Date(),
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[conversation.fatos] gravação falhou", id, detail);
    return fail("internal_error", "Não consegui gravar no negócio.", 500, { requestId });
  }

  if (resultado.status === "sem_negocio") {
    return fail("unprocessable_entity", "Este contato não tem negócio no funil.", 422, {
      requestId,
    });
  }

  await audit({
    action: "lead.fatos_atualizados",
    actorUserId: user.id,
    organizationId: orgId,
    resourceType: "lead",
    resourceId: resultado.leadId,
    requestId,
    metadata: {
      conversation_id: id,
      mudou: resultado.status === "gravado",
      total_fatos: resultado.fatos.fatos.length,
    },
  });

  return ok(
    {
      mudou: resultado.status === "gravado",
      lead_id: resultado.leadId,
      fatos: serializarFatos(resultado.fatos),
    },
    { requestId },
  );
}
