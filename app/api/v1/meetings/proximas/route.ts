/**
 * GET /api/v1/meetings/proximas — as reuniões que AINDA VÃO acontecer.
 *
 * A Sala de Reuniões nasceu olhando só para trás: `crm_meetings` guarda a
 * reunião que o copiloto gravou. A reunião MARCADA vive noutro lugar —
 * `crm_leads.custom_fields.reuniao`, escrita pelo agendamento anti no-show — e
 * as duas nunca apareciam na mesma tela. Esta rota é a ponte.
 *
 * DE PROPÓSITO NÃO DEVOLVE CHECKLIST: quem monta é `lib/sala-reunioes/preparo.ts`,
 * no cliente, a partir do `reuniao` cru que vai aqui dentro. Assim a lista e o
 * painel de preparo desenham o MESMO objeto, e um rótulo tipo "sai hoje às 18h"
 * acompanha o relógio de quem está olhando, não o do último fetch.
 *
 * Auth DUAL e admin client com filtro explícito de org — o contrato de toda
 * rota sob /api/v1/meetings (ver lib/sala-reunioes/authz.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { corsPreflight, withCorsHeaders } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/wrappers";
import { lerReuniao } from "@/lib/agendamento/reuniao";
import { authorizeMeetings } from "@/lib/sala-reunioes/authz";
import { proximasReunioesQuerySchema } from "@/lib/schemas/sala-reunioes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const OPTIONS = corsPreflight;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Quanto tempo uma reunião continua na lista depois da hora marcada.
 *
 * Nada carimba o FIM de uma reunião agendada. Sem esta folga, a das 10h sumiria
 * da tela às 10h01 — justamente quando quem entrou atrasado vai procurá-la.
 */
const FOLGA_DEPOIS_MS = 3 * 60 * 60 * 1000;

/** Teto de linhas varridas. A operação real cabe MUITO abaixo disso. */
const LIMITE = 100;

interface LinhaDeLead {
  id: string;
  title: string | null;
  contact_id: string | null;
  custom_fields: unknown;
  contacts: { id: string; name: string | null; display_name: string | null; phone_number: string | null } | null;
  crm_stages: { name: string | null } | null;
}

/** PostgREST devolve a relação como objeto ou array de um — normaliza. */
function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await authorizeMeetings(req, { requestId });
  if (!authz.ok) return withCorsHeaders(authz.response, req);

  const parsed = proximasReunioesQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return withCorsHeaders(
      fail("validation_failed", "Parâmetros inválidos.", 422, {
        requestId,
        details: { issues: parsed.error.issues },
      }),
      req,
    );
  }

  const agora = Date.now();
  const de = new Date(agora - FOLGA_DEPOIS_MS).toISOString();
  const ate = new Date(agora + parsed.data.dias * DIA_MS).toISOString();

  const admin = createAdminClient();
  // O filtro por `->>em` é comparação de TEXTO e só funciona porque todo `em` é
  // gravado com `toISOString()` — UTC, largura fixa, Z no fim. É a mesma
  // premissa do cron de lembretes; quebrar uma quebra as duas.
  const { data, error } = await admin
    .from("crm_leads")
    .select(
      "id, title, contact_id, custom_fields, contacts:contact_id(id, name, display_name, phone_number), crm_stages:stage_id(name)",
    )
    .eq("organization_id", authz.orgId)
    .not("custom_fields->reuniao", "is", null)
    .gte("custom_fields->reuniao->>em", de)
    .lte("custom_fields->reuniao->>em", ate)
    .limit(LIMITE);

  if (error) {
    return withCorsHeaders(
      fail("internal_error", "Falha ao listar as próximas reuniões.", 500, { requestId }),
      req,
    );
  }

  const proximas = ((data ?? []) as unknown as LinhaDeLead[])
    .flatMap((linha) => {
      const reuniao = lerReuniao(linha.custom_fields);
      if (!reuniao) return [];
      const contato = um(linha.contacts);
      const etapa = um(linha.crm_stages);
      return [
        {
          lead_id: linha.id,
          lead_title: linha.title,
          etapa: etapa?.name ?? null,
          contato: contato
            ? {
                id: contato.id,
                nome: contato.display_name ?? contato.name ?? null,
                telefone: contato.phone_number,
              }
            : null,
          reuniao,
        },
      ];
    })
    // A ordenação é aqui e não no banco: ordenar por caminho jsonb no PostgREST
    // é frágil, e o teto de 100 linhas cabe na memória sem pensar duas vezes.
    .sort((a, b) => a.reuniao.em.localeCompare(b.reuniao.em));

  return withCorsHeaders(ok({ proximas }, { requestId }), req);
}
