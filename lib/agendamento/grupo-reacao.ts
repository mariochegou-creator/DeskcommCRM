/**
 * A ÚNICA coisa que a automação faz com o que alguém escreve no grupo.
 *
 * O grupo da reunião existe para amarrar compromisso, não para conversar. Tudo
 * que chega nele vai para o inbox e para por aí — a IA de verdade (LLM) nem é
 * chamada, por duas travas independentes (`filters.ignore_groups` no dispatcher
 * e a ausência do `emit_event` em `lib/waha/ingest.ts`).
 *
 * As DUAS exceções: o pedido de remarcar e o "confirmado". A primeira porque o
 * silêncio custa a reunião (o lead escreve "não vou poder", ninguém responde
 * por três horas, e a remarcação vira sumiço); a segunda porque a abertura PEDE
 * o "confirmado" — pedir e não agradecer deixa o compromisso no ar. Nenhuma das
 * duas usa LLM: texto fixo, montado em código.
 *
 * QUATRO TRAVAS, e nenhuma é redundante:
 *  1. só em grupo que o CRM criou (garantido por quem chama);
 *  2. só com a frase certa (`ehPedidoDeRemarcacao`, régua de frase, não palavra);
 *  3. só se a org não estiver com a automação desligada (`ai_dispatch_mode`);
 *  4. UMA VEZ por reunião. O lead que escreve "não vou poder" e emenda "surgiu
 *     um imprevisto" mandaria duas respostas idênticas em dez segundos — que é
 *     exatamente a cara de robô que o grupo existe pra desmentir.
 *
 * NUNCA LANÇA: roda dentro da ingestão do webhook, e derrubar a ingestão faria
 * o WAHA reentregar o evento — a mensagem entraria duplicada no inbox.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { resolveUserNames } from "@/lib/mcp/tools/_users";

import { automacaoDesligada, enviarNoGrupo } from "./envio";
import { ehConfirmacaoDeReuniao, ehPedidoDeRemarcacao, lerGrupo } from "./grupo";
import { mensagemDeConfirmacaoRecebida, mensagemDeRemarcacaoNoGrupo } from "./mensagens";
import { lerReuniao } from "./reuniao";

export interface EntradaDaReacao {
  organizationId: string;
  conversationId: string;
  /** O texto que acabou de chegar. */
  texto: string | null | undefined;
  requestId: string;
}

export type ResultadoDaReacao =
  | { agiu: false; motivo: "nao_e_remarcacao" | "sem_lead" | "ja_respondeu" | "desligada" | "falhou" }
  | { agiu: true; leadId: string; tarefa: boolean };

/** Antecedência da tarefa de remarcar: agora. Quem some, some nas próximas horas. */
const TITULO_DA_TAREFA = (negocio: string) => `Remarcar reunião — ${negocio || "negócio sem nome"}`;

