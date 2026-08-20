/**
 * Criar o grupo da reunião no WhatsApp e espelhá-lo no inbox.
 *
 * IDEMPOTENTE por desenho. Este caminho é chamado de três lugares (a rota que
 * marca a reunião, o botão manual do card, e uma remarcação que reaproveita o
 * grupo), e criar duas vezes não é um bug reversível: o dono do negócio fica
 * com dois grupos iguais no celular e o CRM só sabe do último. Por isso a
 * primeira coisa que se faz é ler `custom_fields.grupo` — havendo endereço, o
 * trabalho vira só garantir o espelho no inbox.
 *
 * NUNCA LANÇA. Devolve o motivo. Quem chama está no meio de marcar uma reunião
 * que JÁ foi gravada — derrubar aquela chamada porque o WhatsApp recusou o
 * grupo perderia o agendamento inteiro por causa do enfeite.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { grupoDaReuniaoSchema, sixtyDayBriefSchema } from "@/lib/schemas/settings";
import { getWahaClient } from "@/lib/waha/client";

import { resolverSessao } from "./envio";
import { lerGrupo, nomeDoGrupo, participantesDoGrupo, type GrupoDaReuniao } from "./grupo";

export type MotivoDoGrupo =
  | "sem_contato"
  | "sem_telefone"
  | "sem_sessao"
  | "waha_desligado"
  | "falhou";

export type ResultadoDoGrupo =
  | { ok: true; grupo: GrupoDaReuniao; jaExistia: boolean }
  | { ok: false; motivo: MotivoDoGrupo; detalhe?: string };

export interface EntradaDoGrupo {
  organizationId: string;
  leadId: string;
  /** Título do card — vira o nome do grupo. */
  negocio: string | null | undefined;
  contactId: string | null;
  criadoPor?: string | null;
  requestId: string;
}

/**
 * Garante UM grupo para este negócio. Devolve o que ficou gravado.
 */
export async function garantirGrupoDaReuniao(
  admin: SupabaseClient,
  entrada: EntradaDoGrupo,
): Promise<ResultadoDoGrupo> {
  const { data: leadRow } = await admin
    .from("crm_leads")
    .select("custom_fields")
    .eq("id", entrada.leadId)
    .eq("organization_id", entrada.organizationId)
    .maybeSingle();

  const camposAtuais = objeto((leadRow as { custom_fields?: unknown } | null)?.custom_fields);
  const jaGravado = lerGrupo(camposAtuais);

  if (!entrada.contactId) return { ok: false, motivo: "sem_contato" };

  const { data: contatoRow } = await admin
    .from("contacts")
    .select("phone_number")
    .eq("id", entrada.contactId)
    .eq("organization_id", entrada.organizationId)
    .maybeSingle();
  const telefoneDoLead = (contatoRow as { phone_number: string | null } | null)?.phone_number ?? null;

  // As settings da org saem numa leitura só: decidem QUEM cria o grupo
  // (`grupo_da_reuniao.session_name`) e QUEM entra nele
  // (`sixty_day_brief.recipients`).
  const { data: orgRow } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", entrada.organizationId)
    .maybeSingle();
  const settingsDaOrg = objeto((orgRow as { settings?: unknown } | null)?.settings);

  const escolhida = await sessaoDaAssistente(
    admin,
    entrada.organizationId,
    grupoDaReuniaoSchema.parse(settingsDaOrg["grupo_da_reuniao"]).session_name,
  );

  const sessionId =
    escolhida?.id ??
    (await resolverSessao(admin, entrada.organizationId, entrada.contactId));
  if (!sessionId) return { ok: false, motivo: "sem_sessao" };

  let sessao = escolhida?.sessao ?? null;
  if (!sessao) {
    const { data: sessaoRow } = await admin
      .from("channel_sessions")
      .select("waha_session_name, phone_number")
      .eq("id", sessionId)
      .maybeSingle();
    sessao = sessaoRow as { waha_session_name: string; phone_number: string | null } | null;
  }
  if (!sessao) return { ok: false, motivo: "sem_sessao" };

  // Grupo já existe: só falta (talvez) o espelho no inbox. Não se chama o WAHA.
  if (jaGravado) {
    const conversationId =
      jaGravado.conversation_id ??
      (await espelharNoInbox(admin, {
        organizationId: entrada.organizationId,
        contactId: entrada.contactId,
        sessionId,
        chatId: jaGravado.chat_id,
        nome: jaGravado.nome,
        leadId: entrada.leadId,
      }));

    const grupo = { ...jaGravado, conversation_id: conversationId };
    if (conversationId !== jaGravado.conversation_id) {
      await gravar(admin, entrada, camposAtuais, grupo);
    }
    return { ok: true, grupo, jaExistia: true };
  }

  if (!telefoneDoLead) return { ok: false, motivo: "sem_telefone" };

  const client = getWahaClient();
  if (!client) return { ok: false, motivo: "waha_desligado" };

  // O time sai da MESMA lista do bom-dia (`sixty_day_brief.recipients`) — a
  // decisão é a mesma do aviso de 30 min no cron: telefone do time é dado de
  // tenant e uma segunda lista divergiria na primeira troca de chip.
  const cfg = sixtyDayBriefSchema.parse(settingsDaOrg["sixty_day_brief"]);

  const participantes = participantesDoGrupo({
    telefoneDoLead,
    telefonesDaEquipe: cfg.recipients.map((r) => r.phone),
    telefoneDaSessao: sessao.phone_number,
  });

  const nome = nomeDoGrupo(entrada.negocio);

  let criado: { chatId: string; faltaram: string[] };
  try {
    criado = await client.createGroup(sessao.waha_session_name, nome, participantes);
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[grupo] WhatsApp recusou a criação", {
      leadId: entrada.leadId,
      participantes: participantes.length,
      error: detalhe,
      requestId: entrada.requestId,
    });
    return { ok: false, motivo: "falhou", detalhe };
  }

  const conversationId = await espelharNoInbox(admin, {
    organizationId: entrada.organizationId,
    contactId: entrada.contactId,
    sessionId,
    chatId: criado.chatId,
    nome,
    leadId: entrada.leadId,
  });

  const grupo: GrupoDaReuniao = {
    chat_id: criado.chatId,
    nome,
    conversation_id: conversationId,
    criado_em: new Date().toISOString(),
    criado_por: entrada.criadoPor ?? null,
    participantes,
    faltaram: criado.faltaram,
  };

  const gravou = await gravar(admin, entrada, camposAtuais, grupo);
  if (!gravou) {
    // O grupo EXISTE no WhatsApp e o CRM não sabe. Não é "falhou": esconder o
    // endereço aqui faria a próxima chamada criar um segundo grupo. O log é o
    // que permite colar o `chat_id` no lead à mão.
    logger.error("[grupo] criado no WhatsApp mas NÃO gravado no lead", {
      leadId: entrada.leadId,
      chatId: criado.chatId,
      requestId: entrada.requestId,
    });
  }

  return { ok: true, grupo, jaExistia: false };
}

