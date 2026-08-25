/**
 * Filtro do Painel por número de WhatsApp.
 *
 * O vínculo negócio↔número não é uma coluna: vem do mapa que
 * /api/v1/metrics/lead-channels monta (lead → conexões que falaram com ele).
 * Aqui só se aplica o mapa, para a regra ficar testável sem rede e sem React.
 */

/** Sentinela do "sem filtro". Não é id de conexão nenhuma. */
export const TODOS_OS_NUMEROS = "todos";

/**
 * Sentinela dos negócios que ainda não têm conversa em lugar nenhum.
 *
 * Existe como opção porque esse é o balde da prospecção que ainda não saiu do
 * papel: sem ele, somar as fatias de cada número dá menos que o total e a tela
 * parece estar escondendo negócio.
 */
export const SEM_CONVERSA = "sem-conversa";

/**
 * Os negócios que passaram por um número.
 *
 * Um negócio pode aparecer em DOIS números (o lead entrou pela linha do SDR e
 * depois foi puxado pelo closer). Isso é de propósito: a pergunta que o seletor
 * responde é "o que passou por esta linha", e tirar o lead de uma das duas
 * apagaria trabalho que aconteceu.
 */
export function filtrarPorNumero<T extends { id: string }>(
  leads: T[],
  byLead: Record<string, string[]>,
  numeroId: string,
): T[] {
  if (numeroId === TODOS_OS_NUMEROS) return leads;
  if (numeroId === SEM_CONVERSA) {
    return leads.filter((l) => (byLead[l.id]?.length ?? 0) === 0);
  }
  return leads.filter((l) => byLead[l.id]?.includes(numeroId) ?? false);
}
