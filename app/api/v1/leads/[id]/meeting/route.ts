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
  ROTULO_DO_TIPO,
  type Reuniao,
  type TipoDeReuniao,
} from "@/lib/agendamento/reuniao";
import {
  automacaoDesligada,
  enviarTexto,
  type ResultadoDoEnvio,
} from "@/lib/agendamento/envio";
import { tipoDeReuniaoDaEtapa } from "@/lib/agendamento/etapa";
import {
  agendaConfigurada,
  criarEventoNaAgenda,
  linkParaAdicionarNaAgenda,
} from "@/lib/agendamento/google-calendar";
import { mensagemDeConfirmacao } from "@/lib/agendamento/mensagens";
import { agendarReuniaoSchema } from "@/lib/schemas/agendamento";
import { validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Passado não se agenda; 5 min de folga cobrem relógio do cliente fora de sincronia. */
const TOLERANCIA_PASSADO_MS = 5 * 60 * 1000;

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

  const agora = new Date().toISOString();
  const reuniao: Reuniao = {
    tipo,
    em: quando.toISOString(),
    data: input.data,
    hora: input.hora,
    criada_em: agora,
    criada_por: user.id,
    // Remarcação começa sem carimbo: o lembrete do horário NOVO tem que sair.
    avisos: {},
    gcal_event_id: null,
    gcal_link: null,
  };

  const camposAtuais =
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

  const eventoBase = {
    titulo: tituloDoEvento,
    descricao: descricaoDoEvento,
    inicio: quando,
    convidados: input.convidados,
  };

  const naAgenda = await criarEventoNaAgenda(eventoBase);
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
  const admin = createAdminClient();
  let envio: ResultadoDoEnvio = { ok: false, motivo: "automacao_desligada" };

  if (!(await automacaoDesligada(admin, lead.organization_id))) {
    const { data: contato } = lead.contact_id
      ? await admin
          .from("contacts")
          .select("name, display_name")
          .eq("id", lead.contact_id)
          .eq("organization_id", lead.organization_id)
          .maybeSingle()
      : { data: null };

    const nomeDoContato =
      (contato as { name?: string | null; display_name?: string | null } | null)?.display_name ??
      (contato as { name?: string | null } | null)?.name ??
      null;

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
        ? " — confirmação enviada ao lead"
        : envio.motivo === "automacao_desligada"
          ? " — mensagens automáticas desligadas: avise o lead você mesmo"
          : ` — confirmação NÃO enviada (${envio.motivo})`
    }.`,
    payload: { reuniao_em: reuniao.em, tipo, confirmacao_enviada: envio.ok },
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
    },
  });

  return ok(
    {
      reuniao,
      confirmacao: envio.ok
        ? { enviada: true as const }
        : { enviada: false as const, motivo: envio.motivo },
      agenda: naAgenda.ok
        ? { criada: true as const, link: naAgenda.htmlLink }
        : {
            criada: false as const,
            motivo: naAgenda.motivo,
            /** Sempre presente: é o plano B de um clique. Ver google-calendar.ts. */
            link_manual: linkParaAdicionarNaAgenda(eventoBase),
            configurada: agendaConfigurada(),
          },
    },
    { requestId },
  );
}
