/**
 * Cadência anti-vácuo — o fluxo de follow-up da prospecção fria (Nexo IA).
 *
 * O lead recebe a abordagem e some. O Cofre de Abordagens chama isso de vácuo e
 * dá a cadência que reabre. São OITO toques em 45 dias, cada um com um ângulo
 * diferente: D2 bump, D5 ângulo novo, D9 prova social, D14 curiosidade, D20
 * mostrar na prática, D27 padrão do nicho, D35 pessoa certa, D45 despedida.
 * Depois disso PARA — insistir além do D45 não reabre nada, só queima o número.
 *
 * POR QUE OITO E NÃO QUATRO (mudança de 21/08/2026): a literatura de outbound
 * converge em que a maior parte das conversões acontece entre o 5º e o 12º
 * toque. Contando a abordagem como toque 1, a cadência antiga parava no 5º —
 * ou seja, desistia exatamente onde a conversão começa. O espaçamento cresce a
 * cada toque (3, 4, 5, 6, 7, 8, 10 dias) porque oito mensagens apertadas num
 * WhatsApp não são persistência, são denúncia por spam.
 *
 * Este script monta esse fluxo e publica. Idempotente por `(organization_id,
 * name)`: rodar de novo republica a mesma cadência em vez de criar uma segunda.
 *
 *   npx tsx scripts/seed-cadencia-anti-vacuo.ts --org <uuid>
 *   npx tsx scripts/seed-cadencia-anti-vacuo.ts --org <uuid> --dry-run
 *   npx tsx scripts/seed-cadencia-anti-vacuo.ts --org <uuid> --ativar
 *
 * ⚠️ TRÊS DECISÕES QUE NÃO SÃO ÓBVIAS NO GRAFO:
 *
 * 1. O INTERVALO ENTRE TOQUES MORA NO `grace_timeout_ms` DO ai_classify, NÃO
 *    NUM NÓ `wait`. Parece rebuscado e é o contrário: `wait` deixa o enrollment
 *    em `active`, e a reatividade (lib/followup/reactivity.ts) só enxerga
 *    resposta de quem está em `waiting_reply` — quem põe nesse estado é o
 *    ai_classify. Com nós `wait`, o lead podia responder no D3 e levar o toque
 *    do D5 na cara mesmo assim. O classify é o único estado em que a resposta
 *    do lead interrompe a cadência, então ele É a espera.
 *
 * 2. TODA action leva `fallback_template_id`, inclusive as que o validador não
 *    exigiria. O `long_wait_needs_template` (validate-publish.ts) só conta nós
 *    `wait`, e como a espera aqui está no grace, a exigência não dispara em
 *    nenhuma delas. A proteção que ele representa continua valendo: uma
 *    mensagem que sai dias depois não pode depender do LLM estar de pé. Aqui
 *    ela é garantida por construção, não por validação.
 *
 * 3. PUBLICAR RELIGA O POINTER, E ISSO JÁ CUSTOU CARO. A função SQL
 *    `fn_publish_followup_flow_version` (migration 0056) grava
 *    `status = 'active'` no pointer junto com a version — de propósito, é o que
 *    "publicar" significa na tela. Só que em 10/08/2026 este pointer foi posto
 *    em `disabled` na mão para conter um loop de re-inscrição (38 leads viraram
 *    4.5k enrollments e 9.2k alertas quando o LLM caiu por falta de crédito).
 *    Rodar o seed sem pensar religava a cadência e repetia o incidente. Por
 *    isso o script RESTAURA o status anterior depois de publicar, a menos que
 *    venha `--ativar` explícito.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

import type { FlowGraph } from "../lib/followup/graph-schema";
import { validateFlowForPublish } from "../lib/followup/validate-publish";
import { publishFollowupFlowVersion } from "../lib/followup/publish";

const DIA_MS = 86_400_000;

/** Nome do pointer — é a chave de idempotência (unique (organization_id, name)). */
const NOME_DO_FLUXO = "Cadência anti-vácuo (prospecção fria)";

/** Prefixo dos templates de fallback — usado também para varrer os órfãos. */
const PREFIXO_TEMPLATE = "Anti-vácuo ";

