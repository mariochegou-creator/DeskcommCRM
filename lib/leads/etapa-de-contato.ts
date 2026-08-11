/**
 * Qual etapa do Kanban significa "alguém JÁ falou com este lead".
 *
 * O gatilho é o card entrar nessa coluna: quem arrastou foi quem contatou, então
 * é ele que passa a ser o responsável pelo negócio (rota `leads/[id]/move`).
 *
 * Pelo mesmo motivo de `lib/agendamento/etapa.ts`, a leitura é pelo TEXTO e não
 * por um slug fixo: hoje o funil de prospecção da NEXO tem `a-contatar` e
 * `contatado`, mas etapa se renomeia na tela e cada tenant escreve o funil no
 * vocabulário dele. Um `slug === "contatado"` hard-coded morreria calado no dia
 * da troca — sem erro, só sem dono, que é o modo de falha que este arquivo
 * existe para evitar.
 *
 * A regra é o PARTICÍPIO: "Contatado" é contato feito, "A contatar" é contato
 * pendente. A distinção inteira mora nessa letra — e as duas colunas convivem
 * lado a lado no mesmo funil, então errar aqui é atribuir dono na fila de
 * espera.
 *
 * Módulo puro: a rota decide, este arquivo só julga o nome.
 */

/** Sem acento, minúsculo, separadores virando espaço. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-_./]+/g, " ")
    .trim();
}

/** "Contatado", "Contactada", "Leads contatados" — o particípio, nunca o infinitivo. */
const CONTATO_FEITO_RE = /\bcontac?tad[oa]s?\b/;

/**
 * "Não contatado" tem o particípio e diz exatamente o contrário. Vale para a
 * etapa inteira (nome E slug): basta uma das duas metades negar.
 */
const NEGADO_RE = /\bnao\b/;

export interface EtapaComNome {
  name?: string | null;
  slug?: string | null;
}

/**
 * Esta etapa afirma que o contato já foi feito?
 *
 * "Primeiro contato" de propósito NÃO conta: no funil semeado por padrão ela é a
 * PRIMEIRA coluna, onde o lead nasce ao chegar — ninguém falou com ninguém, e
 * atribuir dono ali daria o negócio a quem só organizou o quadro.
 */
export function etapaMarcaContatoFeito(etapa: EtapaComNome): boolean {
  let marca = false;
  for (const bruto of [etapa.slug, etapa.name]) {
    if (!bruto) continue;
    const texto = normalizar(bruto);
    if (NEGADO_RE.test(texto)) return false;
    if (CONTATO_FEITO_RE.test(texto)) marca = true;
  }
  return marca;
}
