/**
 * O MATERIAL da reunião — o roteiro que o closer recebe no WhatsApp uma hora
 * antes, quando responde "sim" ao aviso interno.
 *
 * POR QUE EXISTE: até 20/08/2026 preparar a R1 era um pedido manual ("me monta
 * o roteiro do fulano") repetido antes de cada reunião. O aviso de uma hora
 * antes já sabia com quem é a reunião; faltava fechar o ciclo — perguntar,
 * ouvir a resposta e entregar.
 *
 * POR QUE PERGUNTA em vez de mandar sozinho (decisão do Mario): "às vezes não
 * compensa fazer o material, porque o lead não vai comparecer". Uma pergunta
 * custa uma palavra de resposta; um roteiro gerado para uma call que não
 * acontece custa LLM e atenção.
 *
 * Módulo PURO (sem I/O) de propósito, como o resto de lib/agendamento: quem
 * chama é o cron, e as regras de "isto é um sim?" e "o dossiê tem o quê?"
 * precisam ser testáveis sem banco, sem relógio e sem chave de IA.
 * O I/O — ler notas, chamar o modelo, gravar — vive em `material-gerar.ts`.
 */
import { extractExtras, extractGanchos } from "@/lib/leads/ganchos";

import { formatarReuniao, ROTULO_DO_TIPO, type Reuniao, type RoteiroDaReuniao } from "./reuniao";

/** O que o closer respondeu ao aviso. `null` = não é resposta a esta pergunta. */
export type RespostaDoCloser = "sim" | "nao";

/**
 * Tira acento, pontuação e emoji. É o que faz "Sim!!" , "sim 👍" e "SIM"
 * caírem todos no mesmo balde — o closer responde de dentro do WhatsApp, no
 * meio de outra coisa, e nunca do jeito canônico.
 */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * As negativas. Testadas ANTES das afirmativas, e a razão está na lista:
 * "pode deixar" contém "pode", que é um sim. Invertendo a ordem, dispensar o
 * material geraria o material.
 */
const NAO_RE =
  /^(nao|n|nops|nem|agora nao|hoje nao|depois|deixa|deixa pra depois|pode deixar|nao precisa|precisa nao|nao quero|quero nao|nao precisa nao|deixa quieto|dispensa|ja tenho|ja preparei|nao vai ter|foi cancelada|cancelou)\b/;

/**
 * As afirmativas. Só valem no COMEÇO da mensagem: "não sei se sim" começa com
 * "nao" e é pego acima; já "amanhã eu vejo, mas manda" não é resposta a nada —
 * quem quer o material responde curto.
 */
const SIM_RE =
  /^(s|si|sim|isso|claro|manda|manda sim|pode|pode sim|pode mandar|quero|quero sim|faz|prepara|preparar|prepare|bora|vai|positivo|aham|uhum|ok|blz|beleza|by|top|show|perfeito|com certeza|por favor|pfv|manda ai|manda ae)\b/;

/**
 * Mensagem longa não é resposta — é assunto novo. O teto existe porque o
 * closer usa a MESMA conversa para outras coisas, e um texto de dois parágrafos
 * que por acaso comece com "ok" não pode disparar a geração do roteiro.
 */
const TETO_DA_RESPOSTA = 60;

/** O closer respondeu o quê? `null` quando a mensagem não é uma resposta. */
export function interpretarResposta(texto: string | null | undefined): RespostaDoCloser | null {
  if (!texto) return null;
  const limpo = normalizar(texto);
  if (!limpo || limpo.length > TETO_DA_RESPOSTA) return null;
  if (NAO_RE.test(limpo)) return "nao";
  if (SIM_RE.test(limpo)) return "sim";
  return null;
}