export async function reagirAPedidoDeRemarcacao(
  admin: SupabaseClient,
  entrada: EntradaDaReacao,
): Promise<ResultadoDaReacao> {
  try {
    if (!ehPedidoDeRemarcacao(entrada.texto)) return { agiu: false, motivo: "nao_e_remarcacao" };

    // O lead é achado PELA CONVERSA, não pelo contato: o mesmo contato pode ter
    // mais de um card, e o grupo pertence a um card só.
    const { data: leadRow } = await admin
      .from("crm_leads")
      .select("id, title, contact_id, custom_fields")
      .eq("organization_id", entrada.organizationId)
      .eq("custom_fields->grupo->>conversation_id", entrada.conversationId)
      .limit(1)
      .maybeSingle();

    const lead = leadRow as {
      id: string;
      title: string | null;
      contact_id: string | null;
      custom_fields: unknown;
    } | null;
    if (!lead) return { agiu: false, motivo: "sem_lead" };

    const grupo = lerGrupo(lead.custom_fields);
    if (!grupo?.conversation_id) return { agiu: false, motivo: "sem_lead" };

    const reuniao = lerReuniao(lead.custom_fields);
    // Sem reunião marcada não há o que remarcar — e responder "o Mario te manda
    // dois horários" numa conversa que já aconteceu é pior que ficar quieto.
    if (!reuniao) return { agiu: false, motivo: "sem_lead" };

    if (await automacaoDesligada(admin, entrada.organizationId)) {
      return { agiu: false, motivo: "desligada" };
    }

    // Trava 4: já respondeu sobre ESTA reunião? O carimbo é por instante da
    // reunião, então remarcar de verdade rearma a resposta (a reunião nova pode
    // dar problema também), mas duas frases seguidas sobre a mesma não.
    const jaRespondeu = await respostaJaSaiu(admin, entrada.conversationId, reuniao.em);
    if (jaRespondeu) return { agiu: false, motivo: "ja_respondeu" };

    const { data: contatoRow } = lead.contact_id
      ? await admin
          .from("contacts")
          .select("name, display_name")
          .eq("id", lead.contact_id)
          .maybeSingle()
      : { data: null };
    const contato = contatoRow as { name: string | null; display_name: string | null } | null;

    const dono = await donoDaReuniao(admin, reuniao.criada_por ?? null);

    const envio = await enviarNoGrupo(admin, {
      organizationId: entrada.organizationId,
      conversationId: grupo.conversation_id,
      corpo: mensagemDeRemarcacaoNoGrupo({
        nomeDoContato: contato?.display_name ?? contato?.name ?? null,
        negocio: lead.title,
        quemConduz: dono?.nome ?? null,
      }),
      metadata: {
        meeting_lead_id: lead.id,
        meeting_message: "remarcacao",
        meeting_at: reuniao.em,
      },
      origem: "crm:grupo-remarcacao",
      requestId: entrada.requestId,
    });

    if (!envio.ok) return { agiu: false, motivo: "falhou" };

    // A tarefa é o que impede a promessa de virar mentira. A resposta diz "ele
    // te manda dois horários"; sem tarefa, isso depende de alguém ter lido o
    // grupo na hora certa.
    const tarefa = await criarTarefaDeRemarcar(admin, {
      organizationId: entrada.organizationId,
      leadId: lead.id,
      contactId: lead.contact_id,
      negocio: lead.title ?? "",
      donoUserId: dono?.id ?? null,
    });

    return { agiu: true, leadId: lead.id, tarefa };
  } catch (err) {
    logger.warn("[grupo] reação ao pedido de remarcação falhou", {
      conversationId: entrada.conversationId,
      error: err instanceof Error ? err.message : String(err),
      requestId: entrada.requestId,
    });
    return { agiu: false, motivo: "falhou" };
  }
}

export type ResultadoDoAgradecimento =
  | { agiu: false; motivo: "nao_e_confirmacao" | "sem_lead" | "ja_respondeu" | "desligada" | "falhou" }
  | { agiu: true; leadId: string };

/**
 * O "obrigado" ao confirmado do lead — pedido do Mario em 22/08/2026.
 *
 * A segunda (e última) reação da automação no grupo. As mesmas quatro travas da
 * remarcação, pela mesma razão; a diferença é que aqui não nasce tarefa — o
 * ciclo fecha na própria resposta. NUNCA LANÇA, como tudo que roda na ingestão.
 */
export async function reagirAConfirmacao(
  admin: SupabaseClient,
  entrada: EntradaDaReacao,
): Promise<ResultadoDoAgradecimento> {
  try {
    if (!ehConfirmacaoDeReuniao(entrada.texto)) return { agiu: false, motivo: "nao_e_confirmacao" };

    const { data: leadRow } = await admin
      .from("crm_leads")
      .select("id, title, contact_id, custom_fields")
      .eq("organization_id", entrada.organizationId)
      .eq("custom_fields->grupo->>conversation_id", entrada.conversationId)
      .limit(1)
      .maybeSingle();

    const lead = leadRow as {
      id: string;
      title: string | null;
      contact_id: string | null;
      custom_fields: unknown;
    } | null;
    if (!lead) return { agiu: false, motivo: "sem_lead" };

    const grupo = lerGrupo(lead.custom_fields);
    if (!grupo?.conversation_id) return { agiu: false, motivo: "sem_lead" };

    // Sem reunião marcada não há o que garantir — "horário garantido" sobre
    // reunião nenhuma é a automação inventando compromisso.
    const reuniao = lerReuniao(lead.custom_fields);
    if (!reuniao) return { agiu: false, motivo: "sem_lead" };

    if (await automacaoDesligada(admin, entrada.organizationId)) {
      return { agiu: false, motivo: "desligada" };
    }

    // Uma vez por reunião: o lead que manda "confirmado" e emenda "confirmadíssimo"
    // não pode receber dois obrigados iguais. Remarcar de verdade rearma.
    const jaAgradeceu = await respostaJaSaiu(
      admin,
      entrada.conversationId,
      reuniao.em,
      "confirmacao_agradecida",
    );
    if (jaAgradeceu) return { agiu: false, motivo: "ja_respondeu" };

    const { data: contatoRow } = lead.contact_id
      ? await admin
          .from("contacts")
          .select("name, display_name")
          .eq("id", lead.contact_id)
          .maybeSingle()
      : { data: null };
    const contato = contatoRow as { name: string | null; display_name: string | null } | null;

    const envio = await enviarNoGrupo(admin, {
      organizationId: entrada.organizationId,
      conversationId: grupo.conversation_id,
      corpo: mensagemDeConfirmacaoRecebida({
        nomeDoContato: contato?.display_name ?? contato?.name ?? null,
        negocio: lead.title,
      }),
      metadata: {
        meeting_lead_id: lead.id,
        meeting_message: "confirmacao_agradecida",
        meeting_at: reuniao.em,
      },
      origem: "crm:grupo-confirmacao",
      requestId: entrada.requestId,
    });

    if (!envio.ok) return { agiu: false, motivo: "falhou" };
    return { agiu: true, leadId: lead.id };
  } catch (err) {
    logger.warn("[grupo] agradecimento à confirmação falhou", {
      conversationId: entrada.conversationId,
      error: err instanceof Error ? err.message : String(err),
      requestId: entrada.requestId,
    });
    return { agiu: false, motivo: "falhou" };
  }
}

