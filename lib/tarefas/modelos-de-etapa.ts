/**
 * O checklist que nasce sozinho quando o card entra numa coluna.
 *
 * Hoje esse checklist mora na cabeça de quem arrasta: o card entra em «R1
 * agendada» e alguém tem de lembrar de montar o roteiro; entra em «Non Show» e
 * alguém tem de lembrar de ligar para remarcar. Lembrar é justamente o que
 * falha às 17h de uma sexta com 40 cards no quadro — e o lead esfria sem que
 * nada no CRM registre que havia um passo pendente.
 *
 * Três decisões que o código sozinho não explica:
 *
 * 1. **Sem IA.** O que fazer depois de cada etapa é regra da operação, não
 *    julgamento: a mesma coluna pede sempre as mesmas duas coisas. Uma chamada
 *    de modelo aqui custaria dinheiro, latência e — pior — variaria o texto
 *    entre dois cards iguais, quebrando a deduplicação por título.
 *
 * 2. **A leitura é pelo TEXTO da etapa**, como em `lib/agendamento/etapa.ts` e
 *    `lib/leads/etapa-de-contato.ts`. Etapa se renomeia na tela e cada tenant
 *    escreve o funil no vocabulário dele; um `slug === "r1_realizada"` fixo
 *    morreria calado no dia da troca — sem erro, só sem tarefa.
 *
 * 3. **O prazo sai do relógio do arrasto, nunca da reunião.** Quando o card
 *    entra em «R1 agendada» a reunião AINDA NÃO TEM HORA (o dialog que pergunta
 *    dia e hora abre depois do move). Amarrar a tarefa numa hora que não existe
 *    daria prazo nulo ou inventado. As antecedências da reunião («ligar 5h
 *    antes») continuam nascendo no dialog de agendamento, que é onde a hora
 *    finalmente existe.
 *
 * Módulo PURO: a rota de move grava, os testes conferem, e `agora` sempre entra
 * por parâmetro.
 */
import { dataCivilBahia, instanteDaReuniao } from "@/lib/agendamento/reuniao";
import { MAX_TITULO, type TipoDeTarefa } from "@/lib/tarefas/tarefa";

/**
 * Quem faz o quê na operação — o papel, não a pessoa.
 *
 * A pessoa muda (entra gente, sai gente, alguém tira férias); o papel não. Quem
 * traduz papel → pessoa é `organizations.settings.papeis`, lido na hora de
 * gravar. Sem essa tradução configurada, a tarefa fica com quem arrastou o card
 * — visível e resolvível, que é melhor do que nascer órfã.
 */
export type PapelDaTarefa = "closer" | "sdr";

export interface ModeloDeTarefa {
  /** Estável — serve de identidade nos testes e na auditoria. */
  chave: string;
  /** O que fazer, sem o nome do lead. `tituloDaTarefa` cola os dois. */
  oQue: string;
  kind: TipoDeTarefa;
  papel: PapelDaTarefa;
  prazo: (agora: Date) => Date;
}

const HORA_MS = 60 * 60 * 1000;
const MINUTO_MS = 60 * 1000;

/**
 * Hoje às 18h — ou daqui a duas horas, quando as 18h já passaram.
 *
 * Tarefa que nasce vencida é ruído: ela entra direto no vermelho do menu sem
 * ninguém ter tido chance de fazê-la. A folga de 30 minutos evita o caso de
 * borda de arrastar o card às 17h58.
 */
function hojeAs18(agora: Date): Date {
  const alvo = instanteDaReuniao(dataCivilBahia(agora), "18:00");
  return alvo.getTime() > agora.getTime() + 30 * MINUTO_MS
    ? alvo
    : new Date(agora.getTime() + 2 * HORA_MS);
}

