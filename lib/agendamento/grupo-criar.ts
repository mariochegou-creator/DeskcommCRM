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
import { grupoDaReuniaoSchema } from "@/lib/schemas/settings";
import { getWahaClient } from "@/lib/waha/client";

import { chatIdDeTelefone } from "@/lib/waha/grupo";

import { equipeDaReuniao } from "./equipe";
import { resolverSessao } from "./envio";
import { lerGrupo, nomeDoGrupo, participantesDoGrupo, type GrupoDaReuniao } from "./grupo";

export type MotivoDoGrupo =
  | "sem_contato"
  | "sem_telefone"
  | "sem_sessao"
  | "assistente_indisponivel"
  | "equipe_sem_numero"
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
  /**
   * Instante da reunião, quando há uma marcada — entra no NOME do grupo
   * ("Reunião 26/08 às 14h — …"). Null/ausente = nome sem hora.
   */
  reuniaoEm?: Date | null;
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

  // As settings da org decidem QUEM cria o grupo
  // (`grupo_da_reuniao.session_name`); quem ENTRA nele sai do cadastro
  // (papéis + Perfil — ver `equipe.ts`).
  const { data: orgRow } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", entrada.organizationId)
    .maybeSingle();
  const settingsDaOrg = objeto((orgRow as { settings?: unknown } | null)?.settings);

  const cfgGrupo = grupoDaReuniaoSchema.parse(settingsDaOrg["grupo_da_reuniao"]);
  const escolhida = await sessaoDaAssistente(admin, entrada.organizationId, cfgGrupo.session_name);

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

  // Grupo já existe: garante o espelho no inbox e, com a hora no nome, o
  // ÚNICO toque no WAHA é renomear quando a reunião mudou — sem isso, remarcar
  // deixaria o grupo anunciando a hora velha na lista de conversas do lead.
  // Melhor-esforço: renomear falhando (sessão caída, motor sem o endpoint), o
  // nome antigo fica e nada mais é afetado.
  if (jaGravado) {
    const nomeAlvo = nomeDoGrupo(entrada.negocio, entrada.reuniaoEm);
    let nomeAtual = jaGravado.nome;
    if (entrada.reuniaoEm && nomeAlvo !== jaGravado.nome) {
      const client = getWahaClient();
      if (client) {
        try {
          await client.setGroupSubject(sessao.waha_session_name, jaGravado.chat_id, nomeAlvo);
          nomeAtual = nomeAlvo;
          // O espelho no inbox mostra `metadata.group_name` — atualiza junto,
          // senão a lista de conversas segue com a hora velha.
          if (jaGravado.conversation_id) {
            const { data: conv } = await admin
              .from("conversations")
              .select("metadata")
              .eq("id", jaGravado.conversation_id)
              .maybeSingle();
            const meta = objeto((conv as { metadata?: unknown } | null)?.metadata);
            await admin
              .from("conversations")
              .update({ metadata: { ...meta, group_name: nomeAlvo } })
              .eq("id", jaGravado.conversation_id);
          }
        } catch (err) {
          logger.warn("[grupo] renomear para a hora nova falhou — nome antigo fica", {
            leadId: entrada.leadId,
            error: err instanceof Error ? err.message : String(err),
            requestId: entrada.requestId,
          });
        }
      }
    }

    const conversationId =
      jaGravado.conversation_id ??
      (await espelharNoInbox(admin, {
        organizationId: entrada.organizationId,
        contactId: entrada.contactId,
        sessionId,
        chatId: jaGravado.chat_id,
        nome: nomeAtual,
        leadId: entrada.leadId,
      }));

    const grupo = { ...jaGravado, nome: nomeAtual, conversation_id: conversationId };
    if (conversationId !== jaGravado.conversation_id || nomeAtual !== jaGravado.nome) {
      await gravar(admin, entrada, camposAtuais, grupo);
    }
    return { ok: true, grupo, jaExistia: true };
  }

  if (!telefoneDoLead) return { ok: false, motivo: "sem_telefone" };

  // A TRAVA do grupo novo (24/08/2026, pedido do Mario depois de dois grupos
  // nascerem errados): ou o grupo nasce COMPLETO — assistente criando, closer,
  // SDR e lead dentro, todos pelos números CADASTRADOS — ou não nasce, e a tela
  // diz o que faltou. O degradê antigo ("grupo pelo número errado é melhor que
  // reunião sem grupo") produzia exatamente o grupo que ele proibiu: sem a
  // assistente, com número velho do time, e ninguém percebia. A reunião nunca
  // se perde aqui: sem grupo, a confirmação volta a sair no privado.
  if (!escolhida) return { ok: false, motivo: "assistente_indisponivel" };

  const time = await equipeDaReuniao(admin, entrada.organizationId);
  if (!time.ok) {
    logger.warn("[grupo] time incompleto no cadastro — grupo não criado", {
      leadId: entrada.leadId,
      faltando: time.faltando,
      requestId: entrada.requestId,
    });
    return { ok: false, motivo: "equipe_sem_numero", detalhe: time.faltando.join("; ") };
  }

  const client = getWahaClient();
  if (!client) return { ok: false, motivo: "waha_desligado" };

  const participantes = participantesDoGrupo({
    telefoneDoLead,
    telefonesDaEquipe: time.equipe.numeros,
    telefoneDaSessao: sessao.phone_number,
  });

  const nome = nomeDoGrupo(entrada.negocio, entrada.reuniaoEm);

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

  // A capa do grupo, em duas fontes na ordem: a imagem FIXA da org
  // (`grupo_da_reuniao.capa`, escolha do Mario em 22/08 — a mesma capa em todo
  // grupo novo, independente do chip) e, sem ela, a foto de perfil da PRÓPRIA
  // conexão que criou — a do NexoOS, que carrega a marca da Nexo. A primeira
  // versão usava a foto do LEAD e o Mario corrigiu na hora (21/08): o grupo é
  // a Nexo recebendo o cliente, a cara dele tem que ser a da Nexo.
  // Melhor-esforço por inteiro: bucket sem a imagem, chip sem foto ou motor
  // sem o endpoint, o grupo segue com a capa padrão e nada disso pode derrubar
  // a criação que já deu certo.
  try {
    let foto: string | null = null;
    if (cfgGrupo.capa) {
      // URL assinada curta, só pro WAHA baixar — o mesmo desenho do envio de mídia.
      const { data: signed } = await admin.storage
        .from("whatsapp-media")
        .createSignedUrl(cfgGrupo.capa, 600);
      foto = signed?.signedUrl ?? null;
    }
    if (!foto) {
      const chatIdDaSessao = chatIdDeTelefone(sessao.phone_number);
      foto = chatIdDaSessao
        ? await client.getProfilePictureUrl(sessao.waha_session_name, chatIdDaSessao)
        : null;
    }
    if (foto) await client.setGroupPicture(sessao.waha_session_name, criado.chatId, foto);
  } catch (err) {
    logger.warn("[grupo] capa com a marca da Nexo falhou — grupo segue sem", {
      leadId: entrada.leadId,
      error: err instanceof Error ? err.message : String(err),
      requestId: entrada.requestId,
    });
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
 * Devolve null em três casos: nada configurado, nome que não existe mais, e
 * sessão fora do ar. Para grupo NOVO, null significa NÃO CRIAR (a trava de
 * 24/08/2026 — grupo sem a assistente dentro foi exatamente o que o Mario
 * proibiu). Para grupo que JÁ existe, o chamador ainda cai na conexão que fala
 * com o lead: renomear e espelhar um grupo velho não pode parar porque o chip
 * da assistente caiu.
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
