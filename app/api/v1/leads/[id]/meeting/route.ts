/**
 * POST /api/v1/leads/[id]/meeting — marcar (ou remarcar) a reunião do negócio.
 *
 * É o que fecha o buraco do no-show. Numa chamada:
 *   1. grava o instante da reunião em `crm_leads.custom_fields.reuniao`;
 *   2. cria o evento no Google Agenda (quando a integração está ligada);
 *   3. manda a mensagem de confirmação para o lead, na hora;
 *   4. deixa véspera e toque final agendados para o cron `meeting-reminders`.
 *
 * ORDEM IMPORTA e não é acidente: a reunião é gravada ANTES de falar com o
 * Google e com o WhatsApp. Os dois são rede de terceiro; se qualquer um cair
 * depois de o humano ter marcado na tela, o agendamento continua de pé e os
 * lembretes continuam saindo. O inverso — gravar por último — perderia a
 * reunião inteira por causa de um timeout do Google.
 *
 * Remarcar é o MESMO verbo: o POST sobrescreve `reuniao` e zera `avisos`, de
 * modo que a véspera do horário novo saia mesmo que a do antigo já tenha saído.
 *
 * Os passos 3 e 4 obedecem ao interruptor da org: com a IA calada
 * (`ai_dispatch_mode = 'external'`, ver `automacaoDesligada`) a reunião é
 * gravada e vai pra agenda, mas nenhuma mensagem sai no WhatsApp.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import {
  formatarReuniao,
  instanteDaReuniao,
  lerReuniao,
  ROTULO_DO_TIPO,
  type Reuniao,
  type TipoDeReuniao,
} from "@/lib/agendamento/reuniao";
import {
  automacaoDesligada,
  enviarNoGrupo,
  enviarTexto,
  type ResultadoDoEnvio,
} from "@/lib/agendamento/envio";
import { tipoDeReuniaoDaEtapa } from "@/lib/agendamento/etapa";
import {
  garantirGrupoDaReuniao,
  type MotivoDoGrupo,
} from "@/lib/agendamento/grupo-criar";
import {
  agendaConfigurada,
  criarEventoNaAgenda,
  linkParaAdicionarNaAgenda,
  type ResultadoDoEvento,
} from "@/lib/agendamento/google-calendar";
import { enviarAberturaDoGrupo } from "@/lib/agendamento/abertura-grupo";
import {
  mensagemDeConfirmacao,
  mensagemDeRemarcadaNoGrupo,
} from "@/lib/agendamento/mensagens";
import { agendarReuniaoSchema } from "@/lib/schemas/agendamento";
import { validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Passado não se agenda; 5 min de folga cobrem relógio do cliente fora de sincronia. */
const TOLERANCIA_PASSADO_MS = 5 * 60 * 1000;

/**
 * O que a nota da atividade diz quando a confirmação NÃO saiu por decisão, e
 * não por falha. Os dois casos precisam de frase própria: quem lê o card
 * amanhã tem de saber se o lead foi avisado — "confirmação NÃO enviada
 * (automacao_desligada)" não responde isso pra quem não escreveu o código.
 */