/**
 * A conversa do inbox que espelha o grupo.
 *
 * É o que faz o grupo aparecer no CRM em vez de existir só no celular. Sem ela
 * nada do grupo entra: a ingestão descarta mensagem de grupo desconhecido (ver
 * `lib/waha/ingest.ts`) e não haveria para onde mandar os lembretes.
 *
 * `contact_id` é o contato do LEAD porque a coluna é NOT NULL e o grupo não tem
 * contato próprio. Quem de fato escreveu cada mensagem fica em
 * `messages.metadata.autor_no_grupo`.
 */
/**
 * A conexão dedicada da assistente, quando o tenant apontou uma.
 *
 * Devolve null — e o chamador cai na conexão que já fala com o lead — em três
 * casos: nada configurado, nome que não existe mais, e sessão fora do ar. O
 * último é o que mais vai acontecer na prática (chip sem bateria, sessão caída)
 * e é justamente onde degradar importa: um grupo criado pelo número errado é um
 * arranhão; reunião sem grupo nenhum é o no-show que tudo isto existe para
 * evitar.
 */
async function sessaoDaAssistente(
  admin: SupabaseClient,
  organizationId: string,
  sessionName: string | null,
): Promise<{ id: string; sessao: { waha_session_name: string; phone_number: string | null } } | null> {
  if (!sessionName) return null;

  const { data } = await admin
    .from("channel_sessions")
    .select("id, waha_session_name, phone_number, status, archived_at")
    .eq("organization_id", organizationId)
    .eq("waha_session_name", sessionName)
    .is("archived_at", null)
    .maybeSingle();

  const linha = data as {
    id: string;
    waha_session_name: string;
    phone_number: string | null;
    status: string;
  } | null;

  if (!linha || linha.status !== "WORKING") {
    logger.warn("[grupo] conexão da assistente indisponível — usando a do lead", {
      organizationId,
      sessionName,
      status: linha?.status ?? "inexistente",
    });
    return null;
  }

  return {
    id: linha.id,
    sessao: { waha_session_name: linha.waha_session_name, phone_number: linha.phone_number },
  };
}

async function espelharNoInbox(
  admin: SupabaseClient,
  args: {
    organizationId: string;
    contactId: string;
    sessionId: string;
    chatId: string;
    nome: string;
    leadId: string;
  },
): Promise<string | null> {
  // SELECT-then-INSERT, não upsert. Upsert com `onConflict` faz UPDATE na linha
  // existente — e os valores que mandaríamos incluem `status: "open"`, que
  // REABRIRIA uma conversa que alguém fechou, e um `metadata` que apagaria o
  // que já estivesse lá. Aqui a conversa que já existe é devolvida intacta.
  const { data: existente } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("group_chat_id", args.chatId)
    .limit(1)
    .maybeSingle();
  if (existente) return (existente as { id: string }).id;

  const { data, error } = await admin
    .from("conversations")
    .insert({
      organization_id: args.organizationId,
      contact_id: args.contactId,
      channel_session_id: args.sessionId,
      channel: "whatsapp",
      status: "open",
      is_group: true,
      group_chat_id: args.chatId,
      metadata: { group_name: args.nome, meeting_lead_id: args.leadId },
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = outra chamada criou entre o select e o insert. O vencedor serve —
    // mesma corrida tratada em `lib/agendamento/contato.ts`.
    if ((error as { code?: string }).code === "23505") {
      const { data: vencedor } = await admin
        .from("conversations")
        .select("id")
        .eq("organization_id", args.organizationId)
        .eq("group_chat_id", args.chatId)
        .limit(1)
        .maybeSingle();
      return (vencedor as { id: string } | null)?.id ?? null;
    }
    logger.error("[grupo] espelho no inbox falhou", {
      leadId: args.leadId,
      chatId: args.chatId,
      error: error.message,
    });
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/** Grava `custom_fields.grupo` preservando o resto (inclusive `reuniao`). */
async function gravar(
  admin: SupabaseClient,
  entrada: EntradaDoGrupo,
  camposAtuais: Record<string, unknown>,
  grupo: GrupoDaReuniao,
): Promise<boolean> {
  const { error } = await admin
    .from("crm_leads")
    .update({ custom_fields: { ...camposAtuais, grupo } })
    .eq("id", entrada.leadId)
    .eq("organization_id", entrada.organizationId);
  return !error;
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
