import type { RiskBucket } from "@/lib/leads/risk-radar";

/**
 * O funil do AGENTE movendo o card no funil do TENANT (wave 8, cenários 25/26).
 *
 * O agente pensa em sete passos fixos (`lead_state.stage`); o tenant nomeia os
 * dele — "Avaliação" numa clínica, "Aguardando pagamento" num e-commerce. A
 * ponte é `crm_stages.agent_stage_hint` (migration 0084).
 *
 * ⚠️ ESTE ARQUIVO NÃO ADIVINHA NADA. As três respostas possíveis são mover,
 * não mover, ou não ter para onde — e a terceira é um estado legítimo do
 * produto, não um erro a contornar.
 */

/** O que o resolvedor sabe de cada estágio do pipeline. */
export interface EstagioCandidato {
  id: string;
  name: string;
  agent_stage_hint: string | null;
  is_archived: boolean;
  /**
   * A ordem da coluna no board — só o guarda de regressão usa, e por isso é
   * OPCIONAL: ausente significa "não dá para comparar", e o guarda deixa passar
   * em vez de recusar um movimento que o tenant mapeou de propósito.
   */
  position?: number | null;
}

export type DestinoDoAgente =
  | { move: true; stageId: string; stageName: string }
  /**
   * `sem_mapeamento` — o pipeline não declarou nenhum estágio para este passo.
   *
   * NÃO é erro e NÃO tem fallback: mover para "o mais próximo por posição"
   * inventaria semântica que o tenant não declarou, e o negócio apareceria num
   * lugar que ninguém escolheu. O card fica onde está, e o rastro registra que
   * o agente quis mover.
   */
  | { move: false; motivo: "sem_mapeamento"; passo: string }
  /** O agente está no passo que o negócio já ocupa: nada a fazer, e não é falha. */
  | { move: false; motivo: "ja_esta_la"; passo: string };

/**
 * Para onde o negócio vai quando o agente avança para `passo`.
 *
 * ⚠️ NÃO TRATA AMBIGUIDADE, e isso é deliberado: `uniq_crm_stages_pipeline_hint`
 * (0084) torna dois estágios com o mesmo hint IMPOSSÍVEIS no banco. Tratar aqui
 * seria proteger contra um estado que não pode existir — e, pior, faria alguém
 * acreditar que pode. A recusa mora na CONFIGURAÇÃO, onde chega a quem
 * configurou e ensina; recusa no uso chegaria a um terceiro, meses depois, sem
 * contexto nenhum.
 *
 * Estágio ARQUIVADO não é destino: ele é histórico, e mandar um negócio vivo
 * para lá o esconderia do board.
 */
export function resolveDestinoDoAgente(
  estagios: EstagioCandidato[],
  passo: string,
  estagioAtualId: string,
): DestinoDoAgente {
  const alvo = estagios.find((e) => !e.is_archived && e.agent_stage_hint === passo);
  if (!alvo) return { move: false, motivo: "sem_mapeamento", passo };
  if (alvo.id === estagioAtualId) return { move: false, motivo: "ja_esta_la", passo };
  return { move: true, stageId: alvo.id, stageName: alvo.name };
}

/**
 * O card ANDARIA PARA TRÁS no board — e isso o agente nunca faz sozinho.
 *
 * O funil do agente é por CONTATO e começa sempre em `new`; o funil do tenant é
 * por NEGÓCIO e já tem história quando o agente entra na conversa. Um lead que
 * um humano levou até «R1 agendada» e que hoje recebe a primeira mensagem do
 * agente produz a transição new→contacted — legítima do lado do agente, e do
 * lado do board um card voltando três colunas sozinho.
 *
 * Não é conflito de escrita (a trava otimista não pega: ninguém mexeu no card
 * durante a operação) e não é mapeamento faltando. É o único caso em que o
 * mapeamento está certo e o movimento ainda assim está errado, porque as duas
 * réguas não começam no mesmo lugar.
 *
 * ⚠️ Compara POSIÇÃO, não a ordem dos passos do agente: quem decide o que é
 * "para frente" é o board do tenant, que é o que o usuário enxerga.
 *
 * Posição ausente nos dois lados = não dá para comparar, e aí o guarda SAI DA
 * FRENTE: recusar por falta de informação transformaria um dado de ordenação em
 * veto sobre o funil.
 */
export function regridiriaNoFunil(
  estagios: EstagioCandidato[],
  deId: string,
  paraId: string,
): boolean {
  const de = estagios.find((e) => e.id === deId)?.position;
  const para = estagios.find((e) => e.id === paraId)?.position;
  if (typeof de !== "number" || typeof para !== "number") return false;
  return para < de;
}