/** O link do roteiro completo, o que vai no fim da mensagem de WhatsApp. */
export function linkDoRoteiro(baseUrl: string, leadId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/app/reuniao/${leadId}`;
}

/** Tudo que se sabe do lead antes de escrever o roteiro. */
export interface DadosDoLead {
  leadId: string;
  negocio: string | null;
  contato: string | null;
  descricao: string | null;
  tags: string[];
  /** `crm_leads.custom_fields` cru — ganchos e dossiê saem daqui. */
  customFields: unknown;
  /** Notas do lead, da mais recente para a mais antiga. */
  notas: string[];
  /** A conversa do inbox, em ordem cronológica. */
  conversa: Array<{ de: "lead" | "nos"; texto: string }>;
}

function bloco(titulo: string, linhas: string[]): string[] {
  if (linhas.length === 0) return [];
  return [`${titulo}:`, ...linhas.map((l) => `- ${l}`), ""];
}

/**
 * O dossiê que vai no prompt — tudo que o CRM já sabe deste negócio, em texto
 * corrido.
 *
 * Sem invenção e sem web: o material é feito do que está REGISTRADO no card.
 * É a mesma regra que vale para a prospecção — o que não está no CRM não entra
 * no roteiro, porque roteiro com dado adivinhado é o que faz o closer afirmar,
 * na frente do dono do negócio, uma coisa que não é verdade.
 */
export function montarDossie(dados: DadosDoLead, reuniao: Reuniao): string {
  const q = formatarReuniao(new Date(reuniao.em));
  const ganchos = extractGanchos(dados.customFields);
  const extras = extractExtras(dados.customFields);

  const partes: string[] = [
    `Reunião: ${ROTULO_DO_TIPO[reuniao.tipo]} — ${q.diaDaSemana}, ${q.diaMes}, às ${q.hora}.`,
    `Negócio: ${(dados.negocio ?? "").trim() || "(card sem nome)"}`,
    `Pessoa: ${(dados.contato ?? "").trim() || "(sem nome no cadastro)"}`,
    "",
  ];

  if (dados.descricao?.trim()) partes.push(`Descrição do card: ${dados.descricao.trim()}`, "");
  partes.push(...bloco("Tags", dados.tags));
  partes.push(...bloco("Ganchos usados na prospecção", ganchos));
  partes.push(...bloco("Dossiê da prospecção", extras.map(([k, v]) => `${k}: ${v}`)));
  partes.push(...bloco("Notas internas (mais recente primeiro)", dados.notas));
  partes.push(
    ...bloco(
      "Conversa no WhatsApp",
      dados.conversa.map((m) => `${m.de === "lead" ? "Lead" : "Nós"}: ${m.texto}`),
    ),
  );

  return partes.join("\n").trim();
}

/**
 * O que o modelo tem de saber para escrever um roteiro que serve à NEXO, e não
 * um roteiro genérico de agência.
 *
 * As regras aqui são as mesmas que a operação já segue: cidade pequena, verba
 * curta, prova antes de preço, e o primeiro toque falando do NEGÓCIO do cliente
 * — nunca de como o site dele é feio.
 */
export const SISTEMA_DO_MATERIAL = `Você prepara o roteiro de reuniões de venda consultiva da NEXO IA, uma agência
de marketing e automação com IA para negócios locais do interior da Bahia
(loja de peças, imobiliária, energia solar, poço artesiano, salão, mercado).

O cliente típico: dono de negócio pequeno, pouca verba, muitas vezes sem site e
com o Instagram parado. Ele não é técnico — o roteiro tem de soar como conversa
de gente, não como consultoria.

Como a NEXO vende:
- Metodologia SPIN Selling na R1 (Situação, Problema, Implicação, Necessidade).
- Prova antes de preço: o demo ou o vídeo vem ANTES de falar em valor.
- Sempre a rota mais barata que já entrega resultado; a rota cara só quando o
  próprio cliente mostrar que o caso pede.
- Um preço só na proposta, na ordem de prioridade que o cliente deu.

Regras do roteiro:
1. Use SOMENTE o que está no dossiê. Não invente faturamento, número de
   funcionários, concorrente, nota do Google nem nada que não esteja escrito.
2. Quando faltar um dado importante, transforme a falta em PERGUNTA — é para
   isso que a reunião existe.
3. Perguntas curtas, uma ideia por pergunta, do jeito que se fala.
4. As perguntas de Implicação têm de puxar número (quantos por mês, quanto
   custa cada um, há quanto tempo) — sem número não há urgência.
5. Nada de jargão: nunca escreva "funil", "lead", "conversão", "presença
   digital" ou "solução" no texto que vai ser falado com o cliente.`;

/** O pedido, com o dossiê dentro. Formato JSON porque a resposta é lida por código. */
export function promptDoMaterial(dossie: string, reuniao: Reuniao): string {
  return `Prepare o material da ${ROTULO_DO_TIPO[reuniao.tipo]} abaixo.

=== DOSSIÊ ===
${dossie}
=== FIM DO DOSSIÊ ===

Responda SOMENTE com um JSON neste formato, sem cercas de código e sem texto
antes ou depois:

{
  "resumo": "quem é esse negócio, em no máximo 2 frases",
  "dor": "a dor mais provável, em 1 frase, do jeito que o dono dela falaria",
  "gancho": "por onde abrir a conversa, em 1 frase — sobre o NEGÓCIO dele",
  "perguntas": ["as 5 perguntas que não podem faltar, na ordem de uso"],
  "situacao": ["3 a 5 perguntas de Situação"],
  "problema": ["3 a 5 perguntas de Problema"],
  "implicacao": ["3 a 5 perguntas de Implicação, com número"],
  "necessidade": ["2 a 4 perguntas de Necessidade"],
  "proximo_passo": "o que propor no fim da reunião, em 1 frase",
  "atencao": "o que evitar nesta conversa específica, em 1 frase (ou null)"
}`;
}

function linhas(raw: unknown, teto: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, teto);
}