/**
 * Daqui a `dias` dias, às 9h civis da Bahia — o começo daquele expediente.
 *
 * Hora civil e não `agora + 48h`: prazo de vários dias cai em hora arbitrária
 * quando sai do relógio do arrasto (arrastar às 23h põe o follow-up vencendo às
 * 23h), e a aba Tarefas ordena por prazo. Com 9h, o que vence naquele dia
 * aparece junto, na ordem em que se trabalha.
 */
function emDiasAs9(dias: number) {
  return (agora: Date) => instanteDaReuniao(dataCivilBahia(agora, dias), "09:00");
}

function daquiA(horas: number) {
  return (agora: Date) => new Date(agora.getTime() + horas * HORA_MS);
}

/** As colunas que têm checklist. Coluna fora desta lista não cria nada. */
export type EtapaDeModelo =
  | "respondeu"
  | "r1-agendada"
  | "r1-realizada"
  | "r2-realizada"
  | "non-show"
  | "flow-up";

/**
 * O checklist de cada coluna.
 *
 * Duas tarefas por coluna é teto deliberado: a terceira vira ruído, e lista de
 * tarefas com ruído é lista que ninguém abre — o mesmo caminho que o badge
 * percorreria se contasse tudo em aberto (ver `TarefasBadge`).
 */
const MODELOS: Record<EtapaDeModelo, readonly ModeloDeTarefa[]> = {
  /**
   * Uma tarefa só, e de propósito.
   *
   * «Respondeu» é o momento mais quente do funil: o lead falou e a janela é de
   * horas. A segunda tarefa que se pensa em pôr aqui («insistir se não marcou»)
   * nasce obsoleta na hora em que a R1 é agendada — e é justamente a coluna
   * seguinte que já cobra o preparo. Tarefa que costuma nascer resolvida é o
   * ruído que faz a lista inteira parar de ser lida.
   */
  respondeu: [
    {
      chave: "respondeu-puxar-r1",
      oQue: "Puxar para a R1",
      kind: "mensagem",
      papel: "sdr",
      prazo: hojeAs18,
    },
  ],
  "r1-agendada": [
    {
      chave: "r1-roteiro",
      oQue: "Preparar roteiro da R1",
      kind: "reuniao",
      papel: "closer",
      prazo: hojeAs18,
    },
    {
      chave: "r1-levantamento",
      oQue: "Levantar site, Instagram e avaliações",
      kind: "nota",
      papel: "closer",
      prazo: hojeAs18,
    },
  ],
  "r1-realizada": [
    {
      chave: "r2-marcar",
      oQue: "Marcar a R2",
      kind: "mensagem",
      papel: "closer",
      prazo: hojeAs18,
    },
    {
      chave: "r2-apn",
      oQue: "Montar a APN (proposta)",
      kind: "outro",
      papel: "closer",
      prazo: emDiasAs9(1),
    },
  ],
  /**
   * A proposta já foi apresentada. As duas coisas que somem aqui: a objeção
   * exata (que é o que o follow-up precisa citar) e o próprio follow-up.
   */
  "r2-realizada": [
    {
      chave: "r2-registrar",
      oQue: "Anotar a objeção e o que ficou combinado",
      kind: "nota",
      papel: "closer",
      prazo: hojeAs18,
    },
    {
      chave: "r2-followup",
      oQue: "Follow-up da proposta",
      kind: "mensagem",
      papel: "closer",
      prazo: emDiasAs9(2),
    },
  ],
  /**
   * A coluna onde o negócio apodrece. A segunda tarefa é a que impede isso: uma
   * DATA em que alguém decide insistir ou dar por perdido. Sem ela, «Flow up»
   * vira depósito — o cartão fica lá, ninguém o move, e ninguém o mata.
   */
  "flow-up": [
    {
      chave: "flowup-mandar",
      oQue: "Mandar o follow-up",
      kind: "mensagem",
      papel: "closer",
      prazo: hojeAs18,
    },
    {
      chave: "flowup-decidir",
      oQue: "Decidir: insiste ou marca como perdido",
      kind: "outro",
      papel: "closer",
      prazo: emDiasAs9(5),
    },
  ],
  "non-show": [
    {
      chave: "noshow-ligar",
      oQue: "Ligar para remarcar",
      kind: "ligar",
      papel: "sdr",
      prazo: daquiA(1),
    },
    {
      chave: "noshow-mensagem",
      oQue: "Mandar mensagem de remarcação",
      kind: "mensagem",
      papel: "sdr",
      prazo: daquiA(3),
    },
  ],
};

