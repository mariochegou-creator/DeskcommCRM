/**
 * GET|POST /api/v1/cron/broadcast-worker — o motor do disparador (0108).
 *
 * Roda a cada minuto e goteja. Um tick reivindica poucos destinatários, manda
 * com intervalo, e sai antes do timeout do curl. Um público de 300 leva ~40
 * minutos — e a lentidão é a feature: quem toma banimento é o chip, que é o
 * ativo mais caro da operação.
 *
 * ORDEM DO TICK, e por que cada passo está antes do seguinte:
 *
 *  1. PROMOVER agendadas cuja hora chegou.
 *  2. RECOLHER leases vencidas (o tick anterior morreu no meio). Antes de
 *     devolver alguém à fila, procura a mensagem em
 *     `messages.metadata->>'broadcast_recipient_id'`: se ela existe, o envio
 *     ACONTECEU e só o carimbo se perdeu. Sem esta consulta, todo tick morto
 *     viraria mensagem repetida no WhatsApp do lead — a anatomia exata do
 *     acidente de 10/08/2026, quando 38 leads viraram 9.225 alertas.
 *  3. CLAIM atômico (`fn_claim_due_broadcast_recipients`, SKIP LOCKED). Dois
 *     ticks sobrepostos nunca pegam o mesmo destinatário.
 *  4. Por destinatário: guardas → sessão → pacing → spinning → mídia → envio.
 *  5. FECHAR campanha sem pendências.
 *
 * O QUE ESTE WORKER NÃO FAZ: chamar modelo nenhum. O texto é o que o operador
 * escreveu, variado por spintax. A org roda sem versão de agente publicada, e
 * falta de crédito de LLM foi o combustível do acidente citado acima — um
 * disparo que depende de modelo é um disparo que morre no dia do boleto.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { resolverSessao } from "@/lib/agendamento/envio";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { BROADCAST_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { decidePacing } from "@/lib/agent-engine/pacing/engine";
import { decideSpinning } from "@/lib/agent-engine/spinning/engine";
import {
  carregarConfigDoNumero,
  carregarEstadoDoNumero,
  carregarJanelaDeCopies,
  registrarEnvio,
  type ConfigDoNumero,
} from "@/lib/broadcasts/pacing-db";
import { motivoParaPular } from "@/lib/broadcasts/guards";
import { disparosDesligados } from "@/lib/broadcasts/interruptor";
import { expandirSpintax, primeiroNome } from "@/lib/broadcasts/spintax";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SendMessageInput } from "@/lib/schemas";
import type { PacingState } from "@/lib/agent-engine/pacing/engine";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BUCKET = "whatsapp-media";

interface Campanha {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  body_template: string | null;
  media_storage_path: string | null;
  media_mime: string | null;
  media_type: string | null;
  daily_cap: number | null;
  send_as_user_id: string;
  channel_session_id: string | null;
}

interface Destinatario {
  id: string;
  organization_id: string;
  broadcast_id: string;
  contact_id: string;
  lead_id: string | null;
  attempts: number;
}

const CAMPANHA_COLS =
  "id, organization_id, name, status, body_template, media_storage_path, media_mime, media_type, daily_cap, send_as_user_id, channel_session_id";

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const informado = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (aceitos.length === 0 || !informado || !aceitos.includes(informado)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const inicioDoTick = Date.now();
  const admin = createAdminClient();

  const placar = {
    promovidas: 0,
    recolhidos: 0,
    recuperados: 0,
    enviados: 0,
    pulados: 0,
    falhados: 0,
    adiados: 0,
    campanhas_pausadas: 0,
    campanhas_concluidas: 0,
  };

  // --- 1. Agendadas cuja hora chegou -----------------------------------------
  const { data: promovidas } = await admin
    .from("broadcasts")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .select("id");
  placar.promovidas = (promovidas ?? []).length;

  // --- 2. Leases vencidas ----------------------------------------------------
  placar.recolhidos = await recolherLeasesVencidas(admin, placar);

  // --- 3. Claim --------------------------------------------------------------
  const { data: reivindicados, error: claimErr } = await admin.rpc(
    "fn_claim_due_broadcast_recipients",
    { p_limit: BROADCAST_DEFAULTS.sendsPerTick, p_lease_seconds: BROADCAST_DEFAULTS.leaseSeconds },
  );

  if (claimErr) {
    logger.error("[disparador] claim falhou", { error: claimErr.message, requestId });
    return fail("internal_error", "Falha ao reivindicar destinatários.", 500, { requestId });
  }

  const fila = (reivindicados ?? []) as Destinatario[];

  // --- 4. Envio --------------------------------------------------------------
  // Caches por TICK (nunca por processo): interruptor e knobs são de banco e
  // têm de valer no minuto em que mudam — guardar no módulo obrigaria a
  // reiniciar a VPS para religar, que é o oposto do que um interruptor serve.
  const campanhas = new Map<string, Campanha>();
  const desligadoPorOrg = new Map<string, boolean>();
  const configPorSessao = new Map<string, ConfigDoNumero>();
  const estadoPorSessao = new Map<string, PacingState>();
  const pausadas = new Set<string>();

  for (const dest of fila) {
    if (Date.now() - inicioDoTick > BROADCAST_DEFAULTS.tickBudgetMs) {
      // Orçamento estourado: devolve o resto à fila sem gastar tentativa. O
      // próximo tick pega em 1 minuto.
      await desclaimar(admin, dest.id);
      placar.adiados += 1;
      continue;
    }

    if (pausadas.has(dest.broadcast_id)) {
      await desclaimar(admin, dest.id);
      placar.adiados += 1;
      continue;
    }

    // -- campanha
    let campanha = campanhas.get(dest.broadcast_id);
    if (!campanha) {
      const { data } = await admin
        .from("broadcasts")
        .select(CAMPANHA_COLS)
        .eq("id", dest.broadcast_id)
        .maybeSingle();
      campanha = (data as Campanha | null) ?? undefined;
      if (campanha) campanhas.set(dest.broadcast_id, campanha);
    }
    // Pausada/cancelada entre o claim e agora (o operador clicou no meio).
    if (!campanha || campanha.status !== "running") {
      await desclaimar(admin, dest.id);
      pausadas.add(dest.broadcast_id);
      placar.adiados += 1;
      continue;
    }

    // -- interruptor da org
    let desligado = desligadoPorOrg.get(dest.organization_id);
    if (desligado === undefined) {
      desligado = await disparosDesligados(admin, dest.organization_id);
      desligadoPorOrg.set(dest.organization_id, desligado);
    }
    if (desligado) {
      await desclaimar(admin, dest.id);
      await pausarCampanha(admin, campanha, "interruptor_da_org");
      pausadas.add(campanha.id);
      placar.campanhas_pausadas += 1;
      continue;
    }

    // -- guardas do contato (recarregados: entre a ativação e agora ele pode
    //    ter mandado "PARAR")
    const { data: contatoRaw } = await admin
      .from("contacts")
      .select(
        "id, name, display_name, phone_number, wa_identity, is_blocked, is_anonymized, is_merged_into",
      )
      .eq("id", dest.contact_id)
      .eq("organization_id", dest.organization_id)
      .maybeSingle();

    const contato = contatoRaw as {
      id: string;
      name: string | null;
      display_name: string | null;
      phone_number: string | null;
      wa_identity: string | null;
      is_blocked: boolean | null;
      is_anonymized: boolean | null;
      is_merged_into: string | null;
    } | null;

    if (!contato) {
      await marcarPulo(admin, dest.id, "sem_telefone");
      placar.pulados += 1;
      continue;
    }
    const motivo = motivoParaPular(contato);
    if (motivo) {
      await marcarPulo(admin, dest.id, motivo);
      placar.pulados += 1;
      continue;
    }

    // -- sessão de saída
    const sessionId = await resolverSessao(
      admin,
      dest.organization_id,
      contato.id,
      campanha.channel_session_id,
    );
    if (!sessionId) {
      // Sem número WORKING: PAUSA a campanha em vez de enfileirar `queued`.
      // Deixar o handler enfileirar despejaria tudo de uma vez na reconexão —
      // exatamente o formato do acidente que este arquivo tenta não repetir.
      await desclaimar(admin, dest.id);
      await pausarCampanha(admin, campanha, "sessao_caiu");
      pausadas.add(campanha.id);
      placar.campanhas_pausadas += 1;
      continue;
    }

    // -- pacing (mesmo ledger da IA: o teto do chip é compartilhado)
    let cfg = configPorSessao.get(sessionId);
    if (!cfg) {
      cfg = await carregarConfigDoNumero(admin, dest.organization_id, sessionId);
      configPorSessao.set(sessionId, cfg);
    }
    let estado = estadoPorSessao.get(sessionId);
    if (!estado) {
      estado = await carregarEstadoDoNumero(admin, dest.organization_id, sessionId, {
        now: new Date(),
        timezone: cfg.knobs.timezone,
        numberActivatedAt: cfg.numberActivatedAt,
      });
      estadoPorSessao.set(sessionId, estado);
    }

    const tetoDoCRM =
      campanha.daily_cap === null
        ? cfg.crmDailyLimit
        : Math.min(campanha.daily_cap, cfg.crmDailyLimit ?? Number.MAX_SAFE_INTEGER);

    const decisao = decidePacing({
      now: new Date(),
      knobs: cfg.knobs,
      state: estado,
      crmDailyLimit: tetoDoCRM,
    });

    if (!decisao.allow) {
      // Fora da janela ou teto batido: devolve à fila SEM gastar tentativa. Não
      // pausa a campanha — amanhã de manhã ela anda sozinha.
      await desclaimar(admin, dest.id);
      placar.adiados += 1;
      continue;
    }

    // -- o texto deste destinatário
    const temAudio = campanha.media_type === "audio";
    const corpo = campanha.body_template?.trim()
      ? expandirSpintax(campanha.body_template, {
          nome: primeiroNome(contato.display_name ?? contato.name),
        })
      : null;
    // PTT não tem legenda (sendVoice ignora caption): num disparo de áudio o
    // texto não é enviado. A tela avisa isso antes de ativar.
    const corpoParaEnvio = temAudio ? null : corpo;

    // -- spinning (só quando há texto saindo)
    if (corpoParaEnvio) {
      const janela = await carregarJanelaDeCopies(
        admin,
        dest.organization_id,
        sessionId,
        cfg.spinning.windowSize,
      );
      const veredito = decideSpinning({
        candidate: corpoParaEnvio,
        window: janela,
        knobs: cfg.spinning,
      });
      if (!veredito.allow) {
        await desclaimar(admin, dest.id);
        await pausarCampanha(admin, campanha, "copy_repetida");
        pausadas.add(campanha.id);
        placar.campanhas_pausadas += 1;
        logger.warn("[disparador] campanha pausada pelo gate de spinning", {
          broadcastId: campanha.id,
          matchCount: veredito.matchCount,
          requestId,
        });
        continue;
      }
    }

    // -- espera do ritmo (o gap de campanha manda no throttle de conversa)
    const espera = Math.max(decisao.waitMs, BROADCAST_DEFAULTS.gapMs);
    await dormir(espera);

    // -- conversa
    let conversationId: string;
    try {
      conversationId = await ensureConversation(
        admin,
        dest.organization_id,
        contato.id,
        sessionId,
      );
    } catch (err) {
      await marcarFalha(admin, dest, `conversa_nao_abriu: ${textoDoErro(err)}`);
      placar.falhados += 1;
      continue;
    }

    // -- mídia: copia da biblioteca da campanha para dentro da conversa
    let mediaPath: string | null = null;
    if (campanha.media_storage_path) {
      const ext = campanha.media_storage_path.split(".").pop()?.toLowerCase() || "bin";
      mediaPath = `${dest.organization_id}/${conversationId}/out-${randomUUID()}.${ext}`;
      const { error: copyErr } = await admin.storage
        .from(BUCKET)
        .copy(campanha.media_storage_path, mediaPath);
      if (copyErr) {
        await marcarFalha(admin, dest, `copia_da_midia_falhou: ${copyErr.message}`);
        placar.falhados += 1;
        continue;
      }
    }

    // -- ENVIO. Ator `user`: sem isto a mensagem sairia etiquetada como "IA"
    //    (sendMessageHandler deriva sent_via do tipo do ator).
    let mensagem: { id: string; status: string } | null = null;
    try {
      mensagem = (await sendMessageHandler(
        admin,
        {
          organization_id: dest.organization_id,
          actor: { type: "user", id: campanha.send_as_user_id },
          requestId,
        },
        {
          conversation_id: conversationId,
          type: (campanha.media_type ?? "text") as SendMessageInput["type"],
          ...(corpoParaEnvio ? { body: corpoParaEnvio } : {}),
          ...(mediaPath
            ? { media_storage_path: mediaPath, media_mime: campanha.media_mime ?? undefined }
            : {}),
          metadata: {
            origem: "disparador",
            broadcast_id: campanha.id,
            // A chave que o reaper procura para saber se o envio aconteceu.
            broadcast_recipient_id: dest.id,
            ...(dest.lead_id ? { lead_id: dest.lead_id } : {}),
          },
        } as SendMessageInput,
      )) as unknown as { id: string; status: string };
    } catch (err) {
      await marcarFalha(admin, dest, textoDoErro(err));
      placar.falhados += 1;
      continue;
    }

    // O handler NÃO lança quando o WAHA recusa — grava `failed` e devolve.
    if (mensagem.status === "failed") {
      await marcarFalha(admin, dest, "waha_failed", mensagem.id, conversationId);
      placar.falhados += 1;
      continue;
    }

    const agora = new Date();
    await admin
      .from("broadcast_recipients")
      .update({
        status: "sent",
        sent_at: agora.toISOString(),
        message_id: mensagem.id,
        conversation_id: conversationId,
        claimed_until: null,
        last_error: null,
      })
      .eq("id", dest.id);

    // Contabilidade do anti-ban: o MESMO ledger da IA.
    await registrarEnvio(admin, dest.organization_id, sessionId, corpoParaEnvio, agora);
    estado.lastSentAt = agora;
    estado.sentToday += 1;
    placar.enviados += 1;

    // A campanha aparece na vida do lead — sem isto o dossiê mostraria uma
    // mensagem saindo do nada.
    if (dest.lead_id) {
      void emitLeadActivity(admin, {
        organizationId: dest.organization_id,
        leadId: dest.lead_id,
        contactId: contato.id,
        type: "note",
        sourceModule: "disparador",
        sourceId: campanha.id,
        actor: { type: "user", id: campanha.send_as_user_id },
        reason: `Recebeu o disparo "${campanha.name}".`,
        payload: {
          broadcast_id: campanha.id,
          conversation_id: conversationId,
          message_id: mensagem.id,
        },
      });
    }
  }

  // --- 5. Campanhas sem pendência viram concluídas ---------------------------
  placar.campanhas_concluidas = await concluirCampanhasVazias(admin, campanhas);

  void audit({
    action: "broadcast.tick",
    organizationId: null,
    requestId,
    bypassedRls: true,
    metadata: { ...placar, ms: Date.now() - inicioDoTick },
  });

  return ok(placar, { requestId });
}

// ---------------------------------------------------------------------------

function textoDoErro(err: unknown): string {
  const t = err instanceof Error ? err.message : String(err);
  return t.slice(0, 400);
}

async function desclaimar(admin: SupabaseClient, recipientId: string): Promise<void> {
  await admin
    .from("broadcast_recipients")
    .update({ status: "pending", claimed_until: null })
    .eq("id", recipientId);
}

async function marcarPulo(
  admin: SupabaseClient,
  recipientId: string,
  motivo: string,
): Promise<void> {
  await admin
    .from("broadcast_recipients")
    .update({ status: "skipped", skip_reason: motivo, claimed_until: null })
    .eq("id", recipientId);
}

/**
 * Falha com retry: volta para a fila até `maxAttempts`, depois é terminal.
 * Nunca retry infinito — foi assim que 38 leads viraram 9.225 alertas.
 */
