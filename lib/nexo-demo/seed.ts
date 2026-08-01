/**
 * Semeia e limpa os dados de demonstração da NEXO IA.
 *
 * Usa o client admin (service role) porque cria linhas em várias tabelas
 * tenant-scoped de uma vez. Segue a REGRA CRÍTICA de lib/supabase/admin.ts:
 * o `organization_id` vem SEMPRE do argumento, resolvido pela sessão validada
 * na página que chama — nunca do corpo da requisição.
 *
 * Tudo que é criado leva a marca `nexo-demo`, e é só por ela que a limpeza
 * apaga. Dado real que você cadastrar à mão não é tocado.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { AGENTE, CONVERSA_EXEMPLO, ETAPAS, MARCA_DEMO, NEGOCIOS, PIPELINE } from "./dados";

const AGORA = () => Date.now();
const DIAS = 86_400_000;
const isoAtras = (dias: number) => new Date(AGORA() - dias * DIAS).toISOString();

/** Faixa exibida no card. Respeita o CHECK de coerência do banco. */
function faixa(score: number): "frio" | "morno" | "quente" {
  if (score >= 65) return "quente";
  if (score >= 46) return "morno";
  return "frio";
}

/** Bucket de risco. As janelas espelham o radar do próprio produto. */
function bucketRisco(dias: number): "em_dia" | "em_voo" | "em_risco" | "critico" {
  if (dias >= 21) return "critico";
  if (dias >= 10) return "em_risco";
  if (dias >= 4) return "em_voo";
  return "em_dia";
}

export interface Contagem {
  negocios: number;
  contatos: number;
  conversas: number;
  atividades: number;
}

/** Quanto dado de demonstração existe hoje nesta organização. */
export async function contarDemo(orgId: string): Promise<Contagem> {
  const admin = createAdminClient();
  const conta = async (tabela: string, coluna = "source") => {
    const { count } = await admin
      .from(tabela)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq(coluna, MARCA_DEMO);
    return count ?? 0;
  };

  const [negocios, contatos] = await Promise.all([conta("crm_leads"), conta("contacts")]);

  const { count: conversas } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .contains("metadata", { nexo_demo: true });

  const { count: atividades } = await admin
    .from("crm_lead_activities")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("source_module", MARCA_DEMO);

  return {
    negocios,
    contatos,
    conversas: conversas ?? 0,
    atividades: atividades ?? 0,
  };
}

/**
 * Apaga TODO dado marcado como demonstração desta organização.
 *
 * A ordem importa: `conversations.contact_id` é ON DELETE RESTRICT, então as
 * conversas saem antes dos contatos. Os negócios levam em cascata as
 * atividades, os scores, o estado de risco e as propostas de reativação.
 */
export async function limparDemo(orgId: string): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("conversations")
    .delete()
    .eq("organization_id", orgId)
    .contains("metadata", { nexo_demo: true });

  await admin.from("crm_leads").delete().eq("organization_id", orgId).eq("source", MARCA_DEMO);
  await admin.from("contacts").delete().eq("organization_id", orgId).eq("source", MARCA_DEMO);
  await admin.from("crm_pipelines").delete().eq("organization_id", orgId).eq("slug", PIPELINE.slug);
  await admin.from("ai_agents").delete().eq("organization_id", orgId).eq("name", AGENTE.nome);
  await admin
    .from("channel_sessions")
    .delete()
    .eq("organization_id", orgId)
    .eq("waha_session_name", `${MARCA_DEMO}-${orgId.slice(0, 8)}`);
}

/**
 * Preenche o CRM com a operação de demonstração.
 *
 * Idempotente pela via mais simples e honesta: limpa antes de semear. Assim
 * clicar duas vezes não duplica, e não há estado intermediário estranho.
 */
