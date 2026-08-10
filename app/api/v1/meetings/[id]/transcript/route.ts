/**
 * POST /api/v1/meetings/[id]/transcript — append de turnos em lote.
 *
 * A extensão bufferiza e manda a cada ~10s. IDEMPOTENTE pelo índice global do
 * turno (`i`): o servidor só acrescenta turnos com `i >= turn_count` atual —
 * um retry que reenvia o mesmo lote não duplica nada, e um lote atrasado que
 * chega depois de outro não embaralha (o que já entrou não entra de novo).
 *
 * A concatenação acontece no SQL (`transcript || novos`) via uma leitura do
 * turn_count + update condicionado ao MESMO turn_count — se dois lotes chegarem
 * juntos, o segundo update não casa a condição, e o retry da extensão reenvia.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import type { MeetingTurn } from "@/lib/sala-reunioes/vocabulary";
import { appendTranscriptSchema } from "@/lib/schemas/sala-reunioes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const body = await req.json().catch(() => null);
  const parsed = appendTranscriptSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Corpo inválido.", 422, {
        requestId,
        details: { issues: parsed.error.issues },
      }),
      req,
    );
  }

  const admin = createAdminClient();
  const { data: meeting, error: loadErr } = await admin
    .from("crm_meetings")
    .select("id, status, transcript, turn_count")
    .eq("id", id)
    .eq("organization_id", authz.orgId)
    .maybeSingle();
  if (loadErr) {
    return withCorsHeaders(fail("internal_error", loadErr.message, 500, { requestId }), req);
  }
  if (!meeting) {
    return withCorsHeaders(fail("not_found", "Reunião não encontrada.", 404, { requestId }), req);
  }
  if (meeting.status !== "ao_vivo") {
    // Lote atrasado depois do encerramento: recusa explícita em vez de reabrir
    // uma reunião que a análise pode já ter consumido.
    return withCorsHeaders(
      fail("meeting_not_live", "A reunião já foi encerrada.", 409, { requestId }),
      req,
    );
  }

  const currentCount = meeting.turn_count ?? 0;
  const novos = parsed.data.turns
    .filter((t) => t.i >= currentCount)
    .sort((a, b) => a.i - b.i) as MeetingTurn[];

  if (novos.length === 0) {
    // Lote inteiro já tinha entrado (retry) — sucesso idempotente.
    return withCorsHeaders(ok({ turn_count: currentCount, appended: 0 }, { requestId }), req);
  }

  const transcript = Array.isArray(meeting.transcript) ? meeting.transcript : [];
  const nextTranscript = [...transcript, ...novos];
  const nextCount = (novos[novos.length - 1]!.i ?? currentCount) + 1;

  // Update CONDICIONADO ao turn_count lido: se outro lote entrou no meio, a
  // condição não casa (0 linhas) e a extensão re-tenta com o estado novo.
  const { data: updated, error: updErr } = await admin
    .from("crm_meetings")
    .update({ transcript: nextTranscript, turn_count: nextCount })
    .eq("id", id)
    .eq("organization_id", authz.orgId)
    .eq("turn_count", currentCount)
    .select("id")
    .maybeSingle();
  if (updErr) {
    return withCorsHeaders(fail("internal_error", updErr.message, 500, { requestId }), req);
  }
  if (!updated) {
    return withCorsHeaders(
      fail("conflict", "Outro lote entrou primeiro — reenvie.", 409, { requestId }),
      req,
    );
  }

  return withCorsHeaders(
    ok({ turn_count: nextCount, appended: novos.length }, { requestId }),
    req,
  );
}