function texto(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Lê a resposta do modelo. Devolve `null` quando o mínimo não veio — e o
 * mínimo é resumo + pelo menos uma pergunta.
 *
 * Tolera a cerca de código porque ela aparece de vez em quando mesmo com o
 * pedido explícito, e um roteiro perdido por três crases seria um material que
 * não sai a uma hora da reunião.
 */
export function parseMaterial(bruto: string, agora: Date): RoteiroDaReuniao | null {
  const semCerca = bruto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;

  let obj: Record<string, unknown>;
  try {
    const lido: unknown = JSON.parse(semCerca.slice(inicio, fim + 1));
    if (!lido || typeof lido !== "object" || Array.isArray(lido)) return null;
    obj = lido as Record<string, unknown>;
  } catch {
    return null;
  }

  const perguntas = linhas(obj.perguntas, 5);
  const resumo = texto(obj.resumo);
  if (!resumo || perguntas.length === 0) return null;

  return {
    gerado_em: agora.toISOString(),
    resumo,
    dor: texto(obj.dor),
    gancho: texto(obj.gancho),
    perguntas,
    situacao: linhas(obj.situacao, 6),
    problema: linhas(obj.problema, 6),
    implicacao: linhas(obj.implicacao, 6),
    necessidade: linhas(obj.necessidade, 6),
    proximo_passo: texto(obj.proximo_passo),
    atencao: texto(obj.atencao) || null,
  };
}

/**
 * O material de RESERVA: montado só com o card, sem chamar modelo nenhum.
 *
 * Existe porque a chave de IA já faltou em produção mais de uma vez, e o
 * momento em que ela falta é sempre o pior possível — uma hora antes da
 * reunião. Roteiro genérico com o gancho certo é infinitamente melhor que um
 * "não consegui gerar" a caminho da call.
 *
 * Vem marcado com `reserva: true`, e a mensagem diz isso: material que não foi
 * pensado no negócio não pode se passar por material que foi.
 */
export function materialDeReserva(dados: DadosDoLead, agora: Date): RoteiroDaReuniao {
  const negocio = (dados.negocio ?? "").trim() || "o negócio";
  const ganchos = extractGanchos(dados.customFields);
  const extras = extractExtras(dados.customFields);
  const dores = extras.find(([k]) => /dor/i.test(k))?.[1] ?? "";
  const cidade = extras.find(([k]) => /cidade|munic/i.test(k))?.[1] ?? "";

  return {
    gerado_em: agora.toISOString(),
    resumo: [negocio, cidade && `em ${cidade}`].filter(Boolean).join(", ") + ".",
    dor: dores || "não consta no card — descobrir na conversa.",
    gancho: ganchos[0] ?? "o atendimento do dia a dia dele.",
    perguntas: [
      `Como chega cliente hoje no ${negocio}?`,
      "Quantas pessoas te chamam por semana no WhatsApp?",
      "Quantas dessas você consegue responder no mesmo dia?",
      "O que acontece com quem você não consegue responder?",
      "Se isso estivesse resolvido, quanto mudaria no mês?",
    ],
    situacao: [
      "Quem cuida do WhatsApp aí no dia a dia?",
      "Vocês atendem em que horário?",
      "Como as pessoas te acham hoje?",
      "Você anota de onde veio cada cliente?",
    ],
    problema: [
      "Cliente já reclamou de demora pra responder?",
      "Já perdeu venda porque não viu a mensagem a tempo?",
      "Fim de semana e horário de almoço, quem responde?",
    ],
    implicacao: [
      "Quantas mensagens por semana ficam sem resposta?",
      "Quanto vale, em média, uma venda dessas?",
      "Há quanto tempo isso acontece?",
      "Somando o mês, quanto isso dá?",
    ],
    necessidade: [
      "Se alguém respondesse na hora, todo dia, o que mudava aí?",
      "Vale mais resolver o atendimento ou aparecer pra mais gente?",
    ],
    proximo_passo: "Fechar a próxima conversa com a proposta pronta, na prioridade que ele deu.",
    atencao: "Material montado direto do card — confirmar tudo na conversa antes de afirmar.",
    reserva: true,
  };
}