/** O sweep de silêncio entrega o lead no D2 — daí o threshold. */
const D2_MINUTOS = 2 * 24 * 60;

/**
 * Os textos de fallback. Saem quando o LLM não está disponível, então são
 * escritos para funcionar SEM nada interpolado — um fallback que depende de
 * variável é um fallback que falha junto.
 *
 * Todos passam no crivo do Cofre: cabem numa tela, uma pergunta só, sem emoji,
 * sem travessão, sem citar ferramenta.
 */
const TEMPLATES = [
  {
    chave: "d2",
    title: "Anti-vácuo D2 — bump suave",
    shortcut: "/vacuo-d2",
    body:
      "Oi! Só subindo minha mensagem aqui pra ela não se perder. Aquela pergunta " +
      "que te fiz segue de pé. E se não fizer sentido pra vocês, me diz um " +
      '"não rolou" que eu não incomodo mais, combinado?',
  },
  {
    chave: "d5",
    title: "Anti-vácuo D5 — ângulo novo",
    shortcut: "/vacuo-d5",
    body:
      "Oi! Lembrei de vocês hoje por um motivo: quase todo negócio daqui que eu " +
      "olho perde cliente no meio do caminho sem nem perceber, e quase sempre dá " +
      "pra resolver rápido. Quer que eu te fale o que eu vi no de vocês?",
  },
  {
    chave: "d9",
    title: "Anti-vácuo D9 — prova social local",
    shortcut: "/vacuo-d9",
    body:
      "Oi, tudo certo? Esses dias entreguei um trabalho pra um negócio parecido " +
      "com o de vocês aqui da região e o dono gostou demais do resultado. Na hora " +
      "pensei em vocês. Posso te mandar o link pra ver como ficou?",
  },
  {
    chave: "d14",
    title: "Anti-vácuo D14 — curiosidade",
    shortcut: "/vacuo-d14",
    body:
      "Oi! Uma pergunta rápida e eu paro por aqui: quando alguém chama vocês e " +
      "ninguém consegue responder na hora, o que costuma acontecer com esse " +
      "cliente? Pergunto porque é onde eu mais vejo negócio daqui perder venda.",
  },
  {
    chave: "d20",
    title: "Anti-vácuo D20 — mostrar na prática",
    shortcut: "/vacuo-d20",
    body:
      "Oi, tudo bem? Explicar por mensagem é ruim, então é mais fácil eu te " +
      "mostrar. Eu monto uma amostra rápida do que dá pra fazer aí no negócio de " +
      "vocês, sem custo e sem compromisso, e te mando pra ver. Posso fazer?",
  },
  {
    chave: "d27",
    title: "Anti-vácuo D27 — o padrão que se repete",
    shortcut: "/vacuo-d27",
    body:
      "Oi! Quase todo dono que eu procuro me diz no começo que está dando conta, " +
      "e é verdade mesmo. O que eu vejo depois é sempre igual: o movimento cresce " +
      "e o atendimento não acompanha. Vale conversar dez minutos antes disso?",
  },
  {
    chave: "d35",
    title: "Anti-vácuo D35 — pessoa certa",
    shortcut: "/vacuo-d35",
    body:
      "Oi! Pode ser que eu esteja falando com a pessoa errada aí dentro, e aí a " +
      "culpa é minha. Quem que cuida dessa parte no negócio de vocês? Me passando " +
      "o contato certo eu falo com essa pessoa e paro de te incomodar.",
  },
  {
    chave: "d45",
    title: "Anti-vácuo D45 — a última mensagem",
    shortcut: "/vacuo-d45",
    body:
      "Oi, última mensagem minha, prometo. Entendi que agora não é o momento, e " +
      "tá tudo certo. Vou parar de te escrever pra não virar incômodo. Se um dia " +
      "isso subir na sua lista, meu contato é este aqui mesmo. Sucesso pra vocês!",
  },
] as const;

type ChaveTemplate = (typeof TEMPLATES)[number]["chave"];

