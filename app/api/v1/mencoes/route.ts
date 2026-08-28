/**
 * GET  /api/v1/mencoes — as notas internas onde EU fui citado e ainda não vi.
 * POST /api/v1/mencoes — { note_id }: vi essa, tira do meu sino.
 *
 * A pergunta é sempre sobre `auth.uid()`, nunca sobre um id que veio na URL:
 * menção de outra pessoa não é assunto de ninguém, e o filtro é a única coisa
 * que separa os dois — por isso ele mora aqui e não no cliente.
 *
 * Sem paginação: o teto de 20 é o próprio desenho. Sino com 20 avisos parados
 * já perdeu a função; a saída é olhar, não rolar.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TETO = 20;
const lidaSchema = z.object({ note_id: z.string().uuid() });

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversation_notes" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_notes")
    // O nome do cliente vem junto porque é ele que diz DE QUAL conversa se
    // trata — com três avisos na fila, "Mario te marcou" três vezes não
    // distingue nada. `contacts` pode voltar null (conversa sem contato ligado)
    // e a tela cai no rótulo genérico.
    .select("id, conversation_id, body, created_by_name, created_at, conversations(contacts(name, display_name))")
    .eq("organization_id", org.orgId)
    .contains("mentions", [user.id])
    .order("created_at", { ascending: false })
    .limit(TETO);
  if (error) return fail("internal_error", "Erro ao listar menções.", 500, { requestId });

  const mencoes = (data ?? []).map((n) => {
    const conversa = n.conversations as { contacts?: { name?: string | null; display_name?: string | null } | null } | null;
    const contato = conversa?.contacts ?? null;
    return {
      id: n.id as string,
      conversation_id: n.conversation_id as string,
      body: n.body as string,
      autor: (n.created_by_name as string | null) ?? "Alguém",
      cliente: contato?.display_name ?? contato?.name ?? null,
      created_at: n.created_at as string,
    };
  });
  return ok(mencoes, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversation_notes" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const parsed = lidaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });

  const supabase = await createClient();
  const { data: nota } = await supabase
    .from("conversation_notes")
    .select("id, mentions")
    .eq("id", parsed.data.note_id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (!nota) return fail("not_found", "Nota não encontrada.", 404, { requestId });

  // ponytail: lê-filtra-grava em vez de `array_remove` no banco. Duas pessoas
  // dando baixa no MESMO segundo na MESMA nota podem ressuscitar o aviso de uma
  // delas — clique a mais, nada perdido. Vira RPC se a equipe crescer a ponto de
  // isso acontecer de verdade.
  const restantes = ((nota.mentions as string[] | null) ?? []).filter((uid) => uid !== user.id);
  const { error } = await supabase
    .from("conversation_notes")
    .update({ mentions: restantes })
    .eq("id", parsed.data.note_id)
    .eq("organization_id", org.orgId);
  if (error) return fail("internal_error", "Erro ao marcar a menção.", 500, { requestId });

  return ok({ id: parsed.data.note_id }, { requestId });
}
