/**
 * GET  /api/v1/broadcasts — as campanhas da org, com o placar de cada uma.
 * POST /api/v1/broadcasts — cria uma campanha em rascunho.
 *
 * Piso `manager` nos dois, e aqui a assimetria do catálogo de tags NÃO se
 * aplica: disparo em massa não é leitura de vocabulário, é a operação que pode
 * queimar o número da empresa. Quem vê o histórico de campanhas é quem responde
 * por ele.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { criarDisparoSchema } from "@/lib/schemas/broadcasts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, name, status, pause_reason, body_template, media_type, media_storage_path, audience, scheduled_at, daily_cap, max_recipients, send_as_user_id, channel_session_id, started_at, finished_at, created_at, updated_at";

const LIMITE = 50;

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .select(COLUNAS)
    .eq("organization_id", org.orgId)
    .order("created_at", { ascending: false })
    .limit(LIMITE);

  if (error) {
    return fail("internal_error", "Falha ao listar os disparos.", 500, { requestId });
  }

  const campanhas = (data ?? []) as { id: string }[];

  // Placar de todas as campanhas numa ida só. A alternativa (uma contagem por
  // campanha) faria 50 idas ao banco para pintar uma lista.
  const placar = new Map<string, Record<string, number>>();
  if (campanhas.length > 0) {
    const { data: linhas } = await supabase
      .from("broadcast_recipients")
      .select("broadcast_id, status")
      .eq("organization_id", org.orgId)
      .in(
        "broadcast_id",
        campanhas.map((c) => c.id),
      );
    for (const l of (linhas ?? []) as { broadcast_id: string; status: string }[]) {
      const atual = placar.get(l.broadcast_id) ?? {};
      atual[l.status] = (atual[l.status] ?? 0) + 1;
      placar.set(l.broadcast_id, atual);
    }
  }

  return ok(
    {
      broadcasts: campanhas.map((c) => ({ ...c, placar: placar.get(c.id) ?? {} })),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org, user } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = criarDisparoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const entrada = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcasts")
    .insert({
      organization_id: org.orgId,
      name: entrada.name,
      status: "draft",
      body_template: entrada.body_template ?? null,
      audience: entrada.audience ?? {},
      scheduled_at: entrada.scheduled_at ?? null,
      daily_cap: entrada.daily_cap ?? null,
      max_recipients: entrada.max_recipients,
      channel_session_id: entrada.channel_session_id ?? null,
      // Quem cria assina. A mensagem sai como dele no inbox do lead — é o que
      // impede o badge "IA" numa frase escrita por gente.
      send_as_user_id: user.id,
      created_by_user_id: user.id,
    })
    .select(COLUNAS)
    .single();

  if (error) {
    // O CHECK `broadcasts_tem_conteudo` pega rascunho vazio; a tela cria a
    // campanha com o texto já digitado, então isto é rede de segurança.
    if (error.code === "23514") {
      return fail("validation_failed", "A campanha precisa de um texto ou de uma mídia.", 422, {
        requestId,
      });
    }
    return fail("internal_error", "Falha ao criar o disparo.", 500, { requestId });
  }

  await audit({
    action: "broadcast.created",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "broadcast",
    resourceId: (data as { id: string }).id,
    requestId,
    metadata: { name: entrada.name },
  });

  return ok(data, { status: 201, requestId });
}