/**
 * O que cada toque tem que fazer. O agente recebe isto junto com o contexto do
 * lead (incluindo os ganchos de prospecção que a importação semeou na conversa)
 * e escreve a mensagem daquele lead.
 *
 * A regra do crivo vai em TODOS eles porque o modelo esquece: sem repetir, ele
 * devolve balão longo com emoji e três perguntas.
 */
const CRIVO =
  "REGRAS DURAS: uma mensagem só, curta, que caiba numa tela de celular (máximo " +
  "320 caracteres). UMA pergunta apenas. Sem emoji, sem travessão, sem lista, sem " +
  "quebra de linha. Nunca cite ferramenta, IA, automação ou sistema: o dono compra " +
  "o resultado, não como a gente produz. Nunca fale de preço, valor ou proposta. " +
  "Português casual de WhatsApp, como você falaria com um conhecido.";

/**
 * A regra que segura os oito toques de pé: cada um tem que soar como assunto
 * NOVO. Repetir o ângulo anterior com outras palavras é o que transforma
 * persistência em perseguição — e com quatro toques a mais, o risco dobra.
 */
const NAO_REPITA =
  "Antes de escrever, leia o que já foi enviado nesta conversa e NÃO repita " +
  "assunto, argumento nem pergunta que já saiu. Se o ângulo deste toque já foi " +
  "usado sem querer, troque por outro fato do negócio dele. ";

const TOQUES: Record<ChaveTemplate, string> = {
  d2:
    "Segundo toque com o lead, 2 dias depois da abordagem que ele não respondeu. " +
    "NÃO é para repetir a abordagem nem para vender: é só subir a conversa e dar " +
    "uma saída digna. Retome em uma linha o assunto que você levantou na primeira " +
    'mensagem e ofereça o "não rolou" explicitamente — dar a saída é o que faz o ' +
    "dono responder em vez de ignorar. " +
    CRIVO,
  d5:
    "Terceiro toque, 5 dias depois da abordagem. Este tem que chegar com ÂNGULO " +
    "NOVO: se o dossiê do lead traz um gancho de segundo toque (custom field " +
    '"gancho segundo toque"), use ELE. Se não houver, escolha outra dor visível ' +
    "do negócio dele, diferente da que você já usou. Insistir no mesmo assunto é " +
    "o que faz a mensagem soar a robô. " +
    CRIVO,
  d9:
    "Quarto toque, 9 dias depois. Prova social local: conte um resultado REAL que " +
    "a Nexo IA entregou para um negócio parecido da região e ofereça mostrar. Se " +
    "você não tiver um caso concreto no contexto, não invente: volte para uma " +
    "observação do negócio dele. " +
    NAO_REPITA +
    CRIVO,
  d14:
    "Quinto toque, 14 dias depois. Aqui não se vende nada: o objetivo é " +
    "CURIOSIDADE. Faça uma única pergunta sobre a rotina do negócio dele cuja " +
    "resposta o próprio dono nunca parou para pensar, do tipo o que acontece com " +
    "o cliente que chama e não é atendido na hora. Não ofereça reunião, não " +
    "ofereça serviço, não explique o que você faz. A pergunta é a mensagem " +
    "inteira. " +
    NAO_REPITA +
    CRIVO,
  d20:
    "Sexto toque, 20 dias depois. Pare de explicar e ofereça MOSTRAR. Se o " +
    "contexto trouxer um demo, site ou amostra já montada para este lead, ofereça " +
    "o link direto. Se não houver nada pronto, ofereça montar uma amostra rápida " +
    "do negócio dele, deixando claro que é sem custo e sem compromisso. Nunca " +
    "diga que já montou algo que não está no contexto. " +
    NAO_REPITA +
    CRIVO,
  d27:
    'Sétimo toque, 27 dias depois. Estrutura "eu já vi isso acontecer": conte, em ' +
    "uma frase, o padrão que se repete nos donos do mesmo ramo — primeiro acham " +
    "que está sob controle, depois o movimento cresce e o atendimento não " +
    "acompanha. Não acuse o lead de nada: fale dos outros e deixe ele se " +
    "reconhecer sozinho. " +
    NAO_REPITA +
    CRIVO,
  d35:
    "Oitavo toque, 35 dias depois. Assuma a hipótese de que você errou de pessoa. " +
    "Pergunte quem cuida desse assunto dentro do negócio e peça o contato certo, " +
    "prometendo parar de escrever para ele. Isso reabre conversa por dois " +
    "caminhos: ou ele passa o contato, ou ele responde dizendo que é ele mesmo. " +
    "Não faça pergunta de venda. " +
    NAO_REPITA +
    CRIVO,
  d45:
    "Última mensagem, 45 dias depois. É despedida, não cobrança: reconheça que " +
    "não é o momento, diga que vai parar de escrever para não incomodar, e deixe " +
    "a porta aberta. Não faça pergunta de venda e não peça retorno. É a mensagem " +
    "que mais reabre conversa morta justamente por não pedir nada. " +
    CRIVO,
};

