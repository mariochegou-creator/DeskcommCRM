/**
 * GET /api/v1/meetings/metrics?days=30 — os números da Sala de Reuniões.
 *
 * Agregação em JS de propósito: o volume é de dezenas de reuniões por mês
 * (uma pessoa vendendo), não milhares — uma fn SQL aqui seria otimização de
 * problema que não existe, e o jsonb de spin_scores é mais simples de agregar
 * onde o formato já é conhecido. Se o volume crescer, o caminho é a fn (o
 * precedente é fn_prospecting_metrics).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import type { MeetingPhase } from "@/lib/sala-reunioes/vocabulary";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

const Query = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

interface Row {
  meeting_type: string;
  status: string;
  outcome: string | null;
  score: number | null;
  spin_scores: Record<string, { nota?: number }> | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Parâmetros inválidos.", 422, { requestId }),
      req,
    );
  }

  const since = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("crm_meetings")
    .select("meeting_type, status, outcome, score, spin_scores")
    .eq("organization_id", authz.orgId)
    .gte("started_at", since)
    .limit(1000);
  if (error) {
    return withCorsHeaders(fail("internal_error", error.message, 500, { requestId }), req);
  }

  const { data: sugRows, error: sugErr } = await admin
    .from("crm_meeting_suggestions")
    .select("was_followed, meeting_id, crm_meetings!inner(organization_id, started_at)")
    .eq("crm_meetings.organization_id", authz.orgId)
    .gte("crm_meetings.started_at", since)
    .not("was_followed", "is", null)
    .limit(5000);
  if (sugErr) {
    return withCorsHeaders(fail("internal_error", sugErr.message, 500, { requestId }), req);
  }

  const meetings = (rows ?? []) as Row[];
  const done = meetings.filter(
    (m) => m.status === "concluida" || m.status === "concluida_sem_formato",
  );
  const r1 = done.filter((m) => m.meeting_type === "r1");
  const r2 = done.filter((m) => m.meeting_type === "r2");

  // Taxa de avanço da R1 = quantas saíram com progresso real (pedido/avanço),
  // na taxonomia de Rackham — continuação NÃO conta, e é essa a graça.
  const progressoR1 = r1.filter((m) => m.outcome === "pedido" || m.outcome === "avanco").length;
  const fechamentoR2 = r2.filter((m) => m.outcome === "pedido").length;

  const comNota = done.filter((m) => typeof m.score === "number");
  const notaMedia =
    comNota.length > 0
      ? comNota.reduce((acc, m) => acc + (m.score ?? 0), 0) / comNota.length
      : null;

  // Nota média por fase, agregando o jsonb spin_scores das concluídas.
  const porFase: Partial<Record<MeetingPhase, { soma: number; n: number }>> = {};
  for (const m of done) {
    if (!m.spin_scores || typeof m.spin_scores !== "object") continue;
    for (const [fase, v] of Object.entries(m.spin_scores)) {
      const nota = typeof v?.nota === "number" ? v.nota : null;
      if (nota === null) continue;
      const slot = (porFase[fase as MeetingPhase] ??= { soma: 0, n: 0 });
      slot.soma += nota;
      slot.n += 1;
    }
  }
  const notaPorFase = Object.fromEntries(
    Object.entries(porFase).map(([fase, { soma, n }]) => [fase, soma / n]),
  );

  const vereditos = sugRows ?? [];
  const seguidas = vereditos.filter((s) => s.was_followed === true).length;

  return withCorsHeaders(
    ok(
      {
        days: parsed.data.days,
        total_reunioes: meetings.length,
        r1_concluidas: r1.length,
        r2_concluidas: r2.length,
        taxa_avanco_r1: r1.length > 0 ? progressoR1 / r1.length : null,
        taxa_fechamento_r2: r2.length > 0 ? fechamentoR2 / r2.length : null,
        nota_media: notaMedia,
        nota_por_fase: notaPorFase,
        sugestoes_avaliadas: vereditos.length,
        pct_sugestoes_seguidas: vereditos.length > 0 ? seguidas / vereditos.length : null,
      },
      { requestId },
    ),
    req,
  );
}
