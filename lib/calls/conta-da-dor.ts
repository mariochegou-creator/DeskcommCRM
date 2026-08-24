/**
 * A conta do passo "número" — aula 05 do Caderno da Ligação Fria.
 *
 * O caderno manda fechar a conta com os números DELE, em voz alta e devagar:
 * "duas por semana, oito no mês, R$ 800 cada — isso dá R$ 6.400 por mês só de
 * gente esperando resposta. É mais ou menos isso?" E então esperar ele
 * confirmar.
 *
 * POR QUE A CONTA MORA AQUI E NÃO NO PROMPT. Antes ela existia só como exemplo
 * dentro do texto do sistema, e o Haiku copiava o padrão — às vezes fazendo a
 * multiplicação de cabeça, às vezes não fazendo, às vezes errando. Errar número
 * na frente do dono é o pior defeito possível desta ferramenta: ele corrige o
 * SDR, a dor vira discussão de aritmética, e a autoridade da ligação acaba ali.
 * Um modelo pequeno não é o lugar de fazer conta quando `quantidade * meses *
 * valor` é uma linha de JavaScript que nunca erra.
 *
 * O MODELO SÓ EXTRAI, o código calcula e escreve. O que o modelo devolve é o
 * que ele de fato sabe fazer: ouvir "duas por semana" e "uns 800 reais" numa
 * transcrição sem etiqueta de quem falou, e virar isso em campos.
 *
 * A CONTA É SEMPRE PERGUNTA, nunca afirmação. O caderno é explícito: número que
 * sai da boca dele vira valor, número que sai da sua vira achismo e ele desconta
 * pela metade. Por isso a frase termina em "é mais ou menos isso?" — quem fecha
 * a conta continua sendo o dono.
 */

/** Em que unidade de tempo o dono deu a quantidade. */
export const PERIODOS = ["dia", "semana", "mes"] as const;
export type Periodo = (typeof PERIODOS)[number];

/**
 * Quantas vezes o período cabe num mês.
 *
 * Aproximações de propósito, e as mesmas que o caderno usa no exemplo ("duas por
 * semana, oito no mês"). A frase termina perguntando, então o dono corrige se
 * for o caso — precisão maior aqui compraria nada e custaria a fluidez de uma
 * conta que ele acompanha de cabeça.
 */
const POR_MES: Record<Periodo, number> = { dia: 30, semana: 4, mes: 1 };

/** Um a dez por extenso: o caderno escreve "duas por semana", não "2 por semana". */
const EXTENSO: Record<number, string> = {
  1: "uma",
  2: "duas",
  3: "três",
  4: "quatro",
  5: "cinco",
  6: "seis",
  7: "sete",
  8: "oito",
  9: "nove",
  10: "dez",
};

export interface NumerosDaDor {
  /** Quantos por período — o que o dono disse. */
  quantidade: number;
  periodo: Periodo;
  /** Quanto vale cada um, em reais. `null` quando ele deu só a quantidade. */
  valorUnitario: number | null;
}

export interface ContaDaDor {
  /** Quantos por mês. */
  porMes: number;
  /** Quanto por mês, em reais. `null` sem o valor unitário. */
  reaisPorMes: number | null;
  /** A frase pronta para o SDR falar, já terminando em pergunta. */
  frase: string;
}

function quantidadePorExtenso(n: number): string {
  return EXTENSO[n] ?? formatarNumero(n);
}

function formatarNumero(n: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function reais(n: number): string {
  return `R$ ${formatarNumero(n)}`;
}

function nomeDoPeriodo(p: Periodo): string {
  return p === "mes" ? "por mês" : `por ${p}`;
}

/**
 * A frase do fechamento da conta, com os números do dono.
 *
 * Devolve `null` quando não há conta a fechar — quantidade ausente, zero ou
 * absurda. Sem isto, uma transcrição picotada ("...quarenta mensagem...") viraria
 * "1.200 por mês" na tela e o SDR leria em voz alta. Melhor não sugerir conta
 * nenhuma do que sugerir uma que o dono vai desmentir.
 *
 * O TETO de 100.000 por período não é zelo de tipo: é a defesa contra o Whisper
 * transcrevendo um número de telefone ou um CEP no meio da fala.
 */
export function fecharAConta(n: NumerosDaDor | null | undefined): ContaDaDor | null {
  if (!n) return null;
  const { quantidade, periodo, valorUnitario } = n;

  if (!Number.isFinite(quantidade) || quantidade <= 0 || quantidade > 100_000) return null;
  if (!PERIODOS.includes(periodo)) return null;

  const porMes = Math.round(quantidade * POR_MES[periodo]);

  // Só a quantidade: a conta vira o total do mês, e a próxima pergunta do
  // roteiro é justamente quanto vale cada um.
  if (valorUnitario === null || !Number.isFinite(valorUnitario) || valorUnitario <= 0) {
    if (periodo === "mes") {
      return {
        porMes,
        reaisPorMes: null,
        frase: `${quantidadePorExtenso(quantidade)} por mês. Quanto vale cada um pra vocês?`,
      };
    }
    return {
      porMes,
      reaisPorMes: null,
      frase: `${quantidadePorExtenso(quantidade)} ${nomeDoPeriodo(periodo)}, ${formatarNumero(
        porMes,
      )} no mês. Quanto vale cada um?`,
    };
  }

  const reaisPorMes = Math.round(porMes * valorUnitario);

  const inicio =
    periodo === "mes"
      ? `${quantidadePorExtenso(quantidade)} por mês`
      : `${quantidadePorExtenso(quantidade)} ${nomeDoPeriodo(periodo)}, ${formatarNumero(
          porMes,
        )} no mês`;

  return {
    porMes,
    reaisPorMes,
    frase: `${inicio}, ${reais(valorUnitario)} cada — dá ${reais(
      reaisPorMes,
    )} por mês. É mais ou menos isso?`,
  };
}
