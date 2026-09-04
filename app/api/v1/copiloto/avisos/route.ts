/**
 * GET /api/v1/copiloto/avisos?tela=inbox — o que o copiloto tem a dizer sobre
 * a tela em que a pessoa está.
 *
 * ⚠️ NÃO CHAMA MODELO DE LINGUAGEM. As regras vivem em `lib/copiloto/avisos.ts`
 * e são contas sobre o banco — de graça, instantâneas, iguais para o mesmo
 * estado e cobertas por teste. O racional completo está no cabeçalho de lá.
 *
 * Por tela, e não tudo de uma vez: abrir o inbox não deve custar a varredura do
 * funil, das conexões e das tarefas por causa de avisos que ninguém vai ver.
 *
 * Admin client bypassa RLS — toda query de `sinais.ts` filtra organization_id,
 * resolvido da sessão via requireRole e nunca do query string.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  avisosDasConexoes,
  avisosDasTarefas,
  avisosDoInbox,
  avisosDoKanban,
  type Aviso,
} from "@/lib/copiloto/avisos";
import {
  sinaisDasConexoes,
  sinaisDasTarefas,
  sinaisDoInbox,
  sinaisDoKanban,
} from "@/lib/copiloto/sinais";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  tela: z.enum(["inbox", "kanban", "conexoes", "tarefas"]),
});

export interface RespostaDoCopiloto {
  tela: string;
  avisos: Aviso[];
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "copiloto" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    // Tela desconhecida não é erro do usuário — é o copiloto sendo montado numa
    // rota que ainda não tem regra. Responder vazio deixa o botão sumir sozinho.
    return ok({ tela: "", avisos: [] } satisfies RespostaDoCopiloto, { requestId });
  }

  const db = createAdminClient();
  const { tela } = parsed.data;

  try {
    let avisos: Aviso[] = [];
    if (tela === "inbox") avisos = avisosDoInbox(await sinaisDoInbox(db, org.orgId));
    else if (tela === "kanban")
      avisos = avisosDoKanban(await sinaisDoKanban(db, org.orgId, new Date()));
    else if (tela === "conexoes") avisos = avisosDasConexoes(await sinaisDasConexoes(db, org.orgId));
    else avisos = avisosDasTarefas(await sinaisDasTarefas(db, org.orgId));

    return ok({ tela, avisos } satisfies RespostaDoCopiloto, { requestId });
  } catch (err) {
    // ⚠️ Copiloto que quebra não pode quebrar a tela em que ele mora. Falha de
    // leitura vira "nada a dizer" — o pior desfecho aceitável é o botão sumir.
    const msg = err instanceof Error ? err.message : "unknown";
    return fail("copiloto_indisponivel", msg, 503, { requestId });
  }
}