/**
 * A cadência em uma lista só: ordem dos toques e quantos dias esperar até o
 * próximo. O último não tem espera — é a despedida, e ela não pede retorno.
 *
 * O intervalo CRESCE de propósito. Toque diário não reabre conversa nenhuma e
 * queima o número; o silêncio longo é parte da mensagem.
 */
const CADENCIA: Array<{ chave: ChaveTemplate; esperaDias: number | null }> = [
  { chave: "d2", esperaDias: 3 },
  { chave: "d5", esperaDias: 4 },
  { chave: "d9", esperaDias: 5 },
  { chave: "d14", esperaDias: 6 },
  { chave: "d20", esperaDias: 7 },
  { chave: "d27", esperaDias: 8 },
  { chave: "d35", esperaDias: 10 },
  { chave: "d45", esperaDias: null },
];

// ---------------------------------------------------------------------------

function lerEnvLocal(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env.local");
  const envFile = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};
  for (const line of envFile.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }
  return env;
}

function argOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

/**
 * Monta o grafo. `templateIds` mapeia cada toque ao id do fallback — por isso o
 * grafo só existe DEPOIS dos templates: um `fallback_template_id` apontando
 * para o vazio passaria na validação estrutural e falharia no envio, dias
 * depois, sem ninguém olhando.
 */