async function marcarFalha(
  admin: SupabaseClient,
  dest: Destinatario,
  erro: string,
  messageId?: string,
  conversationId?: string,
): Promise<void> {
  const tentativas = dest.attempts + 1;
  const acabou = tentativas >= BROADCAST_DEFAULTS.maxAttempts;
  await admin
    .from("broadcast_recipients")
    .update({
      status: acabou ? "failed" : "pending",
      attempts: tentativas,
      last_error: erro,
      claimed_until: null,
      ...(messageId ? { message_id: messageId } : {}),
      ...(conversationId ? { conversation_id: conversationId } : {}),
    })
    .eq("id", dest.id);
}

async function pausarCampanha(
  admin: SupabaseClient,
  campanha: Campanha,
  motivo: string,
): Promise<void> {
  await admin
    .from("broadcasts")
    .update({ status: "paused", pause_reason: motivo })
    .eq("id", campanha.id)
    .eq("status", "running");
  campanha.status = "paused";
}

/**
 * Recolhe o que ficou preso em `sending` com a lease vencida.
 *
 * O passo que impede a mensagem repetida: procura a mensagem pelo id do
 * destinatário ANTES de decidir. Achou = o envio saiu e só o carimbo se perdeu.
 */
async function recolherLeasesVencidas(
  admin: SupabaseClient,
  placar: { recuperados: number },
): Promise<number> {
  const { data } = await admin
    .from("broadcast_recipients")
    .select("id, organization_id, attempts")
    .eq("status", "sending")
    .lt("claimed_until", new Date().toISOString())
    .limit(50);

  const presos = (data ?? []) as { id: string; organization_id: string; attempts: number }[];
  for (const preso of presos) {
    const { data: msg } = await admin
      .from("messages")
      .select("id, conversation_id, status, sent_at")
      .eq("organization_id", preso.organization_id)
      .eq("metadata->>broadcast_recipient_id", preso.id)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const m = msg as {
      id: string;
      conversation_id: string;
      status: string;
      sent_at: string | null;
    } | null;

    if (m && m.status !== "failed") {
      await admin
        .from("broadcast_recipients")
        .update({
          status: "sent",
          sent_at: m.sent_at ?? new Date().toISOString(),
          message_id: m.id,
          conversation_id: m.conversation_id,
          claimed_until: null,
        })
        .eq("id", preso.id);
      placar.recuperados += 1;
      continue;
    }

    const tentativas = preso.attempts + 1;
    await admin
      .from("broadcast_recipients")
      .update({
        status: tentativas >= BROADCAST_DEFAULTS.maxAttempts ? "failed" : "pending",
        attempts: tentativas,
        last_error: "lease_vencida",
        claimed_until: null,
      })
      .eq("id", preso.id);
  }
  return presos.length;
}

/** Campanha tocada neste tick que não tem mais nada pendente vira `done`. */
async function concluirCampanhasVazias(
  admin: SupabaseClient,
  campanhas: Map<string, Campanha>,
): Promise<number> {
  let concluidas = 0;
  for (const campanha of campanhas.values()) {
    if (campanha.status !== "running") continue;
    const { count } = await admin
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", campanha.id)
      .in("status", ["pending", "sending"]);
    if ((count ?? 0) > 0) continue;

    await admin
      .from("broadcasts")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", campanha.id)
      .eq("status", "running");
    concluidas += 1;
  }
  return concluidas;
}

export const GET = handle;
export const POST = handle;
