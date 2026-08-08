/**
 * GET /api/v1/metrics/prospecting — métricas de prospecção do Painel.
 *
 * Mesmo contrato de escopo de /metrics/attendants: a agregação
 * (`fn_prospecting_metrics`, SECURITY INVOKER) roda com o client user-scoped
 * (cookie session), então a RLS de crm_leads/crm_lead_activities/messages/
 * followup_enrollments já escopa o que o caller pode ver. Piso de rota = agent.
 * org da org ativa (cookie validado), NUNCA do body/query. Read-only ⇒ sem audit.
 *
 * `pipeline_id` é obrigatório (o Painel mira o funil de prospecção detectado no
 * servidor) e é re-validado aqui sob RLS — id de outra org devolve 404, não
 * dados vazios que pareceriam "funil sem movimento".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const querySchema = z.object({
  pipeline_id: z.string().uuid(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  prev_from: z.string().datetime({ offset: true }).optional(),
  prev_to: z.string().datetime({ offset: true }).optional(),
});

export interface ProspectingFunnelStage {
  stage_id: string;
  name: string;
  slug: string | null;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  entered: number;
  entered_prev: number | null;
  open_now: number;
}

export interface ProspectingResponseMetric {
  contacted: number;
  replied: number;
  prev_contacted: number | null;
  prev_replied: number | null;
}

export interface ProspectingFollowupMetric {
  live_total: number;
  by_day: Array<{ day: string; count: number }>;
  vacuo: number;
}

interface MetricsPayload {
  funnel: ProspectingFunnelStage[];
  response: ProspectingResponseMetric;
  followup: ProspectingFollowupMetric;
}

const EMPTY: MetricsPayload = {
  funnel: [],
  response: { contacted: 0, replied: 0, prev_contacted: null, prev_replied: null },
  followup: { live_total: 0, by_day: [], vacuo: 0 },
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    pipeline_id: url.searchParams.get("pipeline_id") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    prev_from: url.searchParams.get("prev_from") ?? undefined,
    prev_to: url.searchParams.get("prev_to") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(to.getTime() - THIRTY_DAYS_MS);
  if (from.getTime() >= to.getTime()) {
    return fail("validation_failed", "Janela inválida: 'from' deve ser anterior a 'to'.", 422, {
      requestId,
    });
  }

  // A janela anterior só existe em PAR — mandar uma ponta sem a outra é bug do
  // caller, não um default a inventar.
  const prevFrom = parsed.data.prev_from ? new Date(parsed.data.prev_from) : null;
  const prevTo = parsed.data.prev_to ? new Date(parsed.data.prev_to) : null;
  if ((prevFrom === null) !== (prevTo === null)) {
    return fail("validation_failed", "'prev_from' e 'prev_to' andam juntos.", 422, {
      requestId,
    });
  }
  if (prevFrom && prevTo && prevFrom.getTime() >= prevTo.getTime()) {
    return fail(
      "validation_failed",
      "Janela inválida: 'prev_from' deve ser anterior a 'prev_to'.",
      422,
      { requestId },
    );
  }

  const supabase = await createClient();

  // Sob RLS: pipeline de outra org (ou inexistente) volta null ⇒ 404.
  const { data: pipeline, error: pipeErr } = await supabase
    .from("crm_pipelines")
    .select("id, name")
    .eq("id", parsed.data.pipeline_id)
    .maybeSingle();
  if (pipeErr) return fail("internal_error", pipeErr.message, 500, { requestId });
  if (!pipeline) return fail("not_found", "Funil não encontrado.", 404, { requestId });

  const { data, error } = await supabase.rpc("fn_prospecting_metrics", {
    p_org: activeOrg.orgId,
    p_pipeline: pipeline.id,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    ...(prevFrom && prevTo
      ? { p_prev_from: prevFrom.toISOString(), p_prev_to: prevTo.toISOString() }
      : {}),
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const metrics = (data ?? EMPTY) as unknown as MetricsPayload;

  return ok(
    {
      window: { from: from.toISOString(), to: to.toISOString() },
      pipeline: { id: pipeline.id, name: pipeline.name },
      funnel: metrics.funnel,
      response: metrics.response,
      followup: metrics.followup,
    },
    { requestId },
  );
}
