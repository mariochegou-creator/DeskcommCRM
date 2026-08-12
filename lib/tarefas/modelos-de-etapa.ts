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

/** Amanhã às 9h (hora civil da Bahia) — o começo do próximo expediente. */
function amanhaAs9(agora: Date): Date {
  return instanteDaReuniao(dataCivilBahia(agora, 1), "09:00");
}

function daquiA(horas: number) {
  return (agora: Date) => new Date(agora.getTime() + horas * HORA_MS);
}

/** As colunas que têm checklist. Coluna fora desta lista não cria nada. */
export type EtapaDeModelo = "r1-agendada" | "r1-realizada" | "non-show";

/**
 * O checklist de cada coluna.
 *
 * Duas tarefas por coluna é teto deliberado: a terceira vira ruído, e lista de
 * tarefas com ruído é lista que ninguém abre — o mesmo caminho que o badge
 * percorreria se contasse tudo em aberto (ver `TarefasBadge`).
 */
const MODELOS: Record<EtapaDeModelo, readonly ModeloDeTarefa[]> = {
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
      prazo: amanhaAs9,
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
const REALIZADA_RE = /\b(realizad[ao]s?|feita|aconteceu)\b/;
const MARCADA_RE = /\b(agendad|marcad)/;
/** "Non Show", "No-show", "noshow" — o espaço é opcional porque o slug o come. */
const NO_SHOW_RE = /\bn[oa]n? ?show\b/;

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
 */
export function etapaDeModelo(etapa: EtapaComNome): EtapaDeModelo | null {
  for (const bruto of [etapa.slug, etapa.name]) {
    if (!bruto) continue;
    const texto = normalizar(bruto);
    if (NO_SHOW_RE.test(texto)) return "non-show";
    if (R1_RE.test(texto) && REALIZADA_RE.test(texto)) return "r1-realizada";
    if (R1_RE.test(texto) && MARCADA_RE.test(texto)) return "r1-agendada";
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
