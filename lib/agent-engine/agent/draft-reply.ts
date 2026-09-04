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

/** Uma das opções que o vendedor recebe. O `angulo` é o rótulo curto que diz por onde ela ataca. */
export interface Sugestao {
  angulo: string;
  texto: string;
}

export type DraftReplyResult =
  | { ok: true; sugestoes: Sugestao[]; fontes: string[] }
  | { ok: false; reason: 'no_agent' | 'blocked' | 'empty' | 'error' };

/**
 * Quebra a resposta do modelo nas opções.
 *
 * ⚠️ TOLERANTE DE PROPÓSITO. O modelo às vezes devolve dois separadores, às
 * vezes põe a mensagem entre aspas, às vezes negrita o rótulo. Nada disso
 * justifica devolver erro ao vendedor que clicou pedindo ajuda: o que não casa
 * com o formato vira uma opção só, com o texto inteiro. Perder o rótulo é
 * aceitável; perder a sugestão não.
 */
export function separarSugestoes(bruto: string): Sugestao[] {
  const blocos = bruto
    .split(/^[\s*_]*-{3,}[\s*_]*$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: Sugestao[] = [];
  for (const bloco of blocos) {
    const marca = bloco.match(/^[\s*_#]*[ÂA]NGULO[\s*_]*:[\s*_]*(.+?)[\s*_]*$/im);
    const angulo = marca
      ? marca[1]!.replace(/[*_#"]/g, '').trim().slice(0, 28)
      : '';
    const corpo = marca ? bloco.slice(bloco.indexOf(marca[0]) + marca[0].length) : bloco;
    const texto = corpo.trim().replace(/^["“”']+|["“”']+$/g, '').trim();
    if (texto) out.push({ angulo: angulo || 'sugestão', texto });
  }
  // Três é o teto: quatro opções param de ser escolha e viram leitura.
  return out.slice(0, 3);
}

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

  // TRÊS OPÇÕES, UMA CHAMADA SÓ.
  //
  // Uma sugestão obriga a aceitar ou recomeçar; três deixam escolher o ângulo,
  // que é onde o vendedor tem opinião e o modelo não — ele não sabe se este dono
  // responde melhor a pergunta ou a prova. Quatro param de ser escolha e viram
  // leitura, por isso o teto é três.
  //
  // ⚠️ E É UMA CHAMADA, NÃO TRÊS. Pedir três vezes triplicaria o custo do botão
  // e ainda voltaria com variantes parecidas, porque cada chamada não sabe o que
  // a outra escreveu. No mesmo turno o modelo VÊ as duas anteriores e é obrigado
  // a mudar de ângulo — sai mais barato e sai mais diferente.
  const system =
    `${agent.systemPrompt}\n\n` +
    `[MODO RASCUNHO] Gere TRÊS respostas prontas para o vendedor humano escolher e enviar. ` +
    `Escreva como o vendedor (NÃO se identifique como assistente/IA, NÃO use disclosure de bot).\n` +
    `Cada uma tem que atacar por um ÂNGULO DIFERENTE — se as três disserem a mesma coisa com ` +
    `outras palavras, você falhou. Formato exato, e nada além dele:\n` +
    `ANGULO: <2 a 4 palavras, minúsculas>\n` +
    `<a mensagem, sem aspas>\n` +
    `---\n` +
    `ANGULO: ...\n` +
    `<a mensagem>\n` +
    `---\n` +
    `ANGULO: ...\n` +
    `<a mensagem>\n\n` +
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

  const sugestoes = separarSugestoes((result.text ?? '').trim());
  if (sugestoes.length === 0) return { ok: false, reason: 'empty' };

  // O QUE O MODELO LEU, escrito para quem vai enviar a mensagem.
  //
  // Sem isto o vendedor tem duas opções ruins: confiar sem conferir, ou reler a
  // conversa inteira — e reler a conversa inteira é justamente o trabalho que o
  // botão prometia poupar. Zendesk e Intercom mostram a fonte pelo mesmo motivo.
  // Não é telemetria: é o que torna a sugestão auditável em dois segundos.
  const fontes = [
    messages.length === 1
      ? 'a única mensagem desta conversa'
      : `as últimas ${messages.length} mensagens desta conversa`,
    ...(cola === '' ? [] : ['a cola do mercado (Configurações → Organização)']),
    ...(decisao ? ['a sua decisão sobre a última sugestão'] : []),
  ];

  return { ok: true, sugestoes, fontes };
}