export async function semearDemo(orgId: string, userId: string): Promise<Contagem> {
  const admin = createAdminClient();
  await limparDemo(orgId);

  const erro = (etapa: string, e: { message: string } | null) => {
    if (e) throw new Error(`[demo] falhou em ${etapa}: ${e.message}`);
  };

  // ── Canal de WhatsApp (fictício — nenhum número é conectado de verdade) ────
  const { data: sessao, error: eSessao } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: orgId,
      waha_session_name: `${MARCA_DEMO}-${orgId.slice(0, 8)}`,
      engine: "NOWEB",
      // bytea NOT NULL. Valor de fachada: esta sessão nunca fala com o WAHA.
      webhook_secret_encrypted: "\\x6e65786f2d64656d6f",
      status: "WORKING",
      phone_number: "+5511987650000",
      display_name: "NEXO IA (demo)",
      metadata: { nexo_demo: true },
    })
    .select("id")
    .single();
  erro("criar o canal de WhatsApp", eSessao);

  // ── Agente de IA (para os cards com dono IA) ───────────────────────────────
  const { data: agente, error: eAgente } = await admin
    .from("ai_agents")
    .insert({
      organization_id: orgId,
      name: AGENTE.nome,
      description: AGENTE.descricao,
      system_prompt: AGENTE.prompt,
      is_active: true,
    })
    .select("id")
    .single();
  erro("criar o agente de IA", eAgente);

  // ── Funil ─────────────────────────────────────────────────────────────────
  const { data: pipeline, error: ePipeline } = await admin
    .from("crm_pipelines")
    .insert({
      organization_id: orgId,
      name: PIPELINE.nome,
      slug: PIPELINE.slug,
      description: "Funil de vendas consultivas da NEXO IA (SPIN).",
      position: 500,
      vocabulary: {
        lead: "Negócio",
        lead_plural: "Negócios",
        deal: "Negócio",
        deal_plural: "Negócios",
        won: "Fechado",
        lost: "Perdido",
        stage: "Etapa",
        stage_plural: "Etapas",
      },
    })
    .select("id")
    .single();
  erro("criar o funil", ePipeline);

  const { data: etapas, error: eEtapas } = await admin
    .from("crm_stages")
    .insert(
      ETAPAS.map((e, i) => ({
        organization_id: orgId,
        pipeline_id: pipeline!.id,
        name: e.nome,
        slug: e.slug,
        position: (i + 1) * 1000,
        color: e.cor,
        is_won: "ganho" in e && e.ganho === true,
        is_lost: "perdido" in e && e.perdido === true,
        agent_stage_hint: e.hint,
      })),
    )
    .select("id, slug");
  erro("criar as etapas", eEtapas);

  const idEtapa = new Map((etapas ?? []).map((e) => [e.slug as string, e.id as string]));

  // ── Contatos ──────────────────────────────────────────────────────────────
  const { data: contatos, error: eContatos } = await admin
    .from("contacts")
    .insert(
      NEGOCIOS.map((n) => ({
        organization_id: orgId,
        name: n.contato,
        display_name: n.contato,
        email: n.email,
        phone_number: n.telefone,
        source: MARCA_DEMO,
        source_metadata: { negocio: n.nome, cidade: n.cidade, segmento: n.segmento },
        tags: [n.segmento],
        created_by_user_id: userId,
        last_activity_at: isoAtras(n.diasParado),
      })),
    )
    .select("id, phone_number");
  erro("criar os contatos", eContatos);

  const idContato = new Map((contatos ?? []).map((c) => [c.phone_number as string, c.id as string]));

  // ── Negócios ──────────────────────────────────────────────────────────────
  const { data: negocios, error: eNegocios } = await admin
    .from("crm_leads")
    .insert(
      NEGOCIOS.map((n) => ({
        organization_id: orgId,
        pipeline_id: pipeline!.id,
        stage_id: idEtapa.get(n.etapa)!,
        contact_id: idContato.get(n.telefone)!,
        title: n.nome,
        description: `${n.segmento} — ${n.cidade}`,
        value_cents: n.valor === null ? null : n.valor * 100,
        currency: "BRL",
        // Coerência exigida pelo banco: dono é OU humano OU agente, nunca os dois.
        owner_kind: n.dono === "ia" ? "ai" : "user",
        owner_user_id: n.dono === "ia" ? null : userId,
        owner_agent_id: n.dono === "ia" ? agente!.id : null,
        assigned_at: isoAtras(n.diasParado + 2),
        source: MARCA_DEMO,
        source_metadata: { cidade: n.cidade, segmento: n.segmento },
        tags: [n.segmento, n.cidade],
        created_by_user_id: userId,
        ...(n.motivoPerda ? { lost_reason: n.motivoPerda } : {}),
      })),
    )
    .select("id, title");
  erro("criar os negócios", eNegocios);

  const idNegocio = new Map((negocios ?? []).map((l) => [l.title as string, l.id as string]));

  // ── Timeline ──────────────────────────────────────────────────────────────
  // `actor_kind: 'ai'` exige lastro não-vazio (constraint
  // crm_lead_activities_ai_needs_evidence) — daí o trace_ids em toda linha da IA.
  const atividades: Record<string, unknown>[] = [];

  for (const n of NEGOCIOS) {
    const leadId = idNegocio.get(n.nome)!;
    const base = n.diasParado;

    atividades.push({
      organization_id: orgId,
      lead_id: leadId,
      contact_id: idContato.get(n.telefone)!,
      source_module: MARCA_DEMO,
      type: "lead_created",
      actor_kind: "system",
      reason: `Negócio criado a partir de ${n.segmento} em ${n.cidade}.`,
      performed_at: isoAtras(base + 14),
      payload: { origem: "demonstração" },
    });

    atividades.push({
      organization_id: orgId,
      lead_id: leadId,
      contact_id: idContato.get(n.telefone)!,
      source_module: MARCA_DEMO,
      type: "ai_turn",
      actor_kind: "ai",
      actor_agent_id: agente!.id,
      reason:
        n.dono === "ia"
          ? "Assumi o atendimento e fiz a primeira qualificação pelo WhatsApp."
          : "Qualifiquei o contato e passei para o time.",
      evidence: { trace_ids: [crypto.randomUUID()] },
      performed_at: isoAtras(base + 10),
      payload: { canal: "whatsapp" },
    });

    atividades.push({
      organization_id: orgId,
      lead_id: leadId,
      source_module: MARCA_DEMO,
      type: "stage_changed",
      actor_kind: n.dono === "ia" ? "ai" : "user",
      ...(n.dono === "ia"
        ? { actor_agent_id: agente!.id, evidence: { trace_ids: [crypto.randomUUID()] } }
        : { performed_by_user_id: userId }),
      reason: `Movido para "${ETAPAS.find((e) => e.slug === n.etapa)!.nome}".`,
      performed_at: isoAtras(base + 3),
      payload: { para: n.etapa },
    });

    if (n.nota) {
      atividades.push({
        organization_id: orgId,
        lead_id: leadId,
        source_module: MARCA_DEMO,
        type: "note",
        actor_kind: "user",
        performed_by_user_id: userId,
        reason: n.nota,
        performed_at: isoAtras(base),
        payload: {},
      });
    }
  }

  const { data: atvCriadas, error: eAtv } = await admin
    .from("crm_lead_activities")
    .insert(atividades)
    .select("id, lead_id, type");
  erro("criar a timeline", eAtv);

  /** Uma âncora por negócio: é o que o score cita como prova rastreável. */
  const ancora = new Map<string, string>();
  for (const a of atvCriadas ?? []) {
    if (!ancora.has(a.lead_id as string)) ancora.set(a.lead_id as string, a.id as string);
  }

  // ── Score com justificativa ───────────────────────────────────────────────
  const scores = NEGOCIOS.filter((n) => n.score).map((n) => {
    const leadId = idNegocio.get(n.nome)!;
    const s = n.score!;
    return {
      lead_id: leadId,
      organization_id: orgId,
      ai_probability: s.valor,
      ai_probability_reason: s.razao,
      // O banco exige factors não-vazio E pelo menos um fator com âncora.
      ai_probability_evidence: {
        factors: s.fatores.map((f, i) => ({
          pontos: f.pontos,
          frase: f.frase,
          ...(i === 0 ? { ancora: { kind: "activity", id: ancora.get(leadId) } } : {}),
        })),
      },
      ai_probability_at: isoAtras(n.diasParado),
      ai_probability_band: faixa(s.valor),
      ai_probability_band_since: isoAtras(n.diasParado + 1),
    };
  });

  erro("gravar os scores", (await admin.from("crm_lead_scores").insert(scores)).error);

  // ── Estado de risco (alimenta o radar) ────────────────────────────────────
  // `since` tem que ser <= detected_at, e detected_at é carimbado pelo banco
  // com now() — por isso `since` é sempre no passado.
  const riscos = NEGOCIOS.filter((n) => n.etapa !== "fechado" && n.etapa !== "perdido").map((n) => ({
    lead_id: idNegocio.get(n.nome)!,
    organization_id: orgId,
    bucket: bucketRisco(n.diasParado),
    since: isoAtras(Math.max(n.diasParado - 1, 0.2)),
    cold_hours: 72,
  }));

  erro("gravar o estado de risco", (await admin.from("crm_lead_risk_states").insert(riscos)).error);

  // ── Uma proposta de reativação pendente (o negócio mais frio em aberto) ───
  const maisFrio = NEGOCIOS.filter((n) => n.etapa !== "fechado" && n.etapa !== "perdido").sort(
    (a, b) => b.diasParado - a.diasParado,
  )[0];

  if (maisFrio) {
    erro(
      "criar a proposta de reativação",
      (
        await admin.from("crm_lead_reactivations").insert({
          lead_id: idNegocio.get(maisFrio.nome)!,
          organization_id: orgId,
          status: "pending",
          expires_at: new Date(AGORA() + 3 * DIAS).toISOString(),
          draft:
            `Oi, ${maisFrio.contato}! Passando pra saber se faz sentido retomar ` +
            `nossa conversa sobre ${maisFrio.segmento.toLowerCase()}. ` +
            `Se não for o momento, me avisa que eu paro de te incomodar.`,
        })
      ).error,
    );
  }

  // ── Conversa de WhatsApp de exemplo ───────────────────────────────────────
  const primeiro = NEGOCIOS[0]!;
  const { data: conversa, error: eConversa } = await admin
    .from("conversations")
    .insert({
      organization_id: orgId,
      contact_id: idContato.get(primeiro.telefone)!,
      channel_session_id: sessao!.id,
      channel: "whatsapp",
      status: "ai_handling",
      assignee_kind: "ai",
      active_ai_agent_id: agente!.id,
      last_inbound_at: isoAtras(primeiro.diasParado),
      last_outbound_at: isoAtras(primeiro.diasParado),
      last_message_at: isoAtras(primeiro.diasParado),
      last_message_preview: CONVERSA_EXEMPLO[CONVERSA_EXEMPLO.length - 1]!.texto.slice(0, 80),
      metadata: { nexo_demo: true },
    })
    .select("id")
    .single();
  erro("criar a conversa", eConversa);

  const totalMsg = CONVERSA_EXEMPLO.length;
  erro(
    "criar as mensagens",
    (
      await admin.from("messages").insert(
        CONVERSA_EXEMPLO.map((m, i) => ({
          organization_id: orgId,
          conversation_id: conversa!.id,
          channel_session_id: sessao!.id,
          contact_id: idContato.get(primeiro.telefone)!,
          type: "text",
          direction: m.de === "contato" ? "inbound" : "outbound",
          status: m.de === "contato" ? "received" : "read",
          body: m.texto,
          sent_via: m.de === "contato" ? "external_device" : "ai",
          // Minutos decrescentes: a conversa fica na ordem certa na tela.
          sent_at: new Date(
            AGORA() - primeiro.diasParado * DIAS - (totalMsg - i) * 120_000,
          ).toISOString(),
          metadata: { nexo_demo: true },
        })),
      )
    ).error,
  );

  // ── Relógio do silêncio ───────────────────────────────────────────────────
  // Por último, de propósito: as atividades acima já carimbaram
  // `last_activity_at` (trigger fn_update_last_activity_at, lista positiva).
  // Este ajuste final é o que faz o radar mostrar os dias parados de verdade.
  for (const n of NEGOCIOS) {
    await admin
      .from("crm_leads")
      .update({ last_activity_at: isoAtras(n.diasParado) })
      .eq("id", idNegocio.get(n.nome)!);
  }

  return contarDemo(orgId);
}