function montarGrafo(templateIds: Record<ChaveTemplate, string>): FlowGraph {
  const toque = (chave: ChaveTemplate, x: number) =>
    ({
      id: `envia_${chave}`,
      type: "action" as const,
      label: `Toque ${chave.toUpperCase()}`,
      position: { x, y: 0 },
      config: {
        mode: "ai_message" as const,
        prompt_hint: TOQUES[chave],
        fallback_template_id: templateIds[chave],
      },
    });

  // `classes` precisa de pelo menos uma, e cada uma exige aresta própria
  // (missing_class_edge). "respondeu" é rede de segurança: com
  // cancel_on_reply o enrollment é cancelado antes de chegar aqui, mas se
  // essa reação falhar, a aresta impede a cadência de seguir por cima de uma
  // conversa viva.
  const espera = (chave: ChaveTemplate, graceMs: number, x: number) =>
    ({
      id: `espera_${chave}`,
      type: "ai_classify" as const,
      label: `Espera pós-${chave.toUpperCase()}`,
      position: { x, y: 0 },
      config: {
        classes: ["respondeu"],
        grace_timeout_ms: graceMs,
        target: "last_reply" as const,
        hint:
          "O lead respondeu alguma coisa desde nosso último envio? Qualquer " +
          'resposta humana, mesmo negativa, é "respondeu".',
      },
    });

  const nodes: FlowGraph["nodes"] = [
    { id: "inicio", type: "trigger", label: "Lead sem resposta há 2 dias", position: { x: 0, y: 0 }, config: {} },
  ];
  const edges: FlowGraph["edges"] = [
    {
      id: "e_inicio",
      source: "inicio",
      target: `envia_${CADENCIA[0]!.chave}`,
      priority: 0,
      condition: { type: "always" },
    },
  ];

  let x = 200;
  CADENCIA.forEach((passo, i) => {
    nodes.push(toque(passo.chave, x));
    x += 200;

    const proximo = CADENCIA[i + 1];
    if (!proximo || passo.esperaDias === null) {
      // O último toque não tem espera depois: é a despedida, e o Cofre é
      // explícito que ela não pede retorno. Encerra direto.
      edges.push({
        id: `e_${passo.chave}_fim`,
        source: `envia_${passo.chave}`,
        target: "fim_sem_resposta",
        priority: 0,
        condition: { type: "always" },
      });
      return;
    }

    nodes.push(espera(passo.chave, passo.esperaDias * DIA_MS, x));
    x += 200;

    // Cada espera tem 3 saídas: respondeu → fim; no_reply → próximo toque;
    // always → o MESMO próximo toque. A `always` é exigida como fallback
    // (missing_always_fallback) e existe para o caso de o classify devolver
    // algo fora do vocabulário: melhor seguir a cadência do que travar o
    // enrollment.
    const alvo = `envia_${proximo.chave}`;
    edges.push(
      {
        id: `e_${passo.chave}_espera`,
        source: `envia_${passo.chave}`,
        target: `espera_${passo.chave}`,
        priority: 0,
        condition: { type: "always" },
      },
      {
        id: `e_${passo.chave}_respondeu`,
        source: `espera_${passo.chave}`,
        target: "fim_respondeu",
        priority: 10,
        condition: { type: "class_match", value: "respondeu" },
      },
      {
        id: `e_${passo.chave}_sem_resposta`,
        source: `espera_${passo.chave}`,
        target: alvo,
        priority: 5,
        condition: { type: "class_match", value: "no_reply" },
      },
      {
        id: `e_${passo.chave}_fallback`,
        source: `espera_${passo.chave}`,
        target: alvo,
        priority: 0,
        condition: { type: "always" },
      },
    );
  });

  nodes.push(
    {
      id: "fim_sem_resposta",
      type: "end",
      label: `Esgotou os ${CADENCIA.length} toques`,
      position: { x, y: 0 },
      config: { outcome: "exhausted", note: "45 dias sem resposta — cadência encerrada" },
    },
    {
      id: "fim_respondeu",
      type: "end",
      label: "Lead respondeu",
      position: { x: 800, y: 200 },
      config: { outcome: "converted", note: "Respondeu: sai da cadência, o atendimento assume" },
    },
  );

  return { nodes, edges };
}

/**
 * Apaga os templates de cadência que sobraram de uma versão anterior do script.
 * Sem isto, renomear um toque deixa o texto velho no banco com o mesmo atalho
 * do novo — e o vendedor vê dois "/vacuo-d14" na gaveta, um deles morto. Só
 * varre os compartilhados com o prefixo da cadência; template pessoal de
 * vendedor e template de qualquer outro assunto não são tocados.
 */
async function limparTemplatesOrfaos(admin: SupabaseClient, orgId: string): Promise<void> {
  const titulosAtuais = new Set<string>(TEMPLATES.map((t) => t.title));
  const { data, error } = await admin
    .from("message_templates")
    .select("id, title")
    .eq("organization_id", orgId)
    .is("owner_user_id", null)
    .like("title", `${PREFIXO_TEMPLATE}%`);
  if (error) throw new Error(`varredura de templates órfãos: ${error.message}`);

  for (const linha of data ?? []) {
    if (titulosAtuais.has(linha.title)) continue;
    const { error: delErr } = await admin.from("message_templates").delete().eq("id", linha.id);
    if (delErr) throw new Error(`remoção do template órfão "${linha.title}": ${delErr.message}`);
    console.log(`  - template órfão "${linha.title}" removido`);
  }
}

