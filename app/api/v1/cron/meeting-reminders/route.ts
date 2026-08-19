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
 * INTERRUPTOR: org com `ai_dispatch_mode = 'external'` não recebe lembrete
 * nenhum (ver `automacaoDesligada`). É a mesma chave que cala a IA nas
 * respostas — quem desliga a IA espera silêncio total, inclusive daqui.
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
  lembreteEquipeDevido,
  lembretesDevidos,
  lerReuniao,
  type Lembrete,
  type Reuniao,
} from "@/lib/agendamento/reuniao";
import { garantirContato } from "@/lib/agendamento/contato";
import { automacaoDesligada, enviarNoGrupo, enviarTexto } from "@/lib/agendamento/envio";
import { lerGrupo } from "@/lib/agendamento/grupo";
import {
  mensagemDaEquipe,
  TEXTO_DO_LEMBRETE,
  TEXTO_DO_LEMBRETE_NO_GRUPO,
} from "@/lib/agendamento/mensagens";
import { resolveUserNames } from "@/lib/mcp/tools/_users";
import { sixtyDayBriefSchema, type SixtyDayBriefConfig } from "@/lib/schemas/settings";
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
  let desligados = 0;
  let equipeEnviados = 0;

  // Cache por TICK, não por processo: o interruptor é de banco e tem de valer no
  // minuto em que muda. Guardar no módulo obrigaria a reiniciar a VPS para
  // religar os lembretes — e o ponto de um interruptor é não precisar disso.
  const interruptorPorOrg = new Map<string, boolean>();
  const estaDesligada = async (organizationId: string): Promise<boolean> => {
    const jaSabe = interruptorPorOrg.get(organizationId);
    if (jaSabe !== undefined) return jaSabe;
    const valor = await automacaoDesligada(admin, organizationId);
    interruptorPorOrg.set(organizationId, valor);
    return valor;
  };

  // Config do bom-dia por org, lida uma vez por tick: os MESMOS destinatários
  // do brief das 8h30 recebem o aviso interno de 30 min — telefone do time é
  // dado de tenant e já mora em `sixty_day_brief`; uma segunda lista divergiria
  // na primeira troca de chip.
  const configPorOrg = new Map<string, SixtyDayBriefConfig>();
  const configDaOrg = async (organizationId: string): Promise<SixtyDayBriefConfig> => {
    const jaSabe = configPorOrg.get(organizationId);
    if (jaSabe) return jaSabe;
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    const cfg = sixtyDayBriefSchema.parse(
      ((org as { settings?: unknown } | null)?.settings as Record<string, unknown> | null)?.[
        "sixty_day_brief"
      ],
    );
    configPorOrg.set(organizationId, cfg);
    return cfg;
  };

  // Nome de quem marcou, por TICK. Só é consultado para lead com grupo (o texto
  // do privado não cita ninguém), e o mesmo closer se repete em quase todos os
  // leads da varredura — sem o cache seriam N idas ao auth para o mesmo nome.
  const nomePorUsuario = new Map<string, string | null>();

  for (const linha of linhas) {
    const reuniao = lerReuniao(linha.custom_fields);
    if (!reuniao) {
      semNada++;
      continue;
    }

    const contato = Array.isArray(linha.contacts) ? linha.contacts[0] : linha.contacts;
    const nomeDoContato = contato?.display_name ?? contato?.name ?? null;

    // Aviso interno ANTES do interruptor: `ai_dispatch_mode = 'external'` cala
    // o que sai pro LEAD; o cutucão de 30 min vai pro time e tem de sair mesmo
    // com a automação de atendimento desligada.
    if (lembreteEquipeDevido(reuniao, now)) {
      const resultado = await avisarEquipe(admin, linha, reuniao, nomeDoContato, {
        configDaOrg,
        requestId,
      });
      equipeEnviados += resultado.enviados;
      falhados += resultado.falhados;
    }

    // Antes do carimbo, de propósito: lead pulado por interruptor desligado não
    // pode ficar marcado como avisado. Se o Mario religar dentro da janela, o
    // lembrete ainda sai.
    if (await estaDesligada(linha.organization_id)) {
      desligados++;
      continue;
    }

    const devidos = lembretesDevidos(reuniao, now);
    if (devidos.length === 0) {
      semNada++;
      continue;
    }

    // Tem grupo? Então é lá que o lembrete cai — e SÓ lá. Mandar no grupo e no
    // privado entrega a mesma frase duas vezes e desfaz o efeito de "eles são
    // organizados" que o grupo existe para produzir.
    const grupo = lerGrupo(linha.custom_fields);
    const conversaDoGrupo = grupo?.conversation_id ?? null;

    for (const lembrete of devidos) {
      const marcou = await carimbar(admin, linha, reuniao, lembrete, now.toISOString());
      if (!marcou) {
        falhados++;
        continue;
      }

      const contexto = {
        nomeDoContato,
        negocio: linha.title,
        // No grupo quem fala é a assistente, e ela cita o closer em terceira
        // pessoa. O nome vem de quem MARCOU a reunião.
        quemConduz: conversaDoGrupo
          ? ((await nomeDeQuemMarcou(admin, reuniao.criada_por ?? null, nomePorUsuario)) ?? null)
          : null,
      };

      const metadata = {
        meeting_lead_id: linha.id,
        meeting_message: lembrete,
        meeting_at: reuniao.em,
      };

      const envio = conversaDoGrupo
        ? await enviarNoGrupo(admin, {
            organizationId: linha.organization_id,
            conversationId: conversaDoGrupo,
            corpo: TEXTO_DO_LEMBRETE_NO_GRUPO[lembrete](reuniao, contexto),
            metadata,
            origem: `cron:meeting-reminders:${lembrete}:grupo`,
            requestId,
          })
        : await enviarTexto(admin, {
            organizationId: linha.organization_id,
            contactId: linha.contact_id,
            corpo: TEXTO_DO_LEMBRETE[lembrete](reuniao, contexto),
            metadata,
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
          noGrupo: Boolean(conversaDoGrupo),
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
      automacao_desligada: desligados,
      equipe_enviados: equipeEnviados,
    },
    requestId,
  });

  return ok(
    {
      leads_varridos: linhas.length,
      enviados,
      falhados,
      sem_lembrete: semNada,
      automacao_desligada: desligados,
      equipe_enviados: equipeEnviados,
    },
    { requestId },
  );
}

