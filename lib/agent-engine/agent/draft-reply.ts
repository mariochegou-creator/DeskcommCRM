/**
 * Onda 5.1 — rascunho da IA no composer (sob demanda, sem envio). Via LIMPA:
 * reusa loadPublishedAgentConfig + getLeadContext + runModelCall SEM tools —
 * `result.text` já é o rascunho. NÃO reconstrói o toolset/playbook/checkpoint
 * do turno completo (inbound-turn.ts) e NÃO invoca guardrails de anti-ban/
 * disclosure/send: o texto é revisado por um humano antes de sair, então essa
 * camada não se aplica aqui.
 */
import type pg from 'pg';
import type { ModelMessage } from 'ai';

import { loadPublishedAgentConfig } from './agent-config';
import { getLeadContext } from '../edge/crm/get-lead-context';
import type { CrmEdgeConfig } from '../edge/crm/mcp-client';
import { runModelCall, type LlmEdgeConfig } from '../edge/llm/run-model-call';

export interface DraftReplyInput {
  tenantId: string; // = organization_id
  leadId: string; // = contact_id
  conversationId: string;
  channelSessionId: string;
}

export type DraftReplyResult =
  | { ok: true; draft: string }
  | { ok: false; reason: 'no_agent' | 'blocked' | 'empty' | 'error' };

