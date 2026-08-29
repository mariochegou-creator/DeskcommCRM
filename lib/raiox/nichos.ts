/**
 * AS FICHAS DE NICHO DO RAIO-X.
 *
 * ⚠️ CONHECIMENTO COMERCIAL da Nexo, não implementação — mesma regra do
 * `lib/sala-reunioes/live-prompt.ts`. Os números de ticket e as buscas que
 * "valem dinheiro" saem de reunião real com dono de negócio; mexer aqui muda o
 * que o cliente vê na tela e quanto a conta da dor acusa. Alteração passa por
 * quem é dono do roteiro.
 *
 * POR QUE UMA FICHA E NÃO UM DIAGNÓSTICO POR NICHO: o levantamento é o mesmo
 * para todo mundo (posição, concorrente, avaliação, sonda, conta). O que muda
 * de marcenaria para poço artesiano são oito parâmetros. Ficha, e não código
 * por ramo, é o que faz abrir um nicho novo custar dez minutos em vez de uma
 * semana — e é o que impede a segunda cópia do Raio-X de existir.
 *
 * O CANAL É O ÚNICO CAMPO QUE MUDA O ROTEIRO, não só o texto: cinco das seis
 * telas do filme valem para todo nicho, mas a sexta depende de onde o cliente
 * daquele ramo realmente procura. Fingir que o Google manda em todo nicho faz
 * o diagnóstico mentir onde a decisão nasce de indicação ou de portal.
 */

/**
 * Onde o cliente daquele ramo realmente procura. Decide qual tela entra no
 * filme na hora da revelação (ver `lib/raiox/roteiro.ts`).
 */
export type CanalDoNicho = "google" | "instagram" | "portal" | "indicacao";

export interface FichaDoNicho {
  chave: string;
  rotulo: string;
  /** As 2-3 buscas que valem dinheiro. `{cidade}` é trocado no levantamento. */
  buscas: string[];
  /**
   * Quanto vale UMA venda — o multiplicador da conta da dor. Faixa, e não
   * número fixo: na reunião quem dá o valor final é o dono, e a faixa serve
   * só para a conta não nascer vazia se ele desconversar.
   */
  ticket: { min: number; max: number; oQueE: string };
  /** A prova que fecha negócio nesse ramo — o que o cliente quer ver. */
  prova: string;
  canal: CanalDoNicho;
  /** O que um cliente de verdade escreveria no WhatsApp. É o texto da sonda. */
  sonda: string;
  /** O que quase sempre está quebrado nesse ramo. */
  doresTipicas: string[];
  /** A época do ano que aperta — dá urgência à decisão. */
  sazonalidade: string;
  /** O que conta como presença mínima aqui (varia: nem todo ramo precisa de Instagram). */
  presencaMinima: string;
}

/**
 * Os quatro primeiros nichos são os que a Nexo já atendeu de verdade (Ravena e
 * Costa em planejados, Bahia Poços em perfuração, Rafael Imóveis, Luz Sollar):
 * as fichas nasceram de negócio real, não de suposição de mercado.
 */