/** Já saiu esta resposta automática para ESTA reunião nesta conversa? */
async function respostaJaSaiu(
  admin: SupabaseClient,
  conversationId: string,
  reuniaoEm: string,
  tipo: "remarcacao" | "confirmacao_agradecida" = "remarcacao",
): Promise<boolean> {
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("metadata->>meeting_message", tipo)
    .eq("metadata->>meeting_at", reuniaoEm)
    .limit(1)
    .maybeSingle();

  // FAIL-CLOSED: leitura falhou ⇒ assume que já saiu. Entre calar e repetir, a
  // repetição é a que estraga o grupo.
  if (error) return true;
  return Boolean(data);
}

/**
 * Quem marcou a reunião — vira o dono da tarefa e o nome citado no texto.
 *
 * O nome mora em `auth.users.user_metadata.full_name`, não numa tabela de
 * perfil (o repo não tem uma). Falha de lookup devolve o id sem nome: o texto
 * cai em "o time" e a tarefa continua tendo dono, que é o que não pode faltar.
 */
async function donoDaReuniao(
  admin: SupabaseClient,
  userId: string | null,
): Promise<{ id: string; nome: string | null } | null> {
  if (!userId) return null;
  const nomes = await resolveUserNames(admin, [userId]);
  return { id: userId, nome: nomes.get(userId) ?? null };
}

async function criarTarefaDeRemarcar(
  admin: SupabaseClient,
  args: {
    organizationId: string;
    leadId: string;
    contactId: string | null;
    negocio: string;
    donoUserId: string | null;
  },
): Promise<boolean> {
  // `assigned_to_user_id` é NOT NULL (migration 0101, de propósito: tarefa sem
  // dono é trabalho invisível). Sem quem marcou a reunião, não há a quem
  // atribuir — a resposta no grupo já saiu e o pedido está no inbox.
  if (!args.donoUserId) return false;

  const titulo = TITULO_DA_TAREFA(args.negocio);

  // Mesma trava por título das outras tarefas automáticas
  // (`lib/tarefas/criar-da-etapa.ts`): lista com três "Remarcar reunião" iguais
  // para de ser lida.
  const { data: existente, error: erroLeitura } = await admin
    .from("crm_tasks")
    .select("id")
    .eq("lead_id", args.leadId)
    .eq("title", titulo)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (erroLeitura) return false;
  if (existente) return true;

  const { error } = await admin.from("crm_tasks").insert({
    organization_id: args.organizationId,
    title: titulo,
    kind: "ligar",
    // Agora: o lead acabou de dizer que não vem. Prazo "amanhã" é como se perde
    // a remarcação para o concorrente que respondeu no mesmo dia.
    due_at: new Date().toISOString(),
    assigned_to_user_id: args.donoUserId,
    created_by_user_id: args.donoUserId,
    lead_id: args.leadId,
    contact_id: args.contactId,
  });
  return !error;
}
