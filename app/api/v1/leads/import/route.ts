/**
 * POST /api/v1/leads/import — carga da lista de prospecção enriquecida.
 *
 * A tela /app/settings/import-lista parseia o CSV, mapeia as colunas e manda
 * as linhas aqui em lotes. Cada linha vira:
 *   - contato (upsert por telefone E.164, mesmo padrão do webhook de captação):
 *     nome = dono da lista, ou o nome do negócio repetido quando não há dono;
 *   - lead no funil/estágio escolhidos: título = nome do negócio, source
 *     "import", ganchos de abertura em custom_fields (gancho_abertura,
 *     gancho_2, …) — é de lá que o painel do inbox e a nota semeada da
 *     conversa os leem.
 *
 * Reenviar a mesma lista não duplica: linha cujo contato (por telefone) já tem
 * lead ABERTO com o mesmo título no mesmo funil conta como "repetido". Não é
 * o external_id do webhook — lista exportada de ferramenta não traz ID de
 * disparo — mas cobre o caso real: subir o mesmo arquivo duas vezes.
 *
 * Papel: manager. Importar lista é carga/configuração, não trabalho de card —
 * mesma régua de webhook-sources. Client de sessão: a RLS vale.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";
import { importLeadsSchema, type ImportRow } from "@/lib/schemas/lead-import";
import { createLeadHandler } from "../_handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ResultadoLinha {
  linha: number;
  status: "criado" | "repetido" | "erro";
  lead_id?: string;
  motivo?: string;
}

function customFieldsDaLinha(row: ImportRow): Record<string, string> {
  const campos: Record<string, string> = {};
  row.ganchos.forEach((g, i) => {
    campos[i === 0 ? "gancho_abertura" : `gancho_${i + 1}`] = g;
  });
  for (const [key, value] of Object.entries(row.extras)) {
    if (!(key in campos)) campos[key] = value;
  }
  return campos;
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "leads_import" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const raw = await req.json().catch(() => null);
  const parsed = importLeadsSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { pipeline_id, stage_id, file_name, rows } = parsed.data;

  const supabase = await createClient();
  const ctx = {
    organization_id: org.orgId,
    actor: { type: "user" as const, id: user.id },
    requestId,
  };
  const sourceMetadata: Record<string, unknown> = {
    import_file: file_name ?? null,
    imported_by_user_id: user.id,
  };

  const resultados: ResultadoLinha[] = [];

  // Sequencial de propósito: lotes são pequenos (≤25) e paralelizar faria as
  // linhas disputarem o MAX(position_in_stage) do createLeadHandler.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const linha = i + 1;
    try {
      const phone = normalizePhoneBR(row.telefone ?? null);

      // Contato: upsert por telefone, só linha ativa (contato mesclado não
      // volta — mesmo predicado do webhook de captação).
      let contactId: string | undefined;
      if (phone) {
        const selectAtivoPorTelefone = () =>
          supabase
            .from("contacts")
            .select("id")
            .eq("organization_id", org.orgId)
            .eq("phone_number", phone)
            .is("is_merged_into", null)
            .maybeSingle();

        const { data: existente, error: selErr } = await selectAtivoPorTelefone();
        if (selErr) throw new ApiError(500, "internal_error", undefined, requestId, selErr.message);

        if (existente) {
          contactId = existente.id as string;
          // Dedupe: mesmo arquivo subido de novo → o lead aberto já existe.
          const { data: leadExistente } = await supabase
            .from("crm_leads")
            .select("id")
            .eq("organization_id", org.orgId)
            .eq("contact_id", contactId)
            .eq("pipeline_id", pipeline_id)
            .eq("status", "open")
            .eq("title", row.negocio)
            .limit(1)
            .maybeSingle();
          if (leadExistente) {
            resultados.push({
              linha,
              status: "repetido",
              lead_id: leadExistente.id as string,
              motivo: "Já existe lead aberto deste negócio para este telefone.",
            });
            continue;
          }
        } else {
          const { data: criado, error: insErr } = await supabase
            .from("contacts")
            .insert({
              organization_id: org.orgId,
              created_by_user_id: user.id,
              name: row.dono?.trim() || row.negocio,
              phone_number: phone,
              email: row.email ?? null,
              source: "import",
              source_metadata: sourceMetadata,
            })
            .select("id")
            .maybeSingle();
          if (insErr) {
            if (insErr.code === "23505") {
              // Corrida com outro lote/aba: o índice único por telefone
              // derrubou este insert — reusa o vencedor.
              const { data: vencedor } = await selectAtivoPorTelefone();
              contactId = (vencedor?.id as string | undefined) ?? undefined;
            } else {
              throw new ApiError(500, "internal_error", undefined, requestId, insErr.message);
            }
          } else {
            contactId = (criado?.id as string | undefined) ?? undefined;
          }
        }
      }

      const lead = await createLeadHandler(supabase, ctx, {
        pipeline_id,
        stage_id,
        title: row.negocio,
        contact_id: contactId,
        currency: "BRL",
        tags: [],
        source: "import",
        custom_fields: customFieldsDaLinha(row),
        source_metadata: sourceMetadata,
      });

      resultados.push({
        linha,
        status: "criado",
        lead_id: String(lead.id),
        ...(phone || !row.telefone
          ? {}
          : { motivo: "Telefone não reconhecido — lead criado sem contato/WhatsApp." }),
      });
    } catch (err) {
      resultados.push({
        linha,
        status: "erro",
        motivo: err instanceof ApiError ? (err.message ?? err.code) : "Falha inesperada.",
      });
    }
  }

  const criados = resultados.filter((r) => r.status === "criado").length;
  const repetidos = resultados.filter((r) => r.status === "repetido").length;
  const erros = resultados.filter((r) => r.status === "erro").length;

  return ok({ criados, repetidos, erros, resultados }, { requestId });
}