async function upsertTemplates(
  admin: SupabaseClient,
  orgId: string,
): Promise<Record<ChaveTemplate, string>> {
  const ids = {} as Record<ChaveTemplate, string>;
  for (const t of TEMPLATES) {
    // Sem unique em (organization_id, title): procura antes de inserir, senão
    // cada rodada deixaria mais uma cópia e o grafo apontaria para a errada.
    const { data: existente, error: buscaErr } = await admin
      .from("message_templates")
      .select("id")
      .eq("organization_id", orgId)
      .eq("title", t.title)
      .is("owner_user_id", null) // compartilhado da org, não pessoal de um vendedor
      .maybeSingle();
    if (buscaErr) throw new Error(`busca do template "${t.title}": ${buscaErr.message}`);

    if (existente) {
      const { error } = await admin
        .from("message_templates")
        .update({ body: t.body, shortcut: t.shortcut, updated_at: new Date().toISOString() })
        .eq("id", existente.id);
      if (error) throw new Error(`update do template "${t.title}": ${error.message}`);
      ids[t.chave] = existente.id;
      console.log(`  ~ template "${t.title}" atualizado`);
      continue;
    }

    const { data, error } = await admin
      .from("message_templates")
      .insert({ organization_id: orgId, owner_user_id: null, title: t.title, body: t.body, shortcut: t.shortcut })
      .select("id")
      .single();
    if (error) throw new Error(`insert do template "${t.title}": ${error.message}`);
    ids[t.chave] = data.id;
    console.log(`  + template "${t.title}" criado`);
  }
  return ids;
}