export const NICHOS: FichaDoNicho[] = [
  {
    chave: "marcenaria",
    rotulo: "Marcenaria / móveis planejados",
    buscas: [
      "móveis planejados {cidade}",
      "marcenaria {cidade}",
      "cozinha planejada {cidade}",
    ],
    ticket: { min: 12_000, max: 35_000, oQueE: "um projeto fechado" },
    prova: "foto de obra pronta e o projeto em 3D",
    canal: "instagram",
    sonda: "Boa tarde! Vocês fazem cozinha planejada? Queria um orçamento.",
    doresTipicas: [
      "Instagram parado há meses, com as fotos boas soterradas",
      "sem site — o cliente que quer ver portfólio não tem para onde ir",
      "não responde no fim de semana, que é quando o casal decide",
    ],
    sazonalidade: "entrega de prédio novo e reforma de fim de ano",
    presencaMinima: "Instagram vivo com foto de obra e um site com portfólio",
  },
  {
    chave: "poco-artesiano",
    rotulo: "Poço artesiano / perfuração",
    buscas: [
      "poço artesiano {cidade}",
      "perfuração de poço {cidade}",
      "empresa de poço artesiano {cidade}",
    ],
    ticket: { min: 8_000, max: 25_000, oQueE: "um poço" },
    prova: "obra feita com profundidade e vazão, e a outorga do INEMA",
    canal: "google",
    sonda:
      "Bom dia! Tenho uma fazenda em {cidade}, vocês furam poço nessa região? Qual o valor?",
    doresTipicas: [
      "só o telefone no Google Maps, sem site nenhum",
      "primeira página do Google praticamente vazia na região",
      "quem procura poço tem pressa e liga para o primeiro que atende",
    ],
    sazonalidade: "a seca",
    presencaMinima: "ficha do Google completa e um site que prove obra feita",
  },
  {
    chave: "imobiliaria",
    rotulo: "Imobiliária / corretor",
    buscas: [
      "imóveis à venda {cidade}",
      "imobiliária {cidade}",
      "casas à venda {cidade}",
    ],
    ticket: { min: 6_000, max: 15_000, oQueE: "a comissão de um imóvel" },
    prova: "carteira de imóveis com foto boa e busca que funciona",
    canal: "portal",
    sonda: "Oi! Vi um imóvel de vocês, ainda está disponível? Dá para visitar?",
    doresTipicas: [
      "o portal aparece na frente e cobra pelo cliente que já era dele",
      "imóvel anunciado com foto ruim tirada de celular",
      "demora para responder e o cliente já visitou com outro corretor",
    ],
    sazonalidade: "começo de ano e período de safra na região agrícola",
    presencaMinima: "site próprio com os imóveis e ficha do Google atualizada",
  },
  {
    chave: "solar",
    rotulo: "Energia solar",
    buscas: [
      "energia solar {cidade}",
      "placa solar {cidade}",
      "instalação de painel solar {cidade}",
    ],
    ticket: { min: 18_000, max: 30_000, oQueE: "um sistema instalado" },
    prova: "instalação feita e a simulação de economia com o tempo de retorno",
    canal: "google",
    sonda:
      "Boa tarde! Minha conta de luz vem uns R$ 800 por mês. Quanto fica um sistema para minha casa?",
    doresTipicas: [
      "muita empresa disputando a mesma busca — quem não aparece some",
      "cliente pede simulação e ninguém manda",
      "promessa de economia sem conta na mão gera desconfiança",
    ],
    sazonalidade: "meses de conta de luz alta e anúncio de reajuste da tarifa",
    presencaMinima: "site com simulador ou orçamento e prova de instalação feita",
  },
];

/**
 * A ficha de fallback. NÃO é um nicho: é o mínimo honesto para um ramo que
 * ainda não tem ficha curada, com os campos genéricos o bastante para não
 * mentir. O levantamento marca o resultado como "nicho sem ficha" para que a
 * tela mostre o que é estimativa — número apresentado como fato é o único jeito
 * de o Raio-X destruir a reunião em vez de vendê-la.
 */
export const NICHO_GENERICO: FichaDoNicho = {
  chave: "generico",
  rotulo: "Nicho sem ficha",
  buscas: ["{nicho} {cidade}"],
  ticket: { min: 1_000, max: 5_000, oQueE: "um cliente" },
  prova: "trabalho feito, com foto e cliente satisfeito",
  canal: "google",
  sonda: "Boa tarde! Vocês atendem em {cidade}? Queria um orçamento.",
  doresTipicas: ["não aparece na busca", "demora para responder"],
  sazonalidade: "—",
  presencaMinima: "ficha do Google completa e um lugar para o cliente ver o trabalho",
};

export function acharNicho(chave: string | null | undefined): FichaDoNicho {
  if (!chave) return NICHO_GENERICO;
  return NICHOS.find((n) => n.chave === chave) ?? NICHO_GENERICO;
}

/** Troca `{cidade}` e `{nicho}` nos textos da ficha. */
export function preencher(
  texto: string,
  vars: { cidade?: string | null; nicho?: string | null },
): string {
  return texto
    .replaceAll("{cidade}", vars.cidade?.trim() || "sua região")
    .replaceAll("{nicho}", vars.nicho?.trim() || "serviço");
}