const RECADO_DA_CONFIRMACAO: Record<string, string> = {
  ja_confirmada: " — a confirmação já tinha saído; nada foi reenviado",
  automacao_desligada: " — mensagens automáticas desligadas: avise o lead você mesmo",
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const user = authz.user;

  let input;
  try {
    input = await validateRequest(agendarReuniaoSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const { data: lead, error: selErr } = await supabase
    .from("crm_leads")
    .select("id, organization_id, stage_id, contact_id, title, custom_fields")
    .eq("id", leadId)
    .maybeSingle();

  if (selErr) return fail("internal_error", selErr.message, 500, { requestId });
  if (!lead) return fail("not_found", "Lead não encontrado.", 404, { requestId });

  const quando = instanteDaReuniao(input.data, input.hora);
  if (Number.isNaN(quando.getTime())) {
    return fail("validation_error", "Data ou hora inválida.", 422, { requestId });
  }
  if (quando.getTime() < Date.now() - TOLERANCIA_PASSADO_MS) {
    return fail(
      "validation_error",
      "Essa data e hora já passaram. Escolha um horário futuro.",
      422,
      { requestId },
    );
  }

  // Tipo explícito vence; sem ele, quem sabe é a coluna em que o card está.
  let tipo: TipoDeReuniao = input.tipo ?? "r1";
  if (!input.tipo) {
    const { data: stage } = await supabase
      .from("crm_stages")
      .select("name, slug")
      .eq("id", lead.stage_id)
      .maybeSingle();
    tipo = tipoDeReuniaoDaEtapa((stage ?? {}) as { name?: string; slug?: string }) ?? "r1";
  }

  // Salvar de novo o MESMO instante não é remarcar — é o mesmo agendamento
  // chegando duas vezes: clique repetido, segunda aba, card arrastado de volta
  // pra coluna, retry do navegador. Aconteceu em 11/08/2026, com um minuto de
  // diferença: o lead recebeu a confirmação DUAS vezes, e quem parece
  // desorganizado nessa hora é a Nexo, não o CRM.
  //
  // A tela avisa "salvar aqui remarca", mas o aviso depende de o board já ter
  // recarregado o card — corrida que a rota não pode terceirizar. A garantia
  // mora aqui: mesmo instante preserva carimbos, evento e autoria.
  const anterior = lerReuniao(lead.custom_fields);
  const mesmoInstante = anterior?.em === quando.toISOString();

  const agora = new Date().toISOString();
  const reuniao: Reuniao = {
    tipo,
    em: quando.toISOString(),
    data: input.data,
    hora: input.hora,
    criada_em: mesmoInstante ? (anterior?.criada_em ?? agora) : agora,
    criada_por: mesmoInstante ? (anterior?.criada_por ?? user.id) : user.id,
    // Remarcação DE VERDADE começa sem carimbo: o lembrete do horário NOVO tem
    // que sair. Mesmo instante preserva — zerar aqui faria a véspera que já
    // saiu sair outra vez.
    avisos: mesmoInstante ? (anterior?.avisos ?? {}) : {},
    gcal_event_id: mesmoInstante ? (anterior?.gcal_event_id ?? null) : null,
    gcal_link: mesmoInstante ? (anterior?.gcal_link ?? null) : null,
  };

  // MUTÁVEL de propósito. Todo `update` daqui pra baixo escreve o jsonb INTEIRO
  // (`{ ...camposAtuais, reuniao }`), então qualquer chave que outro passo grave
  // no meio do caminho — e `garantirGrupoDaReuniao` grava `grupo` — seria
  // apagada pelo próximo write se esta cópia local não acompanhasse.
  let camposAtuais: Record<string, unknown> =
    lead.custom_fields && typeof lead.custom_fields === "object" && !Array.isArray(lead.custom_fields)
      ? (lead.custom_fields as Record<string, unknown>)
      : {};

  const { error: updErr } = await supabase
    .from("crm_leads")
    .update({ custom_fields: { ...camposAtuais, reuniao }, updated_at: agora })
    .eq("id", leadId);

  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  // --- daqui pra baixo, nada pode derrubar o agendamento já gravado ---

  const q = formatarReuniao(quando);
  const negocio = lead.title ?? "";
  const tituloDoEvento = `${ROTULO_DO_TIPO[tipo].toUpperCase()} — ${negocio || "negócio sem nome"}`;
  const descricaoDoEvento = [
    `Reunião marcada pelo CRM (${ROTULO_DO_TIPO[tipo]}).`,
    negocio ? `Negócio: ${negocio}` : null,
    `Card: ${new URL(`/app/leads/${leadId}`, req.nextUrl.origin).toString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const admin = createAdminClient();

  const { data: contato } = lead.contact_id
    ? await admin
        .from("contacts")
        .select("name, display_name, email")
        .eq("id", lead.contact_id)
        .eq("organization_id", lead.organization_id)
        .maybeSingle()
    : { data: null };

  const dadosDoContato = contato as {
    name?: string | null;
    display_name?: string | null;
    email?: string | null;
  } | null;

  const nomeDoContato = dadosDoContato?.display_name ?? dadosDoContato?.name ?? null;

  // Quem foi digitado na tela vence; sem ninguém digitado, o e-mail do cadastro
  // assume. A alternativa — exigir o e-mail toda vez — faria quem já cadastrou
  // o contato redigitar o mesmo endereço a cada remarcação, e o convite do
  // Google simplesmente não sairia nas vezes em que ninguém lembrasse.
  const emailDoCadastro = (dadosDoContato?.email ?? "").trim();
  const convidados =
    input.convidados && input.convidados.length > 0
      ? input.convidados
      : emailDoCadastro.length > 0
        ? [emailDoCadastro]
        : undefined;

  const eventoBase = {
    titulo: tituloDoEvento,
    descricao: descricaoDoEvento,
    inicio: quando,
    convidados,
  };

  // Evento já criado para este mesmo instante: reaproveita em vez de abrir um
  // segundo. Duas linhas iguais na agenda do dia confundem tanto quanto duas
  // mensagens no WhatsApp do lead.
  const naAgenda: ResultadoDoEvento = reuniao.gcal_event_id
    ? { ok: true, eventId: reuniao.gcal_event_id, htmlLink: reuniao.gcal_link ?? null }
    : await criarEventoNaAgenda(eventoBase);

  if (naAgenda.ok) {
    reuniao.gcal_event_id = naAgenda.eventId;
    reuniao.gcal_link = naAgenda.htmlLink;
    const { error } = await supabase
      .from("crm_leads")
      .update({ custom_fields: { ...camposAtuais, reuniao } })
      .eq("id", leadId);
    if (error) {
      // O evento existe na agenda; só o ponteiro se perdeu. Não é motivo para
      // devolver erro a quem acabou de marcar — mas some do audit se não logar.
      logger.warn("[meeting] evento criado, ponteiro não gravado", {
        leadId,
        eventId: naAgenda.eventId,
        error: error.message,
        requestId,
      });
    }
  } else if (naAgenda.motivo !== "nao_configurado") {
    logger.warn("[meeting] Google Agenda recusou o evento", {
      leadId,
      motivo: naAgenda.motivo,
      detalhe: naAgenda.detalhe,
      requestId,
    });
  }

  // A confirmação sai por conta própria (a decisão do Mario em 09/08): lembrete
  // que espera alguém apertar "enviar" é lembrete que não sai.
  //
  // Só que "por conta própria" agora obedece ao interruptor da org: com a IA
  // calada (`ai_dispatch_mode = 'external'`) o agendamento é gravado, o evento
  // vai pra agenda e NADA sai no WhatsApp — a tela devolve
  // `confirmacao.motivo = "automacao_desligada"` e quem marcou escreve à mão.
  let envio: ResultadoDoEnvio;

  // O GRUPO. Criado ANTES da confirmação porque é ele que decide para onde ela
  // vai: existindo grupo, a confirmação sai lá e NÃO sai no privado (mandar nos
  // dois dobra a mensagem e queima o efeito — ver `lib/agendamento/grupo.ts`).
  //
  // Nunca derruba o agendamento: a reunião já está gravada, e um WhatsApp que
  // recusou a criação do grupo não pode custar a reunião. Quando falha, a
  // confirmação cai de volta no privado, que é o comportamento de antes.
  const querGrupo = input.criar_grupo !== false;
  const automacaoOff = await automacaoDesligada(admin, lead.organization_id);
  let grupo:
    | { criado: true; nome: string; jaExistia: boolean; faltaram: string[] }
    | { criado: false; motivo: MotivoDoGrupo | "nao_pedido" | "automacao_desligada" };
  let conversaDoGrupo: string | null = null;

  if (!querGrupo) {
    grupo = { criado: false, motivo: "nao_pedido" };
  } else if (automacaoOff) {
    // Criar o grupo é falar com o cliente: aparece no celular dele na hora. O
    // mesmo interruptor que cala as mensagens tem de calar isto.
    grupo = { criado: false, motivo: "automacao_desligada" };
  } else {
    const resultado = await garantirGrupoDaReuniao(admin, {
      organizationId: lead.organization_id,
      leadId,
      negocio,
      // A hora no nome do grupo — e o que faz a remarcação renomear.
      reuniaoEm: quando,
      contactId: lead.contact_id,
      criadoPor: user.id,
      requestId,
    });
    if (resultado.ok) {
      conversaDoGrupo = resultado.grupo.conversation_id;
      camposAtuais = { ...camposAtuais, grupo: resultado.grupo };
      grupo = {
        criado: true,
        nome: resultado.grupo.nome,
        jaExistia: resultado.jaExistia,
        faltaram: resultado.grupo.faltaram ?? [],
      };
    } else {
      grupo = { criado: false, motivo: resultado.motivo };
    }
  }

  if (mesmoInstante && reuniao.avisos?.confirmacao) {
    // Já saiu para este mesmo dia e hora — ver `mesmoInstante`.
    envio = { ok: false, motivo: "ja_confirmada" };
  } else if (automacaoOff) {
    envio = { ok: false, motivo: "automacao_desligada" };
  } else if (conversaDoGrupo) {
    // Grupo NOVO recebe a abertura (com o áudio do Claudio, quando a org o tem
    // configurado); grupo que já existia recebe o texto de remarcação. A rota é
    // a mesma para marcar e remarcar (é o mesmo verbo, por desenho) — sem esta
    // escolha, remarcar mandaria "criei esse grupo" num grupo de duas semanas
    // atrás.
    if (grupo.criado && grupo.jaExistia) {
      envio = await enviarNoGrupo(admin, {
        organizationId: lead.organization_id,
        conversationId: conversaDoGrupo,
        digitando: true,
        corpo: mensagemDeRemarcadaNoGrupo(reuniao, {
          nomeDoContato,
          negocio,
          quemConduz: user.full_name,
        }),
        metadata: { meeting_lead_id: leadId, meeting_message: "confirmacao", meeting_at: reuniao.em },
        origem: "crm:meeting-group-open",
        requestId,
      });
    } else {
      envio = await enviarAberturaDoGrupo(admin, {
        organizationId: lead.organization_id,
        conversationId: conversaDoGrupo,
        reuniao,
        ctx: { nomeDoContato, negocio, quemConduz: user.full_name },
        leadId,
        origem: "crm:meeting-group-open",
        requestId,
      });
    }
  } else {
    const corpo = mensagemDeConfirmacao(reuniao, {
      nomeDoContato,
      negocio,
      // Assina quem marcou. `full_name` já vem do requireRole — buscar de novo
      // seria uma ida ao banco para saber o que a sessão já sabe.
      quemConduz: user.full_name,
    });

    envio = await enviarTexto(admin, {
      organizationId: lead.organization_id,
      contactId: lead.contact_id,
      corpo,
      metadata: { meeting_lead_id: leadId, meeting_message: "confirmacao", meeting_at: reuniao.em },
      origem: "crm:meeting-confirmation",
      requestId,
    });
  }

  // Carimba a confirmação DENTRO do próprio agendamento. É o que deixa o
  // preparo da Sala de Reuniões afirmar "o convite saiu" em vez de supor a
  // partir de `criada_em` — marcar e enviar são dois fatos, e o segundo falha
  // sozinho (WAHA fora do ar). Só carimba quando saiu: carimbo de envio que
  // falhou mente pior do que carimbo nenhum.
  if (envio.ok) {
    reuniao.avisos = { ...(reuniao.avisos ?? {}), confirmacao: new Date().toISOString() };
    const { error: carimboErr } = await supabase
      .from("crm_leads")
      .update({ custom_fields: { ...camposAtuais, reuniao } })
      .eq("id", leadId);
    if (carimboErr) {
      logger.warn("[meeting] confirmação enviada, carimbo não gravado", {
        leadId,
        error: carimboErr.message,
        requestId,
      });
    }
  }

  // O lembrete de QUEM VAI ATENDER, criado sozinho. Os lembretes automáticos
  // são todos do LEAD; do lado de cá havia só dois botões ("ligar 5h/2h antes")
  // que dependiam de alguém clicar depois de salvar — e ninguém clica com o
  // quadro cheio. Não derruba o agendamento se falhar: a reunião já está
  // gravada, e a tarefa continua podendo ser criada à mão.
  let tarefaDeLigar: "criada" | "remarcada" | null = null;
  try {
    tarefaDeLigar = await garantirTarefaDeLigar(supabase, {
      organizationId: lead.organization_id,
      leadId,
      contactId: lead.contact_id,
      negocio,
      reuniaoEm: quando,
      autorUserId: user.id,
    });
  } catch (err) {
    logger.warn("[meeting] tarefa de ligar não criada", {
      leadId,
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: lead.organization_id,
    leadId,
    contactId: lead.contact_id,
    type: "note",
    sourceModule: "crm",
    sourceId: leadId,
    actor: { type: "user", id: user.id },
    reason: `${ROTULO_DO_TIPO[tipo]} marcada para ${q.diaDaSemana} (${q.diaMes}) às ${q.hora}${
      envio.ok
        ? conversaDoGrupo
          ? ` — confirmação enviada no grupo "${grupo.criado ? grupo.nome : ""}"`
          : " — confirmação enviada ao lead"
        : (RECADO_DA_CONFIRMACAO[envio.motivo] ??
          ` — confirmação NÃO enviada (${envio.motivo})`)
    }${
      grupo.criado && grupo.faltaram.length > 0
        ? `. ATENÇÃO: ${grupo.faltaram.length} participante(s) não entraram no grupo (privacidade de grupo)`
        : ""
    }.`,
    payload: {
      reuniao_em: reuniao.em,
      tipo,
      confirmacao_enviada: envio.ok,
      grupo: grupo.criado ? grupo.nome : null,
    },
  });
  if (!atividade.ok) {
    logger.warn("[meeting] atividade não registrada", {
      leadId,
      error: atividade.error,
      requestId,
    });
  }

  await audit({
    action: "lead.meeting_scheduled",
    actorUserId: user.id,
    organizationId: lead.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: {
      tipo,
      em: reuniao.em,
      confirmacao: envio.ok ? "sent" : envio.motivo,
      agenda: naAgenda.ok ? "created" : naAgenda.motivo,
      grupo: grupo.criado ? (grupo.jaExistia ? "reused" : "created") : grupo.motivo,
    },
  });

  return ok(
    {
      reuniao,
      confirmacao: envio.ok
        ? { enviada: true as const }
        : { enviada: false as const, motivo: envio.motivo },
      agenda: naAgenda.ok
        ? { criada: true as const, link: naAgenda.htmlLink, convidados: convidados ?? [] }
        : {
            criada: false as const,
            motivo: naAgenda.motivo,
            /** Sempre presente: é o plano B de um clique. Ver google-calendar.ts. */
            link_manual: linkParaAdicionarNaAgenda(eventoBase),
            configurada: agendaConfigurada(),
          },
      tarefa_de_ligar: tarefaDeLigar,
      grupo,
    },
    { requestId },
  );
}

/** Antecedência da ligação de preparo. Mesma hora do último toque no lead. */
const HORAS_ANTES_DA_LIGACAO = 1;

interface EntradaDaTarefaDeLigar {
  organizationId: string;
  leadId: string;
  contactId: string | null;
  negocio: string;
  reuniaoEm: Date;
  autorUserId: string;
}

/**
 * Garante UMA tarefa "ligar 1h antes" para esta reunião.
 *
 * Remarcar não cria uma segunda: a busca é pelo título (mesma trava de
 * `lib/tarefas/criar-da-etapa.ts`) e o prazo da tarefa existente é movido para
 * a hora nova. Sem isso, remarcar três vezes deixaria três ligações na lista,
 * duas delas para horários que não existem mais — e uma lista com lixo dentro
 * para de ser lida, que é o modo de falha que todo este checklist evita.
 *
 * Devolve `null` quando não há o que criar: reunião daqui a menos de uma hora
 * faria a tarefa nascer já atrasada, e tarefa nascida atrasada é ruído.
 */
async function garantirTarefaDeLigar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entrada: EntradaDaTarefaDeLigar,
): Promise<"criada" | "remarcada" | null> {
  const prazo = new Date(
    entrada.reuniaoEm.getTime() - HORAS_ANTES_DA_LIGACAO * 60 * 60 * 1000,
  );
  if (prazo.getTime() <= Date.now()) return null;

  const titulo = `Ligar 1h antes — ${entrada.negocio || "negócio sem nome"}`;

  const { data: existente, error: erroLeitura } = await supabase
    .from("crm_tasks")
    .select("id")
    .eq("lead_id", entrada.leadId)
    .eq("title", titulo)
    .eq("status", "pending")
    .maybeSingle();

  // Leitura falhou ⇒ não dá para saber se já existe. Criar às cegas duplicaria.
  if (erroLeitura) return null;

  if (existente?.id) {
    const { error } = await supabase
      .from("crm_tasks")
      .update({ due_at: prazo.toISOString() })
      .eq("id", existente.id);
    return error ? null : "remarcada";
  }

  const { error } = await supabase.from("crm_tasks").insert({
    organization_id: entrada.organizationId,
    title: titulo,
    kind: "ligar",
    due_at: prazo.toISOString(),
    assigned_to_user_id: entrada.autorUserId,
    created_by_user_id: entrada.autorUserId,
    lead_id: entrada.leadId,
    contact_id: entrada.contactId,
  });
  return error ? null : "criada";
}