/**
 * O texto que vai para a timeline quando o agente move o negócio.
 *
 * Nomeia os DOIS lados da tradução — o passo do agente e o estágio do tenant —
 * porque quem lê a timeline conhece só o segundo, e quem depura conhece só o
 * primeiro. "Movido para Avaliação" esconde que foi o agente; "avançou para
 * qualifying" é vocabulário que o usuário nunca viu.
 */
export function razaoDaMudancaPeloAgente(stageName: string, passo: string): string {
  return `Movido para ${stageName} pelo assistente (passo "${passo}" do atendimento)`;
}

export type { RiskBucket };

/* ────────────────────────────────────────────────────────────────────────── */

import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity, type ActivityEvidence } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { resolveActiveLeadForContact } from "@/lib/leads/active-lead";
import { stageChangeReason } from "@/lib/leads/activity-emitter";
import { midpoint } from "@/lib/kanban/fractional-indexing";
import { criarTarefasDaEtapa } from "@/lib/tarefas/criar-da-etapa";

export interface ResultadoDaSincronizacao {
  moveu: boolean;
  /**
   * ⚠️ NENHUM RÓTULO PODE MENTIR — é o que separa os três grupos:
   *  - estado legítimo do produto: `sem_mapeamento`, `sem_negocio`, `ambiguo`,
   *    `ja_esta_la`, `conflito_humano` (o card não andou, e ninguém errou);
   *  - o banco não respondeu: `indisponivel` (o funil PAROU — alguém precisa saber);
   *  - a escrita falhou: `falha_de_escrita`.
   * Reaproveitar um rótulo do primeiro grupo para os outros dois transformaria
   * indisponibilidade em rotina, que é o defeito que esta função já teve.
   */
  motivo:
    | "movido"
    | "sem_mapeamento"
    | "ja_esta_la"
    | "sem_negocio"
    | "ambiguo"
    | "conflito_humano"
    | "nao_regride"
    | "falha_de_escrita"
    | "indisponivel";
  leadId?: string;
  stageName?: string;
  detalhe?: string;
}

/**
 * O agente avançou o próprio funil — o card acompanha, se houver para onde.
 *
 * ⚠️ REUSA `resolveActiveLeadForContact`, e isso não é economia de código: o
 * funil do agente é por CONTATO e o card é por NEGÓCIO, então um contato com
 * dois negócios abertos exige decidir qual se move. A wave 4 já decidiu isso
 * para a próxima ação, e um SEGUNDO resolvedor de "qual negócio deste contato"
 * seria a doença desta entrega inteira criada de propósito — duas fontes que
 * começam iguais e divergem no primeiro ajuste.
 *
 * Ambíguo NÃO move nenhum, pela mesma razão da wave 4: mover o negócio errado é
 * pior que não mover, porque o usuário vê um card se mexendo sozinho e não tem
 * como saber por quê.
 */
