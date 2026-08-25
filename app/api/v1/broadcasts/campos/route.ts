/**
 * GET /api/v1/broadcasts/campos — as dimensões de público que ESTA org tem.
 *
 * Existe porque "nicho" não é campo do sistema: é uma chave dentro de
 * `crm_leads.custom_fields` batizada com o cabeçalho do CSV que alguém importou
 * — `categoria` numa lista do Kaptar, `Nicho` noutra, `SEGMENTO` numa terceira.
 * Um seletor com campos fixos mostraria opções que não existem no banco e
 * esconderia as que existem.
 *
 * Então a tela pergunta ao banco quais chaves existem e quais valores elas
 * assumem, e oferece isso. Junto vão as tags (negócio e cliente), que são as
 * outras duas dimensões.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { chavesDeCustomFields } from "@/lib/broadcasts/audience";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Amostra de leads para descobrir as chaves. Ver o cabeçalho de `chavesDeCustomFields`. */
const AMOSTRA = 500;

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();

  try {
    const [campos, { data: tagsDoCliente }, { data: leads }] = await Promise.all([
      chavesDeCustomFields(supabase, org.orgId, AMOSTRA),
      supabase
        .from("crm_client_tags")
        .select("name, color")
        .eq("organization_id", org.orgId)
        .order("position", { ascending: true }),
      supabase
        .from("crm_leads")
        .select("tags")
        .eq("organization_id", org.orgId)
        .not("tags", "eq", "{}")
        .limit(AMOSTRA),
    ]);

    // Tags de negócio não têm catálogo (só sugestões no pipeline) — as que
    // existem saem das próprias linhas.
    const tagsDoNegocio = new Set<string>();
    for (const l of (leads ?? []) as { tags: string[] | null }[]) {
      for (const t of l.tags ?? []) if (t.trim()) tagsDoNegocio.add(t);
    }

    return ok(
      {
        custom_fields: campos,
        client_tags: tagsDoCliente ?? [],
        lead_tags: [...tagsDoNegocio].sort((a, b) => a.localeCompare(b, "pt-BR")),
      },
      { requestId },
    );
  } catch {
    return fail("internal_error", "Falha ao ler os campos disponíveis.", 500, { requestId });
  }
}
