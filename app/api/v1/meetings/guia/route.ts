/**
 * POST /api/v1/meetings/guia — grava o que saiu do Guia da Reunião (e do
 * Quadro Branco) nos lugares onde o resto do produto já lê.
 *
 * DOIS DESTINOS, DE PROPÓSITO:
 * - `lead_notes` no contato do negócio — é de onde o preparo da próxima
 *   reunião lê (`lib/agendamento/material-gerar.ts`) e de onde o copiloto ao
 *   vivo puxa contexto (`live-suggest`). Nota aqui vira memória da operação, e
 *   a cascata LGPD da 0107 já sabe apagá-la.
 * - `crm_meetings.notes` quando há reunião — o dossiê da reunião conta a
 *   história completa dela, guia incluído.
 *
 * Um destino falhar NÃO derruba o outro: o vendedor acabou de sair de uma
 * call e o que ele digitou não pode evaporar porque um insert deu ruim. Só é
 * erro quando NENHUM lugar aceitou.
 *
 * Mesmo contrato de auth/CORS das rotas irmãs (ver app/api/v1/meetings/route.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import { salvarGuiaSchema } from "@/lib/schemas/sala-reunioes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const body = await req.json().catch(() => null);
  const parsed = salvarGuiaSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Corpo inválido.", 422, {
        requestId,
        details: { issues: parsed.error.issues },
      }),
      req,
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();

  // Resolver o CONTATO: `lead_notes` é indexado por contato (decisão da 0107).
  // A reunião pode trazer contato e negócio; o negócio traz o contato dele.
  let contactId: string | null = null;
  let leadId = input.lead_id ?? null;
  let notasDaReuniao: string | null = null;

  if (input.meeting_id) {
    const { data: meeting } = await admin
      .from("crm_meetings")
      .select("id, lead_id, contact_id, notes")
      .eq("id", input.meeting_id)
      .eq("organization_id", authz.orgId)
      .maybeSingle();
    if (!meeting) {
      return withCorsHeaders(
        fail("not_found", "Reunião não encontrada.", 404, { requestId }),
        req,
      );
    }
    contactId = meeting.contact_id;
    leadId = leadId ?? meeting.lead_id;
    notasDaReuniao = meeting.notes;
  }

  if (leadId) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id, contact_id")
      .eq("id", leadId)
      .eq("organization_id", authz.orgId)
      .maybeSingle();
    if (!lead) {
      return withCorsHeaders(
        fail("not_found", "Negócio não encontrado.", 404, { requestId }),
        req,
      );
    }
    contactId = contactId ?? lead.contact_id;
  }

  let salvoNoLead = false;
  if (contactId) {
    const { error } = await admin.from("lead_notes").insert({
      organization_id: authz.orgId,
      contact_id: contactId,
      headline: input.headline.slice(0, 300),
      body: input.body.slice(0, 4_000),
    });
    salvoNoLead = !error;
  }

  let salvoNaReuniao = false;
  if (input.meeting_id) {
    // Append, nunca overwrite: a reunião pode já ter notas de outra origem
    // (PATCH manual, análise) e o guia chega por cima, não no lugar.
    const corpo = notasDaReuniao?.trim()
      ? `${notasDaReuniao.trim()}\n\n${input.body}`
      : input.body;
    const { error } = await admin
      .from("crm_meetings")
      .update({ notes: corpo.slice(0, 20_000) })
      .eq("id", input.meeting_id)
      .eq("organization_id", authz.orgId);
    salvoNaReuniao = !error;
  }

  if (!salvoNoLead && !salvoNaReuniao) {
    return withCorsHeaders(
      fail(
        "internal_error",
        contactId
          ? "Não foi possível salvar a nota."
          : "Este negócio não tem contato — não há card onde pendurar a nota.",
        contactId ? 500 : 422,
        { requestId },
      ),
      req,
    );
  }

  return withCorsHeaders(
    ok({ salvo_no_lead: salvoNoLead, salvo_na_reuniao: salvoNaReuniao }, { requestId }),
    req,
  );
}
