/**
 * GET /api/v1/calls — o histórico de ligações da organização.
 *
 * POR QUE ESTA ROTA NASCEU DEPOIS. Na primeira entrega a análise só existia
 * dentro do contato e do dossiê do negócio: para reler uma ligação era preciso
 * lembrar PARA QUEM ela foi. Quem coordena o time não trabalha assim — a
 * pergunta é "como foram as ligações de ontem", e ela não tinha resposta em
 * lugar nenhum do produto. A ferramenta parecia quebrada por não ter tela, não
 * por não funcionar.
 *
 * `viewer` LÊ: dar feedback ao SDR é justamente o trabalho de quem coordena, e
 * essa pessoa nem sempre tem role de escrita. A RLS recorta por organização; a
 * paginação é `range`, e o total vem do `count` exato porque a tela mostra
 * "23 ligações" e um número aproximado ali seria pior que número nenhum.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { CALL_OUTCOMES, CALL_STATUSES } from "@/lib/calls/analysis-schema";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(CALL_STATUSES).optional(),
  outcome: z.enum(CALL_OUTCOMES).optional(),
  /**
   * `true` esconde as tentativas sem gravação (o SDR clicou em Ligar no celular
   * e o áudio nunca veio). São histórico legítimo, mas enchem a lista de linhas
   * sem nada para ler — o padrão da tela é mostrar o que tem conteúdo.
   */
  com_analise: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("viewer", { requestId, resource: "crm_call_recordings" });
  if (!authz.ok) return authz.response;

  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return fail("validation_failed", "Filtros inválidos.", 422, {
      requestId,
      details: { issues: parsed.error.issues },
    });
  }
  const { limit, offset, status, outcome, com_analise } = parsed.data;

  const supabase = await createClient();
  let query = supabase
    .from("crm_call_recordings")
    // O embed do contato é o que transforma a lista em algo legível — sem o
    // nome, cada linha é um uuid e uma nota. `contacts!crm_call_recordings_contact_id_fkey`
    // nomeia a FK explicitamente: há mais de um caminho entre estas tabelas, e
    // sem o nome o PostgREST recusa a consulta como ambígua.
    .select(
      "id, contact_id, lead_id, status, outcome, score, duration_seconds, created_at, contacts!crm_call_recordings_contact_id_fkey(display_name, name, phone_number)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (outcome) query = query.eq("outcome", outcome);
  if (com_analise) query = query.not("storage_path", "is", null);

  const { data, error, count } = await query;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const items = (data ?? []).map((row) => {
    // O PostgREST devolve o embed como OBJETO (a FK é para um contato só), mas o
    // typegen o infere como array. `unknown` no meio é o que o TypeScript exige
    // para aceitar a correção — e a forma real é conferida logo abaixo, com `??`
    // em todo campo.
    const contato = row.contacts as unknown as {
      display_name: string | null;
      name: string | null;
      phone_number: string | null;
    } | null;
    return {
      id: row.id,
      contact_id: row.contact_id,
      lead_id: row.lead_id,
      contact_name: contato?.display_name ?? contato?.name ?? "Contato sem nome",
      phone_number: contato?.phone_number ?? null,
      status: row.status,
      outcome: row.outcome,
      score: row.score,
      duration_seconds: row.duration_seconds,
      created_at: row.created_at,
    };
  });

  return ok({ items, total: count ?? items.length, limit, offset }, { requestId });
}
