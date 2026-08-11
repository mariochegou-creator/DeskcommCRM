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
import { contatoPorTelefone } from "@/lib/contacts/contato-por-telefone";
import { createClient } from "@/lib/supabase/server";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";
import { importLeadsSchema, type ImportRow } from "@/lib/schemas/lead-import";
import { createLeadHandler } from "../_handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ResultadoLinha {
  linha: number;
  /** "reparado" = lead que existia SEM contato ganhou o telefone desta linha. */
  status: "criado" | "repetido" | "reparado" | "erro";
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

/**
 * Campos da linha que o lead existente ainda NÃO tem. Chave já presente nunca
 * é tocada — reimportar preenche buraco (gancho que faltou, link do Maps que
 * a lista antiga não trazia), jamais reescreve o que alguém editou depois.
 * (Começou aceitando só gancho_*; generalizado em 06/08 quando o link do
 * Google Maps precisou entrar pelo mesmo caminho.)
 */
function camposFaltantes(
  existentes: unknown,
  daLinha: Record<string, string>,
): Record<string, string> {
  const atuais =
    existentes && typeof existentes === "object" && !Array.isArray(existentes)
      ? (existentes as Record<string, unknown>)
      : {};
  const novos: Record<string, string> = {};
  for (const [key, value] of Object.entries(daLinha)) {
    if (key in atuais) continue;
    novos[key] = value;
  }
  return novos;
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

      // Contato: acha ou cria por telefone (regra compartilhada com o
      // formulário de novo lead do quadro — lib/contacts/contato-por-telefone).
      let contactId: string | undefined;
      if (phone) {
        const contato = await contatoPorTelefone(supabase, {
          organizationId: org.orgId,
          createdByUserId: user.id,
          phone,
          name: row.dono?.trim() || row.negocio,
          email: row.email ?? null,
          source: "import",
          sourceMetadata,
          requestId,
        });
        contactId = contato.id;

        if (contato.jaExistia) {
          // Dedupe: mesmo arquivo subido de novo → o lead já existe.
          // Mas se ESTA subida traz dado que o lead não tem, ele entra:
          // é o caminho de enriquecer uma leva que subiu incompleta.
          //
          // SEM filtro de status DE PROPÓSITO: reimportar é ATUALIZAR, nunca
          // recomeçar. Um lead que o Mario já marcou como ganho ou perdido
          // continua sendo o mesmo negócio da lista — criar outro em "Novo"
          // desfaria o trabalho dele. E nada aqui toca etapa, posição,
          // responsável ou status: card movido fica onde está.
          const { data: leadExistente } = await supabase
            .from("crm_leads")
            .select("id, custom_fields")
            .eq("organization_id", org.orgId)
            .eq("contact_id", contactId)
            .eq("pipeline_id", pipeline_id)
            .eq("title", row.negocio)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (leadExistente) {
            const novos = camposFaltantes(leadExistente.custom_fields, customFieldsDaLinha(row));
            if (Object.keys(novos).length > 0) {
              const { error: mesclaErr } = await supabase
                .from("crm_leads")
                .update({
                  custom_fields: {
                    ...((leadExistente.custom_fields as Record<string, unknown>) ?? {}),
                    ...novos,
                  },
                  updated_at: new Date().toISOString(),
                })
                .eq("id", leadExistente.id);
              if (mesclaErr) {
                throw new ApiError(500, "internal_error", undefined, requestId, mesclaErr.message);
              }
              resultados.push({
                linha,
                status: "reparado",
                lead_id: leadExistente.id as string,
                motivo: "Lead já existia — dados novos da lista adicionados (ganchos, Maps…).",
              });
              continue;
            }
            resultados.push({
              linha,
              status: "repetido",
              lead_id: leadExistente.id as string,
              motivo: "Já existe lead deste negócio para este telefone.",
            });
            continue;
          }
        }
      }

      // Lead órfão do MESMO negócio (sem contato) já existe neste funil?
      // Acontece quando uma importação anterior leu a coluna do telefone
      // errado: o lead nasceu sem contato e sem botão de conversa. Subir o
      // arquivo de novo REPARA em vez de duplicar — religa o telefone ao
      // lead que já está no quadro.
      // Também sem filtro de status: órfão marcado como perdido continua
      // merecendo o telefone e os dados — religar não mexe na decisão tomada.
      const { data: orfao } = await supabase
        .from("crm_leads")
        .select("id, custom_fields")
        .eq("organization_id", org.orgId)
        .eq("pipeline_id", pipeline_id)
        .eq("title", row.negocio)
        .is("contact_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (orfao) {
        if (!contactId) {
          resultados.push({
            linha,
            status: "repetido",
            lead_id: orfao.id as string,
            motivo: "Lead já existia (sem telefone nas duas listas).",
          });
          continue;
        }
        // Religa o telefone E aproveita a passada pra entregar os ganchos que
        // esta linha traz e o lead ainda não tem.
        const novos = camposFaltantes(orfao.custom_fields, customFieldsDaLinha(row));
        const { error: religaErr } = await supabase
          .from("crm_leads")
          .update({
            contact_id: contactId,
            ...(Object.keys(novos).length > 0
              ? {
                  custom_fields: {
                    ...((orfao.custom_fields as Record<string, unknown>) ?? {}),
                    ...novos,
                  },
                }
              : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", orfao.id);
        if (religaErr) {
          throw new ApiError(500, "internal_error", undefined, requestId, religaErr.message);
        }
        resultados.push({
          linha,
          status: "reparado",
          lead_id: orfao.id as string,
          motivo:
            Object.keys(novos).length > 0
              ? "Lead já existia sem telefone — telefone religado e ganchos adicionados."
              : "Lead já existia sem telefone — telefone religado ao contato.",
        });
        continue;
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
  const reparados = resultados.filter((r) => r.status === "reparado").length;
  const erros = resultados.filter((r) => r.status === "erro").length;

  return ok({ criados, repetidos, reparados, erros, resultados }, { requestId });
}
