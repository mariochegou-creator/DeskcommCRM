/**
 * Grava o checklist da coluna quando o card entra nela.
 *
 * Mora no SERVIDOR, junto do move, e não no board: o card muda de coluna por
 * quatro caminhos (arrasto, menu, bulk, MCP) e um checklist criado no clique
 * só existiria no primeiro deles. Aqui ele nasce na mesma requisição que moveu
 * o card — quem move, move com as tarefas.
 *
 * **Nunca derruba o move.** O card já mudou de coluna quando esta função roda;
 * uma falha ao criar tarefa vira log e zero, jamais exceção para quem arrastou.
 * A regra é a mesma da timeline (`activity-emitter`): o registro não pode
 * derrubar a operação que ele descreve.
 *
 * A trava contra duplicata é o TÍTULO já existente no lead, e não um carimbo
 * novo na tabela: arrastar o card para fora e de volta é rotina (o funil não é
 * uma esteira), e cada volta empilharia uma segunda cópia da mesma tarefa. Sem
 * coluna nova, sem migration pendente — ver `modelos-de-etapa.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  modelosDaEtapa,
  tituloDaTarefa,
  type EtapaComNome,
  type PapelDaTarefa,
} from "@/lib/tarefas/modelos-de-etapa";

export interface EntradaDasTarefasDaEtapa {
  organizationId: string;
  leadId: string;
  /** Nome do negócio — entra no título da tarefa. */
  leadTitulo: string | null;
  contactId: string | null;
  etapa: EtapaComNome;
  /**
   * Quem arrastou: fica como quem pediu, e é o dono de reserva.
   *
   * `null` quando quem moveu foi o AGENTE — e aí não há dono de reserva. A
   * tarefa cujo papel não tem pessoa configurada simplesmente não nasce (ver o
   * filtro em `criarTarefasDaEtapa`): inventar um dono poria trabalho no colo de
   * alguém que ninguém escolheu, e `assigned_to_user_id` é NOT NULL de propósito
   * — tarefa sem dono é tarefa que ninguém faz.
   */
  autorUserId: string | null;
  agora: Date;
}

export interface ResultadoDasTarefasDaEtapa {
  criadas: number;
  /** As chaves dos modelos que viraram linha — vai para a auditoria. */
  chaves: string[];
}

const NADA: ResultadoDasTarefasDaEtapa = { criadas: 0, chaves: [] };

/**
 * Papel → pessoa, de `organizations.settings.papeis`.
 *
 * Cada id é conferido contra a lista de membros VIVOS da organização antes de
 * virar dono. Sem essa conferência, um id velho na configuração (alguém que
 * saiu do time) criaria tarefa que ninguém desta org consegue ver nem resolver
 * — trabalho perdido sem erro nenhum na tela. É a mesma guarda que a rota
 * POST /api/v1/tasks faz para o dono escolhido à mão.
 */
async function lerPapeis(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Partial<Record<PapelDaTarefa, string>>> {
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return {};

  const bruto = (data.settings as Record<string, unknown> | null)?.["papeis"];
  if (!bruto || typeof bruto !== "object") return {};

  const candidatos: Partial<Record<PapelDaTarefa, string>> = {};
  for (const papel of ["closer", "sdr"] as const) {
    const valor = (bruto as Record<string, unknown>)[papel];
    if (typeof valor === "string" && valor.length > 0) candidatos[papel] = valor;
  }
  const ids = [...new Set(Object.values(candidatos))];
  if (ids.length === 0) return {};

  const { data: membros } = await supabase
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .in("user_id", ids)
    .is("revoked_at", null);

  const vivos = new Set((membros ?? []).map((m) => m.user_id as string));
  const papeis: Partial<Record<PapelDaTarefa, string>> = {};
  for (const [papel, id] of Object.entries(candidatos)) {
    if (id && vivos.has(id)) papeis[papel as PapelDaTarefa] = id;
  }
  return papeis;
}

/**
 * A conversa do contato — para a tarefa aparecer no relógio do inbox e no aviso
 * de abertura do lead, que leem por `conversation_id`.
 *
 * A mais recente quando há várias (o contato pode ter falado por dois números):
 * é nela que a pessoa está lendo a última mensagem, então é nela que o aviso
 * tem de aparecer.
 */
async function conversaDoContato(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string | null,
): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function criarTarefasDaEtapa(
  supabase: SupabaseClient,
  entrada: EntradaDasTarefasDaEtapa,
): Promise<ResultadoDasTarefasDaEtapa> {
  const modelos = modelosDaEtapa(entrada.etapa);
  if (modelos.length === 0) return NADA;

  const titulos = new Map(modelos.map((m) => [m.chave, tituloDaTarefa(m, entrada.leadTitulo)]));

  const { data: existentes, error: erroLeitura } = await supabase
    .from("crm_tasks")
    .select("title")
    .eq("lead_id", entrada.leadId);
  // Leitura falhou ⇒ não dá para saber se já existe. Criar às cegas duplicaria;
  // não criar apenas adia para o próximo arrasto.
  if (erroLeitura) return NADA;

  const jaTem = new Set((existentes ?? []).map((t) => t.title as string));
  const faltando = modelos.filter((m) => !jaTem.has(titulos.get(m.chave) ?? ""));
  if (faltando.length === 0) return NADA;

  const [papeis, conversationId] = await Promise.all([
    lerPapeis(supabase, entrada.organizationId),
    conversaDoContato(supabase, entrada.organizationId, entrada.contactId),
  ]);

  // ⚠️ O FILTRO É O QUE DEIXA O AGENTE MOVER O CARD SEM QUEBRAR O CHECKLIST.
  //
  // `assigned_to_user_id` é NOT NULL. Quando quem move é o agente não existe
  // dono de reserva, então um papel sem pessoa configurada produziria `null` —
  // e um `null` numa das linhas derruba o INSERT INTEIRO, levando junto as
  // tarefas que TINHAM dono. Descartar só a linha órfã é a diferença entre
  // "faltou uma tarefa porque falta configurar o papel" e "o checklist inteiro
  // sumiu, sem erro em lugar nenhum".
  //
  // No arrasto humano nada muda: `autorUserId` está sempre preenchido, então o
  // filtro nunca descarta nada.
  const comDono = faltando
    .map((m) => ({ modelo: m, dono: papeis[m.papel] ?? entrada.autorUserId }))
    .filter((x): x is { modelo: (typeof faltando)[number]; dono: string } => x.dono !== null);
  if (comDono.length === 0) return NADA;

  const linhas = comDono.map(({ modelo: m, dono }) => ({
    organization_id: entrada.organizationId,
    title: titulos.get(m.chave) ?? m.oQue,
    kind: m.kind,
    due_at: m.prazo(entrada.agora).toISOString(),
    assigned_to_user_id: dono,
    created_by_user_id: entrada.autorUserId,
    lead_id: entrada.leadId,
    contact_id: entrada.contactId,
    conversation_id: conversationId,
  }));

  const { data, error } = await supabase.from("crm_tasks").insert(linhas).select("id");
  if (error) return NADA;

  return { criadas: data?.length ?? 0, chaves: comDono.map(({ modelo }) => modelo.chave) };
}
