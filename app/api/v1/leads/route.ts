/**
 * POST /api/v1/leads — create lead (handler em ./_handler.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { contatoPorTelefone } from "@/lib/contacts/contato-por-telefone";
import { telefoneE164 } from "@/lib/contacts/telefone";
import { whatsappLink } from "@/lib/contacts/whatsapp";
import { createLeadSchema, validateRequest, type CreateLeadInput } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { createLeadHandler } from "./_handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(createLeadSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const supabase = await createClient();
  const { contact_phone, ...leadInput } = input as CreateLeadInput & {
    contact_phone?: string | null;
  };

  try {
    // Telefone digitado → contato. O formulário manda o número; quem decide
    // se ele é contato NOVO ou um que já existe é o servidor (a mesma regra da
    // importação de lista, em lib/contacts/contato-por-telefone).
    let contactId = leadInput.contact_id ?? null;
    if (!contactId && contact_phone) {
      const phone = telefoneE164(contact_phone);
      if (!phone || !whatsappLink(phone)) {
        return fail(
          "validation_failed",
          "Número de WhatsApp inválido. Use DDD + número — ex: (73) 99134-6237.",
          422,
          { requestId },
        );
      }
      const contato = await contatoPorTelefone(supabase, {
        organizationId: activeOrg.orgId,
        createdByUserId: authUser.id,
        phone,
        // Contato novo nasce com o nome do negócio; contato que já existe
        // mantém o nome que tem — quem cadastrou antes sabia mais.
        name: leadInput.title,
        source: leadInput.source ?? "manual",
        sourceMetadata: { created_by_user_id: authUser.id },
        requestId,
      });
      contactId = contato.id;
    }

    const lead = await createLeadHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: authUser.id },
        requestId,
      },
      { ...leadInput, contact_id: contactId } as CreateLeadInput,
    );
    return ok(lead, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