/** Sem acento, minúsculo, separadores virando espaço. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-_./]+/g, " ")
    .trim();
}

const R1_RE = /\br1\b/;
const R2_RE = /\br2\b/;
const REALIZADA_RE = /\b(realizad[ao]s?|feita|aconteceu)\b/;
const MARCADA_RE = /\b(agendad|marcad)/;
/** "Non Show", "No-show", "noshow" — o espaço é opcional porque o slug o come. */
const NO_SHOW_RE = /\bn[oa]n? ?show\b/;
/** "Respondeu", "Respondeu no WhatsApp" — o lead falou. */
const RESPONDEU_RE = /\brespondeu\b/;
/**
 * "Flow up" é como a coluna se chama no funil da NEXO — é "follow up" escrito
 * de ouvido, e renomear a coluna para consertar a grafia quebraria o histórico
 * de quem já a usa. As duas formas entram aqui, com o espaço opcional.
 */
const FLOW_UP_RE = /\b(flow|follow) ?up\b/;

export interface EtapaComNome {
  name?: string | null;
  slug?: string | null;
}

/**
 * A qual checklist esta coluna corresponde, ou `null` quando a nenhum.
 *
 * «Realizada» é testada ANTES de «agendada» de propósito: as duas colunas
 * dizem "R1" e convivem lado a lado no mesmo funil. Errar aqui criaria o
 * preparo da reunião no dia em que ela já aconteceu.
 *
 * «Non Show» continua em primeiro: ela também é uma reunião que não aconteceu,
 * e o nome de um tenant pode carregar as duas palavras ("R1 — Non Show").
 */
export function etapaDeModelo(etapa: EtapaComNome): EtapaDeModelo | null {
  for (const bruto of [etapa.slug, etapa.name]) {
    if (!bruto) continue;
    const texto = normalizar(bruto);
    if (NO_SHOW_RE.test(texto)) return "non-show";
    if (FLOW_UP_RE.test(texto)) return "flow-up";
    if (R2_RE.test(texto) && REALIZADA_RE.test(texto)) return "r2-realizada";
    if (R1_RE.test(texto) && REALIZADA_RE.test(texto)) return "r1-realizada";
    if (R1_RE.test(texto) && MARCADA_RE.test(texto)) return "r1-agendada";
    if (RESPONDEU_RE.test(texto)) return "respondeu";
  }
  return null;
}

/** O checklist da coluna — lista vazia quando ela não tem nenhum. */
export function modelosDaEtapa(etapa: EtapaComNome): readonly ModeloDeTarefa[] {
  const chave = etapaDeModelo(etapa);
  return chave ? MODELOS[chave] : [];
}

/**
 * O título que vai para a tabela: "Preparar roteiro da R1 — GNG Solar".
 *
 * O nome do lead entra no TÍTULO porque é ele que a aba Tarefas mostra em lista
 * — sem o nome, cinco cards em «Non Show» viram cinco linhas idênticas. E é este
 * mesmo texto que serve de trava contra duplicata: arrastar o card para fora e
 * de volta não pode empilhar uma segunda cópia da mesma tarefa.
 */
export function tituloDaTarefa(modelo: ModeloDeTarefa, nomeDoLead: string | null): string {
  const nome = (nomeDoLead ?? "").trim();
  const titulo = nome.length > 0 ? `${modelo.oQue} — ${nome}` : modelo.oQue;
  return titulo.slice(0, MAX_TITULO);
}
