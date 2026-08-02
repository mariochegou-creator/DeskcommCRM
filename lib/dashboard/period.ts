/**
 * Janelas de período do painel e da lista de negócios.
 *
 * Cada período carrega a sua JANELA ANTERIOR de mesmo comprimento, porque toda
 * variação percentual da tela é "este período vs. o anterior equivalente".
 * Comparar um mês corrido com um mês cheio infla a queda todo dia 1º — por isso
 * `month` compara o mês até HOJE com o mês passado ATÉ O MESMO DIA, e não com
 * o mês passado inteiro.
 */
export type PeriodId = "7d" | "30d" | "month" | "quarter";

export interface PeriodRange {
  from: Date;
  to: Date;
  /** Janela anterior, do mesmo comprimento, imediatamente antes de `from`. */
  prevFrom: Date;
  prevTo: Date;
}

export const PERIOD_OPTIONS: Array<{ id: PeriodId; label: string }> = [
  { id: "7d", label: "Últimos 7 dias" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "month", label: "Este mês" },
  { id: "quarter", label: "Este trimestre" },
];

export const PERIOD_COMPARISON_LABEL: Record<PeriodId, string> = {
  "7d": "vs. 7 dias anteriores",
  "30d": "vs. 30 dias anteriores",
  month: "vs. mesmo ponto do mês anterior",
  quarter: "vs. trimestre anterior",
};

/**
 * `now` é PARÂMETRO e não `new Date()` interno para o cálculo ser puro e
 * testável — e para o componente poder congelar o instante do render, senão
 * dois KPIs da mesma tela podem cair em lados opostos da virada do dia.
 */
export function periodRange(id: PeriodId, now: Date): PeriodRange {
  const to = now;

  if (id === "7d" || id === "30d") {
    const days = id === "7d" ? 7 : 30;
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    const prevTo = from;
    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - days);
    return { from, to, prevFrom, prevTo };
  }

  if (id === "month") {
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    const prevFrom = new Date(to.getFullYear(), to.getMonth() - 1, 1);
    // Mesmo ponto do mês anterior. O construtor de Date normaliza estouro (31
    // de fevereiro vira 2/3), o que é o comportamento certo aqui: a janela
    // anterior nunca invade o mês corrente.
    const prevTo = new Date(
      to.getFullYear(),
      to.getMonth() - 1,
      to.getDate(),
      to.getHours(),
      to.getMinutes(),
    );
    return { from, to, prevFrom, prevTo };
  }

  const quarterStartMonth = Math.floor(to.getMonth() / 3) * 3;
  const from = new Date(to.getFullYear(), quarterStartMonth, 1);
  const prevFrom = new Date(to.getFullYear(), quarterStartMonth - 3, 1);
  const prevTo = from;
  return { from, to, prevFrom, prevTo };
}

/** Variação percentual de `prev` para `curr`, já arredondada a 1 casa. */
export function percentChange(curr: number, prev: number): number | undefined {
  // Sem base não há percentual: "de 0 para 7" não é +700%, é infinito. Devolver
  // `undefined` faz o StatCard esconder o pill, que é honesto — um "+100%"
  // inventado aqui viraria a métrica mais bonita do painel sem significar nada.
  if (prev === 0) return undefined;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export function inRange(iso: string | null, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}
