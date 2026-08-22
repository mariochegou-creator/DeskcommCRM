/**
 * POST /api/v1/leads/[id]/meeting/grupo — criar o grupo do WhatsApp à mão.
 *
 * A porta principal é a tela de marcar reunião, que cria o grupo junto. Esta
 * existe para os casos em que aquela não serve, e eles são comuns:
 *  - reunião marcada ANTES desta feature existir (o card já tem hora e não tem
 *    grupo — remarcar só para ganhar o grupo mandaria uma confirmação nova);
 *  - o grupo falhou na hora (WAHA fora do ar) e agora voltou;
 *  - alguém desmarcou a caixinha e se arrependeu.
 *
 * IDEMPOTENTE: grupo que já existe é reaproveitado, não duplicado (a garantia é
 * de `garantirGrupoDaReuniao`).
 *
 * NÃO MANDA A ABERTURA quando o grupo já existia. Um grupo criado semana
 * passada que de repente recebe "sua reunião ficou marcada para…" parece
 * sistema quebrado — e a confirmação daquela reunião já saiu.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { enviarAberturaDoGrupo } from "@/lib/agendamento/abertura-grupo";
import { automacaoDesligada } from "@/lib/agendamento/envio";
import { garantirGrupoDaReuniao } from "@/lib/agendamento/grupo-criar";
import { lerReuniao } from "@/lib/agendamento/reuniao";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

  const { data: lead, error: selErr } = await supabase
    .from("crm_leads")
    .select("id, organization_id, contact_id, title, custom_fields")
    .eq("id", leadId)
    .maybeSingle();

  if (selErr) return fail("internal_error", selErr.message, 500, { requestId });
  if (!lead) return fail("not_found", "Lead não encontrado.", 404, { requestId });

  if (await automacaoDesligada(createAdminClient(), lead.organization_id)) {
    return fail(
      "conflict",
      "As mensagens automáticas estão desligadas. Criar o grupo aparece no WhatsApp do cliente na hora — religue antes.",
      409,
      { requestId },
    );
  }

  const admin = createAdminClient();
  const reuniaoDoCard = lerReuniao(lead.custom_fields);
  const resultado = await garantirGrupoDaReuniao(admin, {
    organizationId: lead.organization_id,
    leadId,
    negocio: lead.title,
    // Card com reunião marcada ganha a hora no nome; sem reunião, nome simples.
    reuniaoEm: reuniaoDoCard ? new Date(reuniaoDoCard.em) : null,
    contactId: lead.contact_id,
    criadoPor: user.id,
    requestId,
  });

  if (!resultado.ok) {
    return ok(
      { grupo: { criado: false as const, motivo: resultado.motivo } },
      { requestId },
    );
  }

  const { grupo, jaExistia } = resultado;

  // A abertura só sai em grupo NOVO e com reunião marcada — ver o cabeçalho.
  const reuniao = reuniaoDoCard;
  let aberturaEnviada = false;
  if (!jaExistia && reuniao && grupo.conversation_id) {
    const { data: contato } = lead.contact_id
      ? await admin
          .from("contacts")
          .select("name, display_name")
          .eq("id", lead.contact_id)
          .maybeSingle()
      : { data: null };
    const c = contato as { name: string | null; display_name: string | null } | null;

    const envio = await enviarAberturaDoGrupo(admin, {
      organizationId: lead.organization_id,
      conversationId: grupo.conversation_id,
      reuniao,
      ctx: {
        nomeDoContato: c?.display_name ?? c?.name ?? null,
        negocio: lead.title,
        quemConduz: user.full_name,
      },
      leadId,
      origem: "crm:meeting-group-open-manual",
      requestId,
    });
    aberturaEnviada = envio.ok;
    if (!envio.ok) {
      logger.warn("[grupo] abertura não saiu no grupo recém-criado", {
        leadId,
        motivo: envio.motivo,
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
    reason: jaExistia
      ? `Grupo "${grupo.nome}" já existia — nada foi criado.`
      : `Grupo "${grupo.nome}" criado no WhatsApp${
          aberturaEnviada ? " e a mensagem de abertura saiu" : ""
        }${
          (grupo.faltaram?.length ?? 0) > 0
            ? `. ATENÇÃO: ${grupo.faltaram!.length} participante(s) não entraram`
            : ""
        }.`,
    payload: { grupo: grupo.nome, chat_id: grupo.chat_id, ja_existia: jaExistia },
  });
  if (!atividade.ok) {
    logger.warn("[grupo] atividade não registrada", {
      leadId,
      error: atividade.error,
      requestId,
    });
  }

  await audit({
    action: "lead.meeting_group_created",
    actorUserId: user.id,
    organizationId: lead.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: { chat_id: grupo.chat_id, ja_existia: jaExistia, abertura: aberturaEnviada },
  });

  return ok(
    {
      grupo: {
        criado: true as const,
        nome: grupo.nome,
        jaExistia,
        faltaram: grupo.faltaram ?? [],
      },
      abertura_enviada: aberturaEnviada,
    },
    { requestId },
  );
}
