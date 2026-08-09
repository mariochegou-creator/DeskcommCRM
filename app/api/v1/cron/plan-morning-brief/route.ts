/**
 * GET/POST /api/v1/cron/plan-morning-brief — o resumo bom-dia do plano de 60
 * dias, por WhatsApp, 8h30 America/Bahia em dia útil (crontab: 30 11 * * 1-5,
 * scheduler em UTC; Bahia não tem DST desde 2019, offset fixo).
 *
 * Para cada org com organizations.settings.sixty_day_brief.enabled:
 *   1. monta o texto (lib/plan/morning-brief) com métricas de ontem/semana/
 *      plano via fn_prospecting_metrics + tarefas pendentes de plan_tasks;
 *   2. envia para cada recipient pelo TRILHO COMPLETO (contato → conversa →
 *      sendMessageHandler): ganha histórico, audit, e o redrive de `queued`
 *      quando a sessão WAHA volta. Zero LLM — texto montado em código.
 *   3. fecha a conversa após o envio: o brief não é fila de atendimento; a
 *      resposta do Mario reabre pela ingestão normal.
 *
 * Guard de duplicidade por messages.metadata.plan_brief_date: restart do
 * scheduler no minuto do tick não pode mandar o bom-dia duas vezes.
 *
 * Auth: mesmo contrato dos demais crons (Bearer INTERNAL_CRON_SECRET |
 * INTERNAL_SECRET, fail-closed).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import {
  detectProspectingPipeline,
  type PipelineCandidate,
  type StageSlugRow,
} from "@/lib/dashboard/prospecting-pipeline";
import {
  bahiaCivilDate,
  bahiaStartOfDay,
  bahiaStartOfWeek,
  businessDaysMonToYesterday,
  currentPhase,
  isBusinessDayBahia,
  planStartInstant,
  previousBusinessDayWindow,
} from "@/lib/plan/dates";
import { buildMorningBrief, type BriefTask } from "@/lib/plan/morning-brief";
import { pickPlanNumbers, type PaceFunnelStage } from "@/lib/plan/pace";
import { SIXTY_DAY_PLAN, type PlanOwner } from "@/lib/plan/sixty-day-plan";
import { sixtyDayBriefSchema } from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface FnMetricsPayload {
  funnel: PaceFunnelStage[];
  response: { contacted: number; replied: number };
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const now = new Date();
  // `?force=1` é a porta do TESTE MANUAL (deploy no fim de semana precisa
  // provar o envio antes da primeira execução real de segunda). O crontab
  // nunca manda force — o guard de dia útil continua valendo pra máquina.
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!isBusinessDayBahia(now) && !force) {
    return ok({ skipped: "weekend" }, { requestId });
  }

  const admin = createAdminClient();
  const todayIso = bahiaCivilDate(now).iso;

  const { data: orgs, error: orgsErr } = await admin
    .from("organizations")
    .select("id, display_name, settings")
    .not("settings->sixty_day_brief", "is", null);
  if (orgsErr) {
    logger.error("[plan-morning-brief] org scan failed", {
      error: orgsErr.message,
      requestId,
    });
    return fail("internal_error", "Failed to scan organizations.", 500, { requestId });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const orgsProcessed: string[] = [];

  for (const orgRow of orgs ?? []) {
    const org = orgRow as { id: string; display_name: string | null; settings: unknown };
    const cfg = sixtyDayBriefSchema.parse(
      (org.settings as Record<string, unknown> | null)?.["sixty_day_brief"],
    );
    if (!cfg.enabled || cfg.recipients.length === 0) {
      skipped++;
      continue;
    }

    // Idempotência do dia: o restart do crond no minuto do tick reexecuta a
    // rota; a marca fica na PRIMEIRA mensagem enviada.
    const { data: already } = await admin
      .from("messages")
      .select("id")
      .eq("organization_id", org.id)
      .eq("direction", "outbound")
      .gte("sent_at", bahiaStartOfDay(now).toISOString())
      .contains("metadata", { plan_brief_date: todayIso })
      .limit(1)
      .maybeSingle();
    if (already) {
      skipped++;
      continue;
    }

    const briefText = await buildBriefForOrg(admin, org.id, now);

    for (const recipient of cfg.recipients) {
      try {
        const contactId = await ensureContact(admin, org.id, recipient.name, recipient.phone);
        const sessionId = await resolveSession(admin, org.id, cfg.session_name);
        if (!sessionId) {
          logger.warn("[plan-morning-brief] no WORKING session", {
            organizationId: org.id,
            requestId,
          });
          failed++;
          continue;
        }
        const conversationId = await ensureConversation(admin, org.id, contactId, sessionId);
        await sendMessageHandler(
          admin,
          {
            organization_id: org.id,
            actor: { type: "webhook_source", id: "cron:plan-morning-brief" },
            requestId,
          },
          {
            conversation_id: conversationId,
            type: "text",
            body: briefText,
            metadata: { plan_brief_date: todayIso },
          },
        );
        // O brief não é fila: fecha; resposta do humano reabre pela ingestão.
        await admin
          .from("conversations")
          .update({ status: "closed" })
          .eq("id", conversationId)
          .eq("organization_id", org.id);
        sent++;
      } catch (err) {
        failed++;
        logger.error("[plan-morning-brief] send failed", {
          organizationId: org.id,
          phone: recipient.phone.slice(0, 6) + "…",
          error: err instanceof Error ? err.message : String(err),
          requestId,
        });
      }
    }
    orgsProcessed.push(org.id);
  }

  void audit({
    action: "plan.morning_brief_run",
    organizationId: null,
    bypassedRls: true,
    metadata: { orgs: orgsProcessed.length, sent, failed, skipped },
    requestId,
  });

  return ok({ orgs: orgsProcessed.length, sent, failed, skipped }, { requestId });
}

/** Coleta números + tarefas e monta o texto. Sem funil detectado, degrada. */
async function buildBriefForOrg(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  now: Date,
): Promise<string> {
  const [{ data: pipelines }, { data: stages }] = await Promise.all([
    admin
      .from("crm_pipelines")
      .select("id, name, slug, position")
      .eq("organization_id", orgId),
    admin.from("crm_stages").select("pipeline_id, slug").eq("organization_id", orgId),
  ]);
  const pipeline = detectProspectingPipeline(
    (pipelines ?? []) as PipelineCandidate[],
    (stages ?? []) as StageSlugRow[],
  );

  const yesterdayWin = previousBusinessDayWindow(now);
  const weekStart = bahiaStartOfWeek(now);
  const dayStart = bahiaStartOfDay(now);
  const weekDaysDone = businessDaysMonToYesterday(now);

  let yesterday: { openings: number; contacted: number; replied: number; xray: number } | null =
    null;
  let weekOpenings: number | null = null;
  let planXray: number | null = null;

  if (pipeline) {
    const metricsFor = async (from: Date, to: Date): Promise<FnMetricsPayload | null> => {
      // SECURITY INVOKER + service-role ⇒ RLS não filtra; p_org é obrigatório.
      const { data, error } = await admin.rpc("fn_prospecting_metrics", {
        p_org: orgId,
        p_pipeline: pipeline.id,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });
      if (error) return null;
      return data as unknown as FnMetricsPayload;
    };

    const [yMetrics, wMetrics, pMetrics] = await Promise.all([
      metricsFor(yesterdayWin.from, yesterdayWin.to),
      weekDaysDone > 0 ? metricsFor(weekStart, dayStart) : Promise.resolve(null),
      metricsFor(planStartInstant(), now),
    ]);

    if (yMetrics) {
      const nums = pickPlanNumbers(yMetrics.funnel);
      yesterday = {
        openings: nums.openings,
        contacted: yMetrics.response.contacted,
        replied: yMetrics.response.replied,
        xray: nums.xray,
      };
    }
    if (weekDaysDone === 0) {
      weekOpenings = 0;
    } else if (wMetrics) {
      weekOpenings = pickPlanNumbers(wMetrics.funnel).openings;
    }
    if (pMetrics) {
      const nums = pickPlanNumbers(pMetrics.funnel);
      planXray = nums.xrayStage === null ? null : nums.xray;
    }
  }

  const phaseN = currentPhase(now).n;
  const todayIso = bahiaCivilDate(now).iso;
  const { data: taskRows } = await admin
    .from("plan_tasks")
    .select("title, owner, due_date")
    .eq("organization_id", orgId)
    .eq("plan_key", SIXTY_DAY_PLAN.key)
    .eq("status", "pending")
    .or(`due_date.lte.${todayIso},and(due_date.is.null,phase.eq.${phaseN})`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("position", { ascending: true });

  const tasks: BriefTask[] = ((taskRows ?? []) as Array<{
    title: string;
    owner: string;
    due_date: string | null;
  }>).map((t) => ({
    title: t.title,
    owner: t.owner as PlanOwner,
    due_date: t.due_date,
  }));

  return buildMorningBrief({
    now,
    yesterdayLabel: yesterdayWin.label,
    yesterday,
    weekOpenings,
    weekBusinessDaysDone: weekDaysDone,
    planXray,
    tasks,
  });
}

/** Contato do destinatário por (org, phone) — select-then-insert com corrida tratada. */
async function ensureContact(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  name: string,
  phone: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", phone)
    .is("is_merged_into", null)
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      organization_id: orgId,
      name,
      display_name: name,
      phone_number: phone,
      source: "manual",
    })
    .select("id")
    .single();
  if (error || !created) {
    // 23505 = outro processo criou entre o select e o insert (unique parcial
    // org+phone). O vencedor serve.
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("phone_number", phone)
        .limit(1)
        .maybeSingle();
      if (winner) return (winner as { id: string }).id;
    }
    throw new Error(error?.message ?? "contact_insert_failed");
  }
  return (created as { id: string }).id;
}

/** Sessão preferida da config se estiver WORKING; senão a 1ª WORKING da org. */
async function resolveSession(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  preferredName: string | null,
): Promise<string | null> {
  if (preferredName) {
    const { data } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("waha_session_name", preferredName)
      .eq("status", "WORKING")
      .limit(1)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  const { data } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", orgId)
    .eq("status", "WORKING")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? (data as { id: string }).id : null;
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