export async function sincronizaEstagioDoAgente(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    passo: string;
    /**
     * QUEM moveu, quando se sabe. Sem isto a linha da timeline nasce como
     * "Sistema" e o atendente que abre a conversa não tem como distinguir o
     * card que a IA andou do card que o produto andou por conta própria — que
     * é exatamente a pergunta que ele faz ao ver a coluna mudar sozinha.
     */
    agentId?: string | null;
    /** O lastro da autoria. Sem ele a 0071 rebaixa o ator 'ai' para 'system'. */
    evidence?: ActivityEvidence | null;
  },
): Promise<ResultadoDaSincronizacao> {
  // ⚠️ O erro do SELECT É LIDO, e isso não é zelo: o supabase-js NÃO LANÇA em
  // falha de rede — devolve { data: null, error }. Descartar o erro faria o
  // banco fora virar `candidatos = []` → "sem_negocio", ou seja, uma queda do
  // Supabase indistinguível do estado normal de um contato sem negócio aberto.
  const { data: leadRows, error: erroLeads } = await admin
    .from("crm_leads")
    // `title` entra por causa do checklist: é ele que nomeia a tarefa ("Preparar
    // roteiro da R1 — GNG Solar") e é o título que serve de trava contra
    // duplicata. Sem ele, cinco cards na mesma coluna virariam cinco tarefas de
    // nome idêntico — e a trava apagaria quatro delas.
    .select("id, organization_id, pipeline_id, stage_id, status, title, created_at, last_activity_at")
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId);
  if (erroLeads) {
    return { moveu: false, motivo: "indisponivel", detalhe: erroLeads.message };
  }
  const candidatos = (leadRows ?? []) as Array<{
    id: string;
    organization_id: string;
    pipeline_id: string;
    stage_id: string;
    status: string;
    title: string | null;
    created_at: string;
    last_activity_at: string | null;
  }>;

  const rota = resolveActiveLeadForContact(
    candidatos.map((c) => ({
      id: c.id,
      organization_id: c.organization_id,
      pipeline_id: c.pipeline_id,
      status: c.status as "open" | "won" | "lost",
      created_at: c.created_at,
      last_activity_at: c.last_activity_at,
    })),
  );
  if (!rota.routed) {
    return { moveu: false, motivo: rota.reason === "no_open_lead" ? "sem_negocio" : "ambiguo" };
  }
  const lead = candidatos.find((c) => c.id === rota.leadId)!;

  const { data: stageRows, error: erroStages } = await admin
    .from("crm_stages")
    .select("id, name, agent_stage_hint, is_archived, position")
    .eq("pipeline_id", lead.pipeline_id);
  // Mesmo motivo do SELECT acima: sem esta linha, banco fora = pipeline sem
  // hint nenhum = "sem_mapeamento", e o incidente se disfarça de configuração.
  if (erroStages) {
    return { moveu: false, motivo: "indisponivel", leadId: lead.id, detalhe: erroStages.message };
  }

  const estagios = (stageRows ?? []) as EstagioCandidato[];
  const destino = resolveDestinoDoAgente(estagios, input.passo, lead.stage_id);
  if (!destino.move) return { moveu: false, motivo: destino.motivo, leadId: lead.id };

  // O guarda vem DEPOIS de resolver o destino porque só aqui existem os dois
  // lados para comparar — e antes da escrita porque o movimento para trás não
  // deve acontecer nem por um instante.
  if (regridiriaNoFunil(estagios, lead.stage_id, destino.stageId)) {
    return {
      moveu: false,
      motivo: "nao_regride",
      leadId: lead.id,
      stageName: destino.stageName,
    };
  }

  // O erro DESTE select é descartado de propósito — e a diferença para os dois de
  // cima (onde descartar produziu o defeito de tratar banco fora como rotina) é
  // que aqui nenhuma DECISÃO depende do resultado: o nome da origem só enfeita o
  // texto da timeline, que degrada de "Movido de A para X" para "Movido para X".
  // Abortar por causa dele desfaria um movimento que já aconteceu no banco.
  const { data: origem } = await admin
    .from("crm_stages")
    .select("name")
    .eq("id", lead.stage_id)
    .maybeSingle();

  // O TOPO DA COLUNA DE DESTINO, pela mesma razão do arrasto humano — e aqui a
  // razão é ainda mais forte: um card que andou SOZINHO é justamente o que
  // precisa estar à vista. Sem isto o negócio mantinha a posição da coluna
  // antiga e caía num lugar qualquer do meio da nova, onde ninguém olha.
  //
  // O erro é descartado de propósito: `midpoint(null, null)` devolve uma
  // posição válida, e recusar o movimento por causa de um número de ordenação
  // seria deixar o funil parado por causa de layout.
  const { data: topoDaColuna } = await admin
    .from("crm_leads")
    .select("position_in_stage")
    .eq("stage_id", destino.stageId)
    .neq("status", "archived")
    .order("position_in_stage", { ascending: true })
    .limit(1)
    .maybeSingle();
  const topo = (topoDaColuna as { position_in_stage: number | null } | null)?.position_in_stage;

  const { data: atualizadas, error } = await admin
    .from("crm_leads")
    .update({
      stage_id: destino.stageId,
      position_in_stage: midpoint(null, typeof topo === "number" ? topo : null),
    })
    .eq("id", lead.id)
    // Trava otimista pelo estágio de ORIGEM: se um humano arrastou o card entre
    // a leitura e a escrita, o agente não atropela a decisão dele.
    .eq("stage_id", lead.stage_id)
    // ⚠️ O `.select()` é o que torna a trava OBSERVÁVEL: sem ele, "0 linhas
    // afetadas" não é erro nenhum e o código seguiria emitindo a atividade de
    // um movimento que não aconteceu — história fabricada na timeline do
    // cliente, que é pior que não mover.
    .select("id");
  if (error) {
    return { moveu: false, motivo: "falha_de_escrita", leadId: lead.id, detalhe: error.message };
  }
  if ((atualizadas ?? []).length === 0) {
    // A trava atuou: um humano moveu o card no meio da operação. Não é erro (a
    // decisão dele vence) e NÃO emite atividade — nada aconteceu para contar.
    return { moveu: false, motivo: "conflito_humano", leadId: lead.id };
  }

  // A atividade usa o MESMO `stageChangeReason` do arrasto humano — a timeline
  // não deve ter duas gramáticas para o mesmo acontecimento. Quem moveu está no
  // ATOR, que é onde essa informação pertence.
  const atividade = await emitLeadActivity(admin, {
    organizationId: input.organizationId,
    leadId: lead.id,
    contactId: input.contactId,
    type: "stage_changed",
    sourceModule: "crm",
    sourceId: lead.id,
    // ⚠️ O ATOR É O AGENTE, com nome e lastro — não "o produto".
    //
    // Enquanto esta linha nascia como `webhook_source`, a timeline dizia
    // "Sistema" e a autoria da IA sumia no mesmo balaio de cron e webhook. O
    // fallback continua existindo para o chamador que não sabe qual agente
    // moveu (nenhum hoje), porque afirmar autoria sem saber de quem é pior que
    // não afirmar — mesma regra do lastro logo abaixo.
    actor: input.agentId
      ? { type: "ai_agent", id: input.agentId, role: "agent" }
      : { type: "webhook_source", id: "agent-stage-sync" },
    evidence: input.evidence ?? null,
    reason: stageChangeReason(
      (origem as { name: string } | null)?.name ?? null,
      destino.stageName,
    ),
    payload: { passo_do_agente: input.passo, de: lead.stage_id, para: destino.stageId },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(admin, {
      organizationId: input.organizationId,
      leadId: lead.id,
      tipo: "stage_changed",
      origem: "lib/leads/agent-stage-sync",
      erro: atividade.error,
    });
  }

  // ⚠️ O QUE VEM ABAIXO É O QUE FALTAVA PARA "MOVIDO PELO AGENTE" SER A MESMA
  // COISA QUE "MOVIDO POR UMA PESSOA".
  //
  // Enquanto este bloco não existia, o agente mudava a coluna e mais nada
  // acontecia: nenhum checklist da etapa, nenhuma automação, nenhum webhook. O
  // card chegava em «Respondeu» sem as tarefas que o mesmo card ganha quando um
  // humano o arrasta para lá — e o buraco só apareceria semanas depois, na forma
  // de lead qualificado que ninguém seguiu, sem nada na tela explicando por quê.
  //
  // Meia automação é pior que nenhuma: quem confia no checklist confia nele
  // sempre, e "só quando foi humano" não é uma regra que alguém carregue na
  // cabeça.

  // Nunca derruba o movimento — o card JÁ mudou de coluna. Mesma política do
  // arrasto humano, onde o checklist também vive dentro de um try.
  try {
    await criarTarefasDaEtapa(admin, {
      organizationId: input.organizationId,
      leadId: lead.id,
      leadTitulo: lead.title,
      contactId: input.contactId,
      etapa: { name: destino.stageName },
      // Não houve pessoa nenhuma nisto. O dono de cada tarefa sai do PAPEL
      // configurado na organização (closer/SDR); papel sem pessoa não vira
      // tarefa órfã — ver o filtro em `criarTarefasDaEtapa`.
      autorUserId: null,
      agora: new Date(),
    });
  } catch {
    // Silêncio deliberado: o motivo já está no comentário acima, e um throw
    // aqui desfaria (para quem chama) um movimento que aconteceu de verdade.
  }

  // O barramento de automações e webhooks, com a MESMA forma de payload da rota
  // de move: quem consome não deve precisar saber se quem moveu foi gente ou
  // agente — isso está no `metadata`, que é onde a informação pertence.
  await admin
    .rpc("emit_event", {
      p_event_type: "lead.stage_changed",
      p_entity_kind: "crm_lead",
      p_entity_id: lead.id,
      p_payload: {
        from_stage_id: lead.stage_id,
        to_stage_id: destino.stageId,
        status: lead.status,
      },
      p_metadata: {
        actor_kind: "ai",
        actor_agent_id: input.agentId ?? null,
        passo_do_agente: input.passo,
      },
      p_organization_id: input.organizationId,
    })
    .then(({ error: erroEvento }: { error: { message: string } | null }) => {
      if (erroEvento) {
        console.error("[agent-stage-sync] emit_event falhou", erroEvento.message);
      }
    });

  return { moveu: true, motivo: "movido", leadId: lead.id, stageName: destino.stageName };
}
