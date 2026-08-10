/**
 * GET/POST /api/v1/cron/meeting-reminders — os dois lembretes que fazem o lead
 * aparecer na reunião.
 *
 * Roda de 5 em 5 minutos e olha só as reuniões da janela útil (ver
 * `janelaDeVarredura`): a véspera às 18h e o toque de ~1h antes. Quem decide o
 * QUE deve sair é `lembretesDevidos` — módulo puro, testado sem relógio; esta
 * rota só faz I/O.
 *
 * CARIMBA ANTES DE ENVIAR, e desfaz o carimbo se o envio falhar. A ordem é
 * deliberada: entre "mandar duas vezes" e "não mandar", o erro caro é o
 * primeiro — lembrete duplicado é o tipo de descuido que faz o dono do negócio
 * desconfiar de quem está do outro lado. O rollback devolve a chance de retry
 * no tick seguinte, dentro da tolerância de atraso.
 *
 * ZERO LLM: o texto é montado em código (lib/agendamento/mensagens.ts). Os
 * agentes da NEXO seguem sem versão publicada e isto tem de funcionar assim
 * mesmo — a mesma escolha feita no bom-dia do plano de 60 dias.
 *
 * Auth: mesmo contrato dos demais crons (Bearer INTERNAL_CRON_SECRET |
 * INTERNAL_SECRET, fail-closed).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  janelaDeVarredura,
  lembretesDevidos,
  lerReuniao,
  type Lembrete,
  type Reuniao,
} from "@/lib/agendamento/reuniao";
import { enviarTexto } from "@/lib/agendamento/envio";
import { TEXTO_DO_LEMBRETE } from "@/lib/agendamento/mensagens";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto de leads por tick. Folgadíssimo para a operação real; evita varredura infinita. */
const LIMITE_POR_TICK = 200;

interface LinhaDeLead {
  id: string;
  organization_id: string;
  contact_id: string | null;
  title: string | null;
  custom_fields: unknown;
  contacts: { name: string | null; display_name: string | null } | null;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const now = new Date();
  const janela = janelaDeVarredura(now);
  const admin = createAdminClient();

  // O filtro por `->>em` é comparação de TEXTO, e funciona porque todo `em` é
  // gravado com `toISOString()` (UTC, largura fixa, Z no fim) — nessa forma a
  // ordem lexicográfica é a ordem cronológica. Gravar hora local aqui
  // quebraria a janela em silêncio; é a razão de `Reuniao.em` ser ISO UTC e a
  // hora civil viver em campos separados.
  const { data, error } = await admin
    .from("crm_leads")
    .select("id, organization_id, contact_id, title, custom_fields, contacts:contact_id(name, display_name)")
    .not("custom_fields->reuniao", "is", null)
    .gte("custom_fields->reuniao->>em", janela.de)
    .lte("custom_fields->reuniao->>em", janela.ate)
    .limit(LIMITE_POR_TICK);

  if (error) {
    logger.error("[meeting-reminders] varredura falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao varrer reuniões.", 500, { requestId });
  }

  const linhas = (data ?? []) as unknown as LinhaDeLead[];
  let enviados = 0;
  let falhados = 0;
  let semNada = 0;

  for (const linha of linhas) {
    const reuniao = lerReuniao(linha.custom_fields);
    if (!reuniao) {
      semNada++;
      continue;
    }
    const devidos = lembretesDevidos(reuniao, now);
    if (devidos.length === 0) {
      semNada++;
      continue;
    }

    const contato = Array.isArray(linha.contacts) ? linha.contacts[0] : linha.contacts;
    const nomeDoContato = contato?.display_name ?? contato?.name ?? null;

    for (const lembrete of devidos) {
      const marcou = await carimbar(admin, linha, reuniao, lembrete, now.toISOString());
      if (!marcou) {
        falhados++;
        continue;
      }

      const corpo = TEXTO_DO_LEMBRETE[lembrete](reuniao, {
        nomeDoContato,
        negocio: linha.title,
      });

      const envio = await enviarTexto(admin, {
        organizationId: linha.organization_id,
        contactId: linha.contact_id,
        corpo,
        metadata: {
          meeting_lead_id: linha.id,
          meeting_message: lembrete,
          meeting_at: reuniao.em,
        },
        origem: `cron:meeting-reminders:${lembrete}`,
        requestId,
      });

      if (envio.ok) {
        enviados++;
      } else {
        falhados++;
        // Devolve a chance de tentar no próximo tick. Sem isto, uma sessão WAHA
        // fora do ar por 10 minutos comeria o lembrete inteiro.
        await carimbar(admin, linha, reuniao, lembrete, null);
        logger.warn("[meeting-reminders] lembrete não saiu", {
          leadId: linha.id,
          lembrete,
          motivo: envio.motivo,
          requestId,
        });
      }
    }
  }

  void audit({
    action: "meetings.reminders_run",
    organizationId: null,
    bypassedRls: true,
    metadata: {
      leads_varridos: linhas.length,
      enviados,
      falhados,
      sem_lembrete: semNada,
    },
    requestId,
  });

  return ok(
    { leads_varridos: linhas.length, enviados, falhados, sem_lembrete: semNada },
    { requestId },
  );
}

/**
 * Escreve (ou apaga) o carimbo de um lembrete dentro de
 * `custom_fields.reuniao.avisos`. Mantém o objeto em memória em sincronia para
 * o segundo lembrete do mesmo lead no mesmo tick não apagar o primeiro.
 */
async function carimbar(
  admin: ReturnType<typeof createAdminClient>,
  linha: LinhaDeLead,
  reuniao: Reuniao,
  lembrete: Lembrete,
  quando: string | null,
): Promise<boolean> {
  const avisos = { ...(reuniao.avisos ?? {}) };
  if (quando) avisos[lembrete] = quando;
  else delete avisos[lembrete];

  const campos =
    linha.custom_fields && typeof linha.custom_fields === "object" && !Array.isArray(linha.custom_fields)
      ? (linha.custom_fields as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("crm_leads")
    .update({ custom_fields: { ...campos, reuniao: { ...reuniao, avisos } } })
    .eq("id", linha.id)
    .eq("organization_id", linha.organization_id);

  if (error) {
    logger.error("[meeting-reminders] carimbo falhou", {
      leadId: linha.id,
      lembrete,
      error: error.message,
    });
    return false;
  }
  reuniao.avisos = avisos;
  return true;
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