/** Devolve o id do pointer e o status que ele tinha ANTES desta rodada. */
async function upsertPointer(
  admin: SupabaseClient,
  orgId: string,
  graph: FlowGraph,
): Promise<{ id: string; statusAnterior: string }> {
  const triggerConfig = {
    kind: "silence" as const,
    params: {
      threshold_minutes: D2_MINUTOS,
      segments: [],
      // O ponto todo desta cadência: sem isto o lead que NUNCA respondeu é
      // invisível pro sweep, e ele é justamente o alvo.
      include_never_replied: true,
    },
    // Respondeu, acabou a cadência. O atendimento assume — o Cofre é explícito
    // que responder tira o lead do fluxo de reabertura.
    cancel_on_reply: true,
  };

  const { data: existente, error: buscaErr } = await admin
    .from("followup_flow_pointers")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("name", NOME_DO_FLUXO)
    .maybeSingle();
  if (buscaErr) throw new Error(`busca do pointer: ${buscaErr.message}`);

  if (existente) {
    const { error } = await admin
      .from("followup_flow_pointers")
      .update({
        draft_graph: graph,
        trigger_config: triggerConfig,
        // 'pause': humano assumindo a conversa congela a cadência; quando ele
        // devolve o bot, ela retoma de onde parou. 'cancel' jogaria fora os
        // toques restantes de um lead que só precisou de um empurrão humano.
        handoff_policy: "pause",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existente.id);
    if (error) throw new Error(`update do pointer: ${error.message}`);
    console.log(`  ~ fluxo "${NOME_DO_FLUXO}" atualizado (status atual: ${existente.status})`);
    return { id: existente.id, statusAnterior: existente.status };
  }

  const { data, error } = await admin
    .from("followup_flow_pointers")
    .insert({
      organization_id: orgId,
      name: NOME_DO_FLUXO,
      status: "draft",
      draft_graph: graph,
      trigger_config: triggerConfig,
      handoff_policy: "pause",
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert do pointer: ${error.message}`);
  console.log(`  + fluxo "${NOME_DO_FLUXO}" criado`);
  return { id: data.id, statusAnterior: "draft" };
}

async function main(): Promise<void> {
  const orgId = argOf("--org");
  const dryRun = process.argv.includes("--dry-run");
  const ativar = process.argv.includes("--ativar");

  // O dry-run roda ANTES de tocar em env ou banco: ele valida a ESTRUTURA do
  // grafo, e estrutura não depende de credencial nem de org. Assim dá pra
  // conferir a cadência numa máquina sem .env.local nenhum.
  if (dryRun) {
    // Ids de template falsos: a validação estrutural não os resolve, e os
    // reais não mudariam o resultado.
    const falsos = Object.fromEntries(
      TEMPLATES.map((t, i) => [
        t.chave,
        `00000000-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`,
      ]),
    ) as Record<ChaveTemplate, string>;
    const validacao = validateFlowForPublish(montarGrafo(falsos));
    if (!validacao.ok) {
      console.error("dry-run: grafo REPROVADO na validação:");
      for (const e of validacao.errors) console.error(`  [${e.code}] ${e.node_id ?? "-"}: ${e.message}`);
      process.exit(1);
    }
    console.log(
      `dry-run: grafo válido para publicação (${CADENCIA.length} toques: ` +
        `${CADENCIA.map((p) => p.chave.toUpperCase()).join(" -> ")}). Nada foi escrito.`,
    );
    return;
  }

  if (!orgId) {
    console.error("uso: npx tsx scripts/seed-cadencia-anti-vacuo.ts --org <uuid> [--dry-run] [--ativar]");
    process.exit(1);
  }

  const env = lerEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local");
  }
  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, display_name")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) throw new Error(`leitura da organização: ${orgErr.message}`);
  if (!org) throw new Error(`organização ${orgId} não existe`);
  console.log(`Organização: ${org.display_name} (${org.id})\n`);

  console.log("Templates de fallback:");
  await limparTemplatesOrfaos(admin, orgId);
  const templateIds = await upsertTemplates(admin, orgId);

  const graph = montarGrafo(templateIds);
  const validacao = validateFlowForPublish(graph);
  if (!validacao.ok) {
    console.error("\nGrafo REPROVADO na validação — nada foi publicado:");
    for (const e of validacao.errors) console.error(`  [${e.code}] ${e.node_id ?? "-"}: ${e.message}`);
    process.exit(1);
  }

  console.log("\nFluxo:");
  const pointer = await upsertPointer(admin, orgId, graph);

  // `created_by` da versão: qualquer membro ativo da org serve como autoria de
  // seed, mas a coluna é NOT NULL — sem um usuário, o publish falha no banco.
  // `revoked_at is null` porque acesso revogado não pode assinar publicação.
  const { data: membro, error: membroErr } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (membroErr) throw new Error(`busca de membro da org: ${membroErr.message}`);
  if (!membro) throw new Error("organização sem nenhum membro ativo — não há a quem atribuir a publicação");

  const publicacao = await publishFollowupFlowVersion(admin, {
    orgId,
    pointerId: pointer.id,
    graph,
    createdBy: membro.user_id,
  });
  if (!publicacao.ok) {
    throw new Error(`publicação falhou (${publicacao.code}): ${publicacao.message}`);
  }
  console.log(`  ✓ publicado — version ${publicacao.version_id}`);

  // Publicar grava status='active' dentro da função SQL. Se o pointer estava
  // desligado de propósito, devolver ao estado anterior é o padrão — religar é
  // decisão de quem roda, não efeito colateral de atualizar o texto.
  if (pointer.statusAnterior !== "active" && !ativar) {
    const { error } = await admin
      .from("followup_flow_pointers")
      .update({ status: pointer.statusAnterior, updated_at: new Date().toISOString() })
      .eq("id", pointer.id);
    if (error) throw new Error(`restauração do status do pointer: ${error.message}`);
    console.log(
      `  ↩ status devolvido para "${pointer.statusAnterior}" (publicar ativaria sozinho).\n` +
        "    Para ligar de verdade, rode de novo com --ativar.",
    );
  }

  console.log(
    `\nCadência atualizada: ${CADENCIA.length} toques em 45 dias — D2 bump, D5 ângulo\n` +
      "novo, D9 prova social, D14 curiosidade, D20 mostrar na prática, D27 padrão do\n" +
      "nicho, D35 pessoa certa, D45 despedida.\n" +
      "Respondeu em qualquer ponto, a cadência para sozinha.\n\n" +
      "ANTES DE LIGAR, três coisas — sem elas o histórico se repete:\n" +
      "  1. Crédito na Anthropic (console.anthropic.com). Sem saldo, todo toque\n" +
      "     morre e o sweep re-inscreve o mesmo lead a cada minuto.\n" +
      "  2. Um agente PUBLICADO da org com esta cadência marcada em follow-up\n" +
      "     (/app/ai/agents) — sem isso o fluxo existe e não enrolla ninguém.\n" +
      "  3. Rodar com --ativar para tirar o pointer de disabled.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