export async function generateDraftReply(
  db: pg.Pool,
  llmCfg: LlmEdgeConfig,
  crmCfg: CrmEdgeConfig,
  input: DraftReplyInput,
): Promise<DraftReplyResult> {
  const agent = await loadPublishedAgentConfig(db, input.tenantId, input.channelSessionId);
  if (agent === null) return { ok: false, reason: 'no_agent' };

  const ctx = await getLeadContext(
    db,
    crmCfg,
    { tenantId: input.tenantId, leadId: input.leadId, conversationId: input.conversationId },
    // knobs reais da versão publicada — mesmos usados pelo turno completo
    // (inbound-turn.ts), sem número mágico: historyMessageWindow/historyTokenWindow
    // já são exatamente os campos que LeadContextKnobs espera.
    { historyLimit: agent.historyMessageWindow, maxTokens: agent.historyTokenWindow },
  );
  // Erro de leitura do CRM (lead_not_found/crm_error/crm_unavailable) é falha
  // técnica → "error" (vira 500 na rota), NÃO "blocked" (que diria ao vendedor
  // "contato bloqueado/anonimizado" — mensagem enganosa para um erro de infra).
  if (!ctx.ok) return { ok: false, reason: 'error' };
  // Bloqueio/anonimização é decisão de conformidade: não sugerir resposta.
  if (ctx.context.contact.is_blocked || ctx.lgpd.isAnonymized) {
    return { ok: false, reason: 'blocked' };
  }

  // A decisão do vendedor sobre a última proposta do agente ENTRA no prompt.
  //
  // Sem isto o rascunho pode sugerir exatamente o que ele acabou de recusar — e
  // aí o botão "Ignorar" da Wave 4 mente: prometemos que a recusa é sinal, e o
  // gesto seguinte de quem recusou é justamente pedir um rascunho. O agravante
  // é o modo: o prompt manda escrever COMO O VENDEDOR, sem disclosure. Não é só
  // repetir o recusado — é o sistema pôr NA BOCA DELE o que ele acabou de negar,
  // e quem lê a sugestão não tem como saber que a fonte ignorou a decisão.
  //
  // O dado já chegava aqui dentro de `ctx.context` (bloco 4.5) e estava sendo
  // descartado na montagem do prompt: contexto lido e não usado é a mesma
  // cegueira do evento sem consumer, um passo adiante.
  const decisao = ctx.context.last_human_decision;
  const blocoDecisao = decisao
    ? decisao.decision === 'dismissed'
      ? `\n\n[DECISÃO DO VENDEDOR] Ele JÁ DESCARTOU esta próxima ação: "${decisao.action}". ` +
        `NÃO sugira essa ação nem uma reformulação dela. Se for o único caminho que resta, ` +
        `escreva uma resposta que avance a conversa por outro lado.`
      : `\n\n[DECISÃO DO VENDEDOR] Ele JÁ APROVOU esta próxima ação: "${decisao.action}". ` +
        `A sugestão deve APOIAR essa ação, não propor outra em lugar dela.`
    : '';

  const messages: ModelMessage[] = ctx.context.messages.map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.body,
  }));

  // Sem histórico não há o que rascunhar — e o AI SDK lança com messages vazio
  // (viraria 500 cru). Retorna 'empty' (a UI mostra um aviso amigável).
  if (messages.length === 0) return { ok: false, reason: 'empty' };

  // [COLA DO MERCADO] — o motivo do botão existir.
  //
  // O vendedor clica na estrela justamente quando NÃO sabe o que responder. Com
  // só o systemPrompt do agente (que é de ATENDIMENTO: "agende 30 minutos"), a
  // sugestão saía genérica — uma pergunta solta que ignora o que o lead acabou
  // de falar. Genérico é pior que nada: ele lê, não usa, e o botão morre.
  //
  // A cola vai INTEIRA no prompt, e não por busca semântica na KB do agente,
  // por três motivos que só aparecem quando se tenta o contrário: (1) a KB
  // depende de embedding, e sem AI_GATEWAY_API_KEY/OPENAI_API_KEY toda busca
  // devolve ok:false — a cola simplesmente nunca chegaria; (2) a indexação de
  // arquivo de política ainda é stub no rag-indexer (`knowledge_source.updated`
  // retorna reindex_deferred), então não há o que buscar; (3) mesmo com as duas
  // resolvidas, top-K sobre um documento de duas páginas devolve pedaço e
  // esconde o resto — aqui o resto é o que segura o modelo (as travas do "o que
  // nunca dizer" moram longe da objeção que casou com a busca).
  //
  // Mora em organizations.settings.cola_do_mercado, editável em Configurações →
  // Organização: quando o nicho de foco mudar, quem vende reescreve a caixa e o
  // próximo clique já usa o texto novo — sem deploy.
  const { rows: orgRows } = await db.query<{ cola: string | null }>(
    `select settings->>'cola_do_mercado' as cola from organizations where id = $1`,
    [input.tenantId],
  );
  const cola = (orgRows[0]?.cola ?? '').trim();
  const blocoCola =
    cola === ''
      ? ''
      : `\n\n[COLA DO MERCADO] O que sabemos sobre o mercado deste cliente. ` +
        `Use UM fato ou UM número daqui para dar peso à resposta. ` +
        `Se nada aqui servir para o que ele falou, ignore o bloco — não force.\n${cola}`;

  const system =
    `${agent.systemPrompt}\n\n` +
    `[MODO RASCUNHO] Gere UMA resposta pronta para o vendedor humano enviar ao cliente. ` +
    `Escreva como o vendedor (NÃO se identifique como assistente/IA, NÃO use disclosure de bot). ` +
    `Responda só com o texto da mensagem, sem aspas nem comentários.\n\n` +
    `[COMO RESPONDER] Antes de escrever, leia a ÚLTIMA mensagem do cliente e ` +
    `identifique o que ela é: uma objeção (não tenho interesse, tá caro, já tenho ` +
    `quem faça), um sinal de rotina (só atendo em horário comercial, me manda por ` +
    `e-mail), um sinal de saturação (minha agenda tá cheia), ou uma dúvida real. ` +
    `A resposta tem que atacar ESSE ponto — nunca uma pergunta genérica que ` +
    `serviria para qualquer conversa.\n` +
    `Regras da mensagem: no máximo 4 linhas; concorde antes de virar o ângulo ` +
    `(nunca comece discordando); uma única pergunta, e no fim; nada de "presença ` +
    `digital", "funil" ou "automação"; nunca insinue que ele não entende do ` +
    `negócio dele. Não invente número, porcentagem nem caso de cliente` +
    // A permissão condicional vem colada na proibição de propósito: mandar "use
    // só os que estiverem na COLA DO MERCADO" numa org que não escreveu cola
    // nenhuma aponta para um bloco que não existe — e um prompt que cita fonte
    // ausente convida o modelo a preencher a lacuna, que é exatamente o que a
    // frase queria impedir.
    (blocoCola === '' ? '.' : `: use só os que estiverem na COLA DO MERCADO abaixo.`) +
    blocoCola +
    blocoDecisao;

  const { result } = await runModelCall(db, llmCfg, {
    tenantId: input.tenantId,
    leadId: input.leadId,
    jobId: null,
    purpose: 'draft_suggestion',
    system,
    messages,
    model: agent.model,
    llmOverride: { provider: agent.provider, credentialId: agent.credentialId },
    // SEM tools, SEM maxSteps → o SDK para no 1º step (default stepCountIs(1)):
    // result.text vem pronto, sem risco do modelo tentar chamar send_message.
  });

  const draft = (result.text ?? '').trim();
  if (!draft) return { ok: false, reason: 'empty' };
  return { ok: true, draft };
}