/** O `full_name` de quem marcou a reunião, com cache por tick. */
async function nomeDeQuemMarcou(
  admin: ReturnType<typeof createAdminClient>,
  userId: string | null,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (!userId) return null;
  const jaSabe = cache.get(userId);
  if (jaSabe !== undefined) return jaSabe;
  const nomes = await resolveUserNames(admin, [userId]);
  const nome = nomes.get(userId) ?? null;
  cache.set(userId, nome);
  return nome;
}

/**
 * O aviso de 30 min pro TIME: carimba `avisos.equipe` e manda pra cada
 * destinatário do bom-dia. Sem destinatário configurado, nem carimba — a org
 * que ligar o brief amanhã passa a receber os avisos das reuniões seguintes.
 *
 * O carimbo é UM por reunião (não por pessoa): se mandar pro Mario e falhar
 * pro David, não repete pro Mario no próximo tick. Só quando NINGUÉM recebeu o
 * carimbo é desfeito, pra reunião não ficar sem aviso por uma sessão WAHA fora
 * do ar por 10 minutos.
 */
async function avisarEquipe(
  admin: ReturnType<typeof createAdminClient>,
  linha: LinhaDeLead,
  reuniao: Reuniao,
  nomeDoContato: string | null,
  deps: {
    configDaOrg: (organizationId: string) => Promise<SixtyDayBriefConfig>;
    requestId: string;
  },
): Promise<{ enviados: number; falhados: number }> {
  const cfg = await deps.configDaOrg(linha.organization_id);
  if (cfg.recipients.length === 0) return { enviados: 0, falhados: 0 };

  const marcou = await carimbar(admin, linha, reuniao, "equipe", new Date().toISOString());
  if (!marcou) return { enviados: 0, falhados: 1 };

  const corpo = mensagemDaEquipe(reuniao, { nomeDoContato, negocio: linha.title });
  let enviados = 0;
  let falhados = 0;

  for (const destinatario of cfg.recipients) {
    try {
      const contactId = await garantirContato(
        admin,
        linha.organization_id,
        destinatario.name,
        destinatario.phone,
      );
      const envio = await enviarTexto(admin, {
        organizationId: linha.organization_id,
        contactId,
        corpo,
        metadata: {
          meeting_lead_id: linha.id,
          meeting_message: "equipe",
          meeting_at: reuniao.em,
        },
        origem: "cron:meeting-reminders:equipe",
        requestId: deps.requestId,
      });
      if (envio.ok) enviados++;
      else {
        falhados++;
        logger.warn("[meeting-reminders] aviso interno não saiu", {
          leadId: linha.id,
          motivo: envio.motivo,
          requestId: deps.requestId,
        });
      }
    } catch (err) {
      falhados++;
      logger.warn("[meeting-reminders] aviso interno não saiu", {
        leadId: linha.id,
        motivo: err instanceof Error ? err.message : String(err),
        requestId: deps.requestId,
      });
    }
  }

  if (enviados === 0) {
    await carimbar(admin, linha, reuniao, "equipe", null);
  }
  return { enviados, falhados };
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
  lembrete: Lembrete | "equipe",
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
