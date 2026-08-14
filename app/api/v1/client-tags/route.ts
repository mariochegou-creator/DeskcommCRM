/**
 * GET  /api/v1/client-tags — o catálogo de tags do cliente da org ativa (0105).
 * POST /api/v1/client-tags — cria uma tag no catálogo.
 *
 * LER é `viewer` e ESCREVER é `manager`, e a assimetria é o ponto: o chip
 * colorido aparece para quem atende (a lista do inbox e o card do Kanban leem
 * este catálogo a cada render), mas mudar o vocabulário de uma organização
 * inteira é decisão de quem configura — a mesma linha que `crm_pipelines`
 * desenha entre ver o funil e reconfigurá-lo.
 *
 * A RLS de `crm_client_tags` isola por tenant e só por tenant (ver o cabeçalho
 * da 0105): a hierarquia de papel mora aqui, não em SQL, para não existir uma
 * segunda cópia de ROLE_RANK que possa divergir da primeira.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { criarTagDoClienteSchema } from "@/lib/schemas/client-tags";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Contrato explícito — nunca `select("*")`. */
const COLUNAS = "id, name, color, position";

/**
 * Teto de linhas. Não é paginação: passando de algumas dezenas, tag deixa de
 * ser vocabulário e vira campo de texto — e a tela de Configurações, que lista
 * tudo de uma vez, é onde isso fica evidente.
 */
const LIMITE = 100;

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("viewer", { requestId, resource: "crm_client_tags" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_client_tags")
    .select(COLUNAS)
    .eq("organization_id", org.orgId)
    .order("position", { ascending: true })
    .order("name", { ascending: true })
    .limit(LIMITE);

  if (error) {
    return fail("internal_error", "Falha ao listar as tags.", 500, { requestId });
  }

  return ok({ tags: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "crm_client_tags" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = criarTagDoClienteSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();

  // A posição nasce no fim da lista: quem cria uma tag está acrescentando ao
  // vocabulário, não reordenando o que já existe.
  const { data: ultima } = await supabase
    .from("crm_client_tags")
    .select("position")
    .eq("organization_id", org.orgId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("crm_client_tags")
    .insert({
      organization_id: org.orgId,
      name: parsed.data.name,
      color: parsed.data.color,
      position: ((ultima as { position: number } | null)?.position ?? -1) + 1,
    })
    .select(COLUNAS)
    .single();

  if (error) {
    // 23505 = a unique de nome normalizado da 0105. Devolver 500 aqui faria a
    // tela dizer "erro no servidor" para o caso mais comum de todos: a pessoa
    // criando de novo uma tag que já existe escrita com outra caixa.
    if (error.code === "23505") {
      return fail("conflict", "Já existe uma tag com esse nome.", 409, { requestId });
    }
    return fail("internal_error", "Falha ao criar a tag.", 500, { requestId });
  }

  return ok(data, { requestId });
}
