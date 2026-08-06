/**
 * Cadência anti-vácuo — o fluxo de follow-up da prospecção fria (Nexo IA).
 *
 * O lead recebe a abordagem e some. O Cofre de Abordagens chama isso de vácuo e
 * dá a cadência que reabre: D2 bump suave, D5 ângulo novo, D9 prova social,
 * D14 a última mensagem. Depois disso PARA — insistir além do D14 não reabre
 * nada, só queima o número.
 *
 * Este script monta esse fluxo e publica. Idempotente por `(organization_id,
 * name)`: rodar de novo republica a mesma cadência em vez de criar uma segunda.
 *
 *   npx tsx scripts/seed-cadencia-anti-vacuo.ts --org <uuid>
 *   npx tsx scripts/seed-cadencia-anti-vacuo.ts --org <uuid> --dry-run
 *
 * ⚠️ DUAS DECISÕES QUE NÃO SÃO ÓBVIAS NO GRAFO:
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

/**
 * O sweep de silêncio entrega o lead no D2 — daí o threshold. Os toques
 * seguintes contam a partir dele: D5, D9, D14.
 */
const D2_MINUTOS = 2 * 24 * 60;
const GRACE_D2_PARA_D5 = 3 * DIA_MS;
const GRACE_D5_PARA_D9 = 4 * DIA_MS;
const GRACE_D9_PARA_D14 = 5 * DIA_MS;

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
    title: "Anti-vácuo D14 — a última mensagem",
    shortcut: "/vacuo-d14",
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
    CRIVO,
  d14:
    "Última mensagem, 14 dias depois. É despedida, não cobrança: reconheça que " +
    "não é o momento, diga que vai parar de escrever para não incomodar, e deixe " +
    "a porta aberta. Não faça pergunta de venda e não peça retorno. É a mensagem " +
    "que mais reabre conversa morta justamente por não pedir nada. " +
    CRIVO,
};

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
    toque("d2", 200),
    espera("d2", GRACE_D2_PARA_D5, 400),
    toque("d5", 600),
    espera("d5", GRACE_D5_PARA_D9, 800),
    toque("d9", 1000),
    espera("d9", GRACE_D9_PARA_D14, 1200),
    toque("d14", 1400),
    {
      id: "fim_sem_resposta",
      type: "end",
      label: "Esgotou os 4 toques",
      position: { x: 1600, y: 0 },
      config: { outcome: "exhausted", note: "14 dias sem resposta — cadência encerrada" },
    },
    {
      id: "fim_respondeu",
      type: "end",
      label: "Lead respondeu",
      position: { x: 800, y: 200 },
      config: { outcome: "converted", note: "Respondeu: sai da cadência, o atendimento assume" },
    },
  ];

  const edges: FlowGraph["edges"] = [
    { id: "e_inicio", source: "inicio", target: "envia_d2", priority: 0, condition: { type: "always" } },
  ];

  // Cada espera tem 3 saídas: respondeu → fim; no_reply → próximo toque;
  // always → o MESMO próximo toque. A `always` é exigida como fallback
  // (missing_always_fallback) e existe para o caso de o classify devolver algo
  // fora do vocabulário: melhor seguir a cadência do que travar o enrollment.
  const seguinte: Array<[ChaveTemplate, string]> = [
    ["d2", "envia_d5"],
    ["d5", "envia_d9"],
    ["d9", "envia_d14"],
  ];
  for (const [chave, proximo] of seguinte) {
    const envia = `envia_${chave}`;
    const espera_ = `espera_${chave}`;
    edges.push(
      { id: `e_${chave}_espera`, source: envia, target: espera_, priority: 0, condition: { type: "always" } },
      {
        id: `e_${chave}_respondeu`,
        source: espera_,
        target: "fim_respondeu",
        priority: 10,
        condition: { type: "class_match", value: "respondeu" },
      },
      {
        id: `e_${chave}_sem_resposta`,
        source: espera_,
        target: proximo,
        priority: 5,
        condition: { type: "class_match", value: "no_reply" },
      },
      { id: `e_${chave}_fallback`, source: espera_, target: proximo, priority: 0, condition: { type: "always" } },
    );
  }

  // O D14 não tem espera depois: é a última mensagem, e o Cofre é explícito
  // que ela não pede retorno. Encerra direto.
  edges.push({
    id: "e_d14_fim",
    source: "envia_d14",
    target: "fim_sem_resposta",
    priority: 0,
    condition: { type: "always" },
  });

  return { nodes, edges };
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

async function upsertPointer(admin: SupabaseClient, orgId: string, graph: FlowGraph): Promise<string> {
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
    .select("id")
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
    console.log(`  ~ fluxo "${NOME_DO_FLUXO}" atualizado`);
    return existente.id;
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
  return data.id;
}

async function main(): Promise<void> {
  const orgId = argOf("--org");
  const dryRun = process.argv.includes("--dry-run");

  // O dry-run roda ANTES de tocar em env ou banco: ele valida a ESTRUTURA do
  // grafo, e estrutura não depende de credencial nem de org. Assim dá pra
  // conferir a cadência numa máquina sem .env.local nenhum.
  if (dryRun) {
    // Ids de template falsos: a validação estrutural não os resolve, e os
    // reais não mudariam o resultado.
    const falsos = Object.fromEntries(
      TEMPLATES.map((t, i) => [t.chave, `00000000-0000-4000-8000-00000000000${i + 1}`]),
    ) as Record<ChaveTemplate, string>;
    const validacao = validateFlowForPublish(montarGrafo(falsos));
    if (!validacao.ok) {
      console.error("dry-run: grafo REPROVADO na validação:");
      for (const e of validacao.errors) console.error(`  [${e.code}] ${e.node_id ?? "-"}: ${e.message}`);
      process.exit(1);
    }
    console.log("dry-run: grafo válido para publicação. Nada foi escrito.");
    return;
  }

  if (!orgId) {
    console.error("uso: npx tsx scripts/seed-cadencia-anti-vacuo.ts --org <uuid> [--dry-run]");
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
  const templateIds = await upsertTemplates(admin, orgId);

  const graph = montarGrafo(templateIds);
  const validacao = validateFlowForPublish(graph);
  if (!validacao.ok) {
    console.error("\nGrafo REPROVADO na validação — nada foi publicado:");
    for (const e of validacao.errors) console.error(`  [${e.code}] ${e.node_id ?? "-"}: ${e.message}`);
    process.exit(1);
  }

  console.log("\nFluxo:");
  const pointerId = await upsertPointer(admin, orgId, graph);

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
    pointerId,
    graph,
    createdBy: membro.user_id,
  });
  if (!publicacao.ok) {
    throw new Error(`publicação falhou (${publicacao.code}): ${publicacao.message}`);
  }
  console.log(`  ✓ publicado — version ${publicacao.version_id}`);

  console.log(
    "\nCadência no ar: D2 bump, D5 ângulo novo, D9 prova social, D14 despedida.\n" +
      "Respondeu em qualquer ponto, a cadência para sozinha.\n\n" +
      "FALTA UM PASSO, e sem ele nada dispara: o fluxo só enrolla lead se um\n" +
      "agente PUBLICADO da org tiver esta cadência habilitada. Abra o agente em\n" +
      "/app/ai/agents, marque este fluxo em follow-up e publique uma versão.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
