/**
 * COMO discar — não QUAL número discar.
 *
 * O número certo já sai de `paraDiscarBR` (o nono dígito de volta). O que este
 * arquivo resolve é outra coisa, descoberta em 27/08/2026: o mesmo número
 * completa ou não completa dependendo do FORMATO em que chega na operadora.
 *
 * O CRM sempre mandou `tel:+5571996436883`. Numa linha Claro do DDD 77 ligando
 * para o 71, a chamada volta com a gravação "não foi possível completar a
 * chamada, verifique o número" — que é a mensagem de formato errado, não de
 * linha ocupada nem de número inexistente. No Brasil, ligação entre áreas
 * locais diferentes precisa do código da prestadora (`0` + CSP + DDD), e
 * cidades do MESMO DDD são áreas locais diferentes: Barreiras e Guanambi são
 * as duas 77 e a ligação entre elas é interurbana.
 *
 * Qual formato a linha aceita não dá para saber daqui — depende da operadora,
 * do plano e do aparelho. Então a tela oferece os três e o SDR clica. É mais
 * barato do que adivinhar, e uma ligação que não completa custa o lead.
 */
import { formatPhoneBR } from "./phone";

export type FormatoDiscagem = "interurbano" | "nacional" | "internacional";

/**
 * Código de Seleção de Prestadora. 21 é a Claro (e a Embratel, do mesmo grupo),
 * que é a linha da Nexo hoje. Vivo é 15, TIM 41, Oi 31 — se a linha mudar, é
 * esta constante que muda.
 */
export const CSP_PADRAO = "21";

export interface OpcaoDiscagem {
  formato: FormatoDiscagem;
  /** Exatamente o que vai depois de `tel:`. */
  discar: string;
  /** O número como o SDR lê na tela, agrupado do jeito que ele digitaria. */
  rotulo: string;
  /** Uma linha dizendo quando esse formato é o certo. */
  ajuda: string;
}

/** `+5571996436883` → `{ ddd: "71", numero: "996436883" }`; null se não for BR. */
function partesBR(e164: string): { ddd: string; numero: string } | null {
  const m = /^\+55(\d{2})(\d{8,9})$/.exec(e164);
  if (!m?.[1] || !m[2]) return null;
  return { ddd: m[1], numero: m[2] };
}

/**
 * As formas de discar o mesmo número, da mais provável para a menos.
 *
 * A ORDEM NÃO É OPINIÃO: o interurbano vem primeiro porque o internacional é
 * o que já estava lá e falhou. Número que não é brasileiro tem uma opção só —
 * `0 21` na frente de um número de fora não é uma alternativa, é um erro.
 */
export function opcoesDeDiscagem(e164: string, csp: string = CSP_PADRAO): OpcaoDiscagem[] {
  const partes = partesBR(e164);
  if (!partes) {
    return [
      {
        formato: "internacional",
        discar: e164,
        rotulo: e164,
        ajuda: "número de fora do Brasil",
      },
    ];
  }

  const { ddd, numero } = partes;
  const legivel = formatPhoneBR(e164);

  return [
    {
      formato: "interurbano",
      discar: `0${csp}${ddd}${numero}`,
      rotulo: `0 ${csp} ${legivel}`,
      ajuda: "interurbano pela operadora — cidade diferente, mesmo no seu DDD",
    },
    {
      formato: "nacional",
      discar: `${ddd}${numero}`,
      rotulo: legivel,
      ajuda: "só o DDD, sem o zero na frente",
    },
    {
      formato: "internacional",
      discar: e164,
      rotulo: `+55 ${legivel}`,
      ajuda: "com o +55, como o CRM fazia até agora",
    },
  ];
}

/**
 * O formato escolhido, ou o primeiro da lista quando o guardado não existe
 * mais (número que virou estrangeiro, preferência de uma versão antiga).
 *
 * `opcoesDeDiscagem` nunca devolve lista vazia, mas o tipo não sabe disso — daí
 * a última defesa em vez de um `!`. Devolver o número cru é sempre discável.
 */
export function opcaoEscolhida(
  opcoes: OpcaoDiscagem[],
  formato: FormatoDiscagem | null,
  e164: string,
): OpcaoDiscagem {
  return (
    opcoes.find((o) => o.formato === formato) ??
    opcoes[0] ?? {
      formato: "internacional",
      discar: e164,
      rotulo: e164,
      ajuda: "",
    }
  );
}
