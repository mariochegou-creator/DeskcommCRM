/**
 * Gravação de "O que o cliente contou" no negócio do funil.
 *
 * Dois chamadores, um caminho: o cron do resumo diário (varre todo mundo às 7h)
 * e a rota do botão "Atualizar agora" (uma conversa, na hora, antes da reunião).
 * Duas cópias divergiriam no ponto mais chato de depurar — qual negócio recebeu
 * o fato quando o contato tem mais de um.
 *
 * Fica separado de `fatos-do-cliente` porque aquele é puro (roda no navegador
 * também) e este toca o banco.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

import {
  extractFatos,
  fatosIguais,
  FATOS_KEY,
  mesclarFatos,
  serializarFatos,
  type FatosDoCliente,
} from "@/lib/leads/fatos-do-cliente";

type Admin = ReturnType<typeof createAdminClient>;

export interface FatosNovos {
  decisor: string | null;
  falaComDecisor: boolean | null;
  fatos: string[];
}

export type ResultadoDaGravacao =
  | { status: "gravado"; leadId: string; fatos: FatosDoCliente }
  | { status: "sem_negocio" }
  | { status: "sem_mudanca"; leadId: string; fatos: FatosDoCliente };

/**
 * Qual negócio é "o desta pessoa".
 *
 * DUAS PORTAS, a mesma decisão da rota de crm-summary: ser o contato de ORIGEM
 * (`crm_leads.contact_id`) ou ter entrado pelo cartão (`crm_lead_links`,
 * migration 0103). Olhar só a primeira faz a conversa com o sócio de uma
 * empresa não achar negócio nenhum — e o fato mais valioso da conversa cair no
 * chão calado.
 *
 * Empate resolve pelo mais recentemente mexido, que é o mesmo critério com que
 * o painel do inbox escolhe qual negócio mostrar por padrão. O dossiê e a tela
 * falando do mesmo negócio importa mais do que qual dos dois é "o certo".
 */
async function acharLead(
  admin: Admin,
  orgId: string,
  contactId: string,
): Promise<string | null> {
  const { data: links } = await admin
    .from("crm_lead_links")
    .select("lead_id")
    .eq("organization_id", orgId)
    .eq("target_kind", "contact")
    .eq("target_id", contactId);
  const idsVinculados = [...new Set((links ?? []).map((l) => (l as { lead_id: string }).lead_id))];

  const porOrigem = await admin
    .from("crm_leads")
    .select("id, updated_at")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(1);

  const candidatos = [...((porOrigem.data ?? []) as Array<{ id: string; updated_at: string }>)];

  if (idsVinculados.length > 0) {
    const porLink = await admin
      .from("crm_leads")
      .select("id, updated_at")
      .eq("organization_id", orgId)
      .in("id", idsVinculados)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1);
    candidatos.push(...((porLink.data ?? []) as Array<{ id: string; updated_at: string }>));
  }

  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return candidatos[0]!.id;
}

/**
 * Lê o que já se sabia do negócio deste contato. O painel precisa disto ANTES
 * da chamada de LLM, para mandar os fatos conhecidos no prompt e o modelo não
 * repetir com outras palavras o que já está na lista.
 */
export async function lerFatosDoContato(
  admin: Admin,
  orgId: string,
  contactId: string,
): Promise<{ leadId: string; fatos: FatosDoCliente } | null> {
  const leadId = await acharLead(admin, orgId, contactId);
  if (!leadId) return null;

  const { data } = await admin
    .from("crm_leads")
    .select("custom_fields")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();

  return { leadId, fatos: extractFatos((data as { custom_fields: unknown } | null)?.custom_fields) };
}

/**
 * Junta o que a varredura achou com o que já estava guardado e grava.
 *
 * Read-modify-write de propósito, sem lock: o campo é escrito por um cron de
 * madrugada e por um clique manual, e a chance de colisão é remota. Se
 * colidirem, o pior caso é uma varredura perder um fato que a outra acabou de
 * acrescentar — e ele volta na próxima. Travar a linha do negócio para isso
 * seria pagar caro por um empate que não machuca.
 *
 * `sem_mudanca` existe para o caso comum: a maior parte das conversas do dia
 * não revela nada novo, e um UPDATE por conversa por dia só para reescrever o
 * carimbo enche o `updated_at` do funil — que é justamente o campo por onde o
 * painel decide qual negócio mostrar.
 */
export async function gravarFatosDoContato(
  admin: Admin,
  orgId: string,
  contactId: string,
  novos: FatosNovos,
  agora: Date,
): Promise<ResultadoDaGravacao> {
  const atual = await lerFatosDoContato(admin, orgId, contactId);
  if (!atual) return { status: "sem_negocio" };

  const mesclado = mesclarFatos(atual.fatos, novos, agora.toISOString());
  if (fatosIguais(atual.fatos, mesclado)) {
    return { status: "sem_mudanca", leadId: atual.leadId, fatos: atual.fatos };
  }

  const { data: linha } = await admin
    .from("crm_leads")
    .select("custom_fields")
    .eq("organization_id", orgId)
    .eq("id", atual.leadId)
    .maybeSingle();

  const camposAtuais = (linha as { custom_fields: unknown } | null)?.custom_fields;
  const base =
    camposAtuais && typeof camposAtuais === "object" && !Array.isArray(camposAtuais)
      ? (camposAtuais as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("crm_leads")
    .update({ custom_fields: { ...base, [FATOS_KEY]: serializarFatos(mesclado) } })
    .eq("organization_id", orgId)
    .eq("id", atual.leadId);
  if (error) throw new Error(`fatos: ${error.message}`);

  return { status: "gravado", leadId: atual.leadId, fatos: mesclado };
}
