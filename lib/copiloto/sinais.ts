/**
 * Os números que o copiloto lê, por tela.
 *
 * Cada função aqui só conta — quem transforma conta em frase é `avisos.ts`. A
 * separação é o que deixa as regras testáveis sem banco, e é por isso que o
 * teste do copiloto roda em milissegundos.
 *
 * ⚠️ Admin client bypassa RLS: TODA query filtra `organization_id`
 * explicitamente, resolvido da sessão e nunca do body. Mesmo contrato do
 * Radar de Risco (`leads/at-risk`).
 *
 * ⚠️ Só se busca o que a tela pediu. O copiloto do inbox não conta tarefa, e o
 * das tarefas não abre o funil — abrir uma tela não deve custar cinco varreduras
 * no banco por causa de avisos que ninguém vai ver.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EtapaDoFunil,
  NumeroDeWhatsApp,
  SinaisDasConexoes,
  SinaisDasTarefas,
  SinaisDoInbox,
  SinaisDoKanban,
} from "./avisos";

// ponytail: teto da varredura de leads do funil. A escala do tenant-alvo é de
// centenas; se um dia estourar, vira contagem agregada por etapa no banco.
const TETO_DE_LEADS = 2000;

type Db = SupabaseClient;

/** O funil que o Kanban abre — `is_default`, a mesma regra da tela (0093). */
async function funilPadrao(db: Db, orgId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await db
    .from("crm_pipelines")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

async function etapasDoFunil(db: Db, orgId: string, pipelineId: string): Promise<EtapaDoFunil[]> {
  const [{ data: stages }, { data: leads }] = await Promise.all([
    db
      .from("crm_stages")
      .select("id, name, position")
      .eq("pipeline_id", pipelineId)
      .order("position"),
    db
      .from("crm_leads")
      .select("stage_id, stage_changed_at")
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .limit(TETO_DE_LEADS),
  ]);

  const tresDiasAtras = Date.now() - 3 * 86_400_000;
  const porEtapa = new Map<string, { leads: number; parados: number }>();
  for (const l of (leads ?? []) as { stage_id: string | null; stage_changed_at: string | null }[]) {
    if (!l.stage_id) continue;
    const acc = porEtapa.get(l.stage_id) ?? { leads: 0, parados: 0 };
    acc.leads += 1;
    const mudou = l.stage_changed_at ? Date.parse(l.stage_changed_at) : NaN;
    if (Number.isFinite(mudou) && mudou < tresDiasAtras) acc.parados += 1;
    porEtapa.set(l.stage_id, acc);
  }

  return ((stages ?? []) as { id: string; name: string }[]).map((s) => {
    const acc = porEtapa.get(s.id) ?? { leads: 0, parados: 0 };
    return { nome: s.name, leads: acc.leads, parados: acc.parados };
  });
}

export function nomeBate(nome: string, ...alvos: string[]): boolean {
  const n = nome.trim().toLowerCase();
  return alvos.some((a) => a.toLowerCase() === n);
}

export async function sinaisDoInbox(db: Db, orgId: string): Promise<SinaisDoInbox> {
  const inicioDeHoje = new Date();
  inicioDeHoje.setHours(0, 0, 0, 0);
  const inicioDeOntem = new Date(inicioDeHoje.getTime() - 86_400_000);

  const [naoLidas, maisVelha, funil, hoje, ontem] = await Promise.all([
    db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .neq("status", "closed")
      .gt("unread_count_for_assignee", 0),
    db
      .from("conversations")
      .select("last_message_at")
      .eq("organization_id", orgId)
      .neq("status", "closed")
      .gt("unread_count_for_assignee", 0)
      .order("last_message_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    funilPadrao(db, orgId),
    db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("direction", "outbound")
      .gte("created_at", inicioDeHoje.toISOString()),
    db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("direction", "outbound")
      .gte("created_at", inicioDeOntem.toISOString())
      .lt("created_at", inicioDeHoje.toISOString()),
  ]);

  let responderam = 0;
  let segundoToque: number | null = null;
  if (funil) {
    const etapas = await etapasDoFunil(db, orgId, funil.id);
    responderam = etapas.find((e) => nomeBate(e.nome, "Respondeu"))?.leads ?? 0;
    const seg = etapas.find((e) =>
      nomeBate(e.nome, "Vídeo enviado", "Video enviado", "Ligação marcada"),
    );
    segundoToque = seg ? seg.leads : null;
  }

  const iso = (maisVelha.data as { last_message_at: string | null } | null)?.last_message_at;
  const maisVelhaHoras = iso ? Math.floor((Date.now() - Date.parse(iso)) / 3_600_000) : 0;

  return {
    naoLidas: naoLidas.count ?? 0,
    maisVelhaHoras,
    responderam,
    segundoToque,
    enviadasHoje: hoje.count ?? 0,
    enviadasOntem: ontem.count ?? 0,
  };
}

export async function sinaisDoKanban(db: Db, orgId: string, agora: Date): Promise<SinaisDoKanban> {
  const funil = await funilPadrao(db, orgId);
  if (!funil) return { funil: "", etapas: [], agora };
  return { funil: funil.name, etapas: await etapasDoFunil(db, orgId, funil.id), agora };
}

export async function sinaisDasConexoes(db: Db, orgId: string): Promise<SinaisDasConexoes> {
  const [{ data: sessoes }, { data: org }] = await Promise.all([
    db
      .from("channel_sessions")
      .select("waha_session_name, display_name, phone_number, status, is_warmup_complete, metadata")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at"),
    db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
  ]);

  const sessaoDoGrupo = (
    (org as { settings?: { grupo_da_reuniao?: { session_name?: string } } } | null)?.settings ?? {}
  ).grupo_da_reuniao?.session_name;

  type Linha = {
    waha_session_name: string;
    display_name: string | null;
    phone_number: string | null;
    status: string;
    is_warmup_complete: boolean | null;
    metadata: Record<string, unknown> | null;
  };

  const numeros: NumeroDeWhatsApp[] = ((sessoes ?? []) as Linha[]).map((s) => ({
    rotulo: s.display_name || s.phone_number || s.waha_session_name,
    status: s.status,
    aiMode: s.metadata?.ai_mode === "copiloto" ? "copiloto" : "atendente",
    aquecido: s.is_warmup_complete === true,
    ehChipDoGrupo: Boolean(sessaoDoGrupo) && s.waha_session_name === sessaoDoGrupo,
  }));

  return { numeros };
}

export async function sinaisDasTarefas(db: Db, orgId: string): Promise<SinaisDasTarefas> {
  const agora = new Date().toISOString();
  const [pendentes, vencidas, maisVelha] = await Promise.all([
    db
      .from("crm_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("resolved_at", null),
    db
      .from("crm_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("resolved_at", null)
      .lt("due_at", agora),
    db
      .from("crm_tasks")
      .select("due_at")
      .eq("organization_id", orgId)
      .is("resolved_at", null)
      .lt("due_at", agora)
      .order("due_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const iso = (maisVelha.data as { due_at: string | null } | null)?.due_at;
  const maisVelhaDias = iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null;

  return {
    pendentes: pendentes.count ?? 0,
    vencidas: vencidas.count ?? 0,
    maisVelhaDias,
  };
}
