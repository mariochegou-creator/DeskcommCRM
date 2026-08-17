/**
 * GET /api/v1/leads/horarios?data=YYYY-MM-DD[&lead_id=…] — o que já está
 * ocupado nesse dia.
 *
 * Existe porque o dialog de agendamento oferecia os nove slots sempre, mesmo
 * os que já tinham dono: marcar duas reuniões às 10h de amanhã era um clique,
 * e o CRM não dizia nada. Quem descobre o conflito, nesse arranjo, é o closer
 * — na hora da segunda call.
 *
 * DUAS FONTES, somadas, porque nenhuma sozinha é completa:
 *
 *  - **O CRM** (`crm_leads.custom_fields.reuniao`) sabe de toda reunião marcada
 *    aqui dentro, inclusive as de antes de o Google Agenda ser conectado.
 *  - **O Google** sabe do resto da vida de quem atende — dentista, almoço,
 *    reunião marcada por fora. Nada disso passa pelo CRM.
 *
 * `lead_id` é o lead que está sendo (re)marcado: o compromisso DELE não conta
 * como ocupado, senão remarcar para o mesmo horário seria impossível e a hora
 * atual apareceria riscada na tela de quem só queria confirmá-la.
 *
 * Falha do Google não vira erro da rota: devolve o que o CRM sabe e avisa em
 * `agenda_lida: false`. A tela prefere uma grade parcialmente informada a uma
 * tela morta — mas precisa saber que a informação está parcial.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ocupacoesDaAgenda } from "@/lib/agendamento/google-calendar";
import {
  DURACAO_DA_REUNIAO_MIN,
  instanteDaReuniao,
  lerReuniao,
  slotsOcupados,
  type Ocupacao,
} from "@/lib/agendamento/reuniao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DIA_MS = 24 * 60 * 60 * 1000;

/** Teto de reuniões varridas no dia. Um dia real não chega perto disso. */
const LIMITE = 100;

const querySchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD"),
  lead_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "leads_horarios" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { data, lead_id: leadId } = parsed.data;

  // O dia CIVIL da Bahia, em instantes UTC. A meia-noite daqui não é a meia-noite
  // do servidor, e usar a do servidor deslocaria a janela em três horas.
  const inicioDoDia = instanteDaReuniao(data, "00:00");
  if (Number.isNaN(inicioDoDia.getTime())) {
    return fail("validation_failed", "Data inválida.", 422, { requestId });
  }
  const fimDoDia = new Date(inicioDoDia.getTime() + DIA_MS);

  const admin = createAdminClient();

  // Comparação de TEXTO em `->>em`, que só funciona porque todo `em` é gravado
  // com `toISOString()` (UTC, largura fixa, Z no fim). Mesma premissa do cron de
  // lembretes e da rota `meetings/proximas`; quebrar uma quebra as três.
  const { data: linhas, error } = await admin
    .from("crm_leads")
    .select("id, custom_fields")
    .eq("organization_id", org.orgId)
    .not("custom_fields->reuniao", "is", null)
    .gte("custom_fields->reuniao->>em", inicioDoDia.toISOString())
    .lt("custom_fields->reuniao->>em", fimDoDia.toISOString())
    .limit(LIMITE);

  if (error) {
    return fail("internal_error", "Falha ao ler os horários do dia.", 500, { requestId });
  }

  const ocupacoes: Ocupacao[] = [];
  /** O evento do próprio lead na agenda — para não se declarar ocupado. */
  let eventoDoProprioLead: string | null = null;

  for (const linha of (linhas ?? []) as Array<{ id: string; custom_fields: unknown }>) {
    const reuniao = lerReuniao(linha.custom_fields);
    if (!reuniao) continue;
    if (leadId && linha.id === leadId) {
      eventoDoProprioLead = reuniao.gcal_event_id ?? null;
      continue;
    }
    const inicio = Date.parse(reuniao.em);
    if (Number.isNaN(inicio)) continue;
    ocupacoes.push({
      inicio: reuniao.em,
      fim: new Date(inicio + DURACAO_DA_REUNIAO_MIN * 60_000).toISOString(),
    });
  }

  const daAgenda = await ocupacoesDaAgenda(inicioDoDia, fimDoDia);
  if (daAgenda) {
    for (const o of daAgenda) {
      if (eventoDoProprioLead && o.gcalEventId === eventoDoProprioLead) continue;
      ocupacoes.push(o);
    }
  }

  return ok(
    {
      data,
      ocupados: slotsOcupados(data, ocupacoes),
      /** `false` = a grade só conhece o que o CRM marcou; a agenda não respondeu. */
      agenda_lida: daAgenda !== null,
    },
    { requestId },
  );
}
