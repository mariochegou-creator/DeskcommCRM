/**
 * PATCH  /api/v1/client-tags/[id] — renomeia, recolore ou reordena uma tag.
 * DELETE /api/v1/client-tags/[id] — tira a tag do catálogo E de quem a tem.
 *
 * As duas escritas alcançam `contacts.tags`, e é isso que separa este arquivo
 * de um CRUD comum. A tag aplicada é o NOME (ver o cabeçalho da 0105), então:
 *   - renomear sem cascata deixaria todo mundo marcado com uma tag que sumiu do
 *     catálogo — na tela ela vira um chip cinza, sem explicação;
 *   - apagar sem cascata deixaria a marca aplicada para sempre, e não existe
 *     tela para removê-la em massa.
 * As duas cascatas são as funções SQL da 0105 (casamento por nome normalizado,
 * que o PostgREST não sabe fazer em array).
 *
 * A ORDEM importa no PATCH: o catálogo é escrito PRIMEIRO. Se ele recusar (a
 * unique de nome), nada tocou os contatos; o contrário deixaria os contatos
 * renomeados apontando para um catálogo que não mudou.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { editarTagDoClienteSchema } from "@/lib/schemas/client-tags";
import { chaveDaTag } from "@/lib/tags/cores";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS = "id, name, color, position";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "crm_client_tags" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = editarTagDoClienteSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();

  const { data: antes, error: erroAntes } = await supabase
    .from("crm_client_tags")
    .select(COLUNAS)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (erroAntes) return fail("internal_error", "Falha ao ler a tag.", 500, { requestId });
  if (!antes) return fail("resource_not_found", "Tag não encontrada.", 404, { requestId });

  const nomeAntigo = (antes as { name: string }).name;
  const nomeNovo = parsed.data.name;
  // Trocar só a caixa ("vip" → "VIP") não é renomear para o casamento por nome
  // normalizado, mas É uma mudança que a pessoa quer ver na tela. O catálogo
  // grava; a cascata é que pode ser pulada.
  const renomeou = nomeNovo !== undefined && chaveDaTag(nomeNovo) !== chaveDaTag(nomeAntigo);

  const { data, error } = await supabase
    .from("crm_client_tags")
    .update({
      ...(nomeNovo !== undefined ? { name: nomeNovo } : {}),
      ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
      ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
    })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(COLUNAS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Já existe uma tag com esse nome.", 409, { requestId });
    }
    return fail("internal_error", "Falha ao salvar a tag.", 500, { requestId });
  }

  let clientesMexidos = 0;
  if (renomeou && nomeNovo) {
    const { data: mexidos, error: erroCascata } = await supabase.rpc(
      "fn_renomeia_tag_do_cliente",
      { p_organization_id: org.orgId, p_de: nomeAntigo, p_para: nomeNovo },
    );
    // A cascata falhar depois do catálogo ter mudado é o único estado ruim
    // possível aqui, e ele é VISÍVEL (os chips ficam cinza) e REPARÁVEL
    // (renomear de volta e de novo). Devolver 500 e deixar a tela achar que
    // nada mudou seria pior: o catálogo já mudou de verdade.
    if (erroCascata) {
      return ok(
        { ...(data as object), clientes_atualizados: null, aviso: "renomeada_sem_cascata" },
        { requestId },
      );
    }
    clientesMexidos = typeof mexidos === "number" ? mexidos : 0;
  }

  return ok({ ...(data as object), clientes_atualizados: clientesMexidos }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "crm_client_tags" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();

  const { data: alvo, error: erroAlvo } = await supabase
    .from("crm_client_tags")
    .select("id, name")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (erroAlvo) return fail("internal_error", "Falha ao ler a tag.", 500, { requestId });
  if (!alvo) return fail("resource_not_found", "Tag não encontrada.", 404, { requestId });

  // Os CLIENTES primeiro, o catálogo depois — o inverso da ordem do PATCH, e
  // pela mesma razão: se a segunda escrita falhar, o estado que sobra é o menos
  // ruim. Aqui isso é uma tag no catálogo que ninguém mais tem aplicada (some
  // no segundo clique); a ordem invertida deixaria a marca aplicada sem
  // nenhuma tela capaz de removê-la.
  const { data: mexidos, error: erroCascata } = await supabase.rpc("fn_remove_tag_do_cliente", {
    p_organization_id: org.orgId,
    p_nome: (alvo as { name: string }).name,
  });
  if (erroCascata) {
    return fail("internal_error", "Falha ao tirar a tag dos clientes.", 500, { requestId });
  }

  const { error } = await supabase
    .from("crm_client_tags")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.orgId);
  if (error) return fail("internal_error", "Falha ao apagar a tag.", 500, { requestId });

  return ok(
    { id, clientes_atualizados: typeof mexidos === "number" ? mexidos : 0 },
    { requestId },
  );
}
