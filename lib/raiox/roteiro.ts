/**
 * O ROTEIRO DE REVELAÇÃO DO RAIO-X — como o levantamento vira valor na frente
 * do cliente.
 *
 * ⚠️ ROTEIRO COMERCIAL da Nexo, não implementação. Mesma regra do
 * `lib/sala-reunioes/live-prompt.ts` e do `lib/raiox/nichos.ts`.
 *
 * A REGRA QUE SUSTENTA TUDO: PERGUNTA ANTES DA PROVA. O valor não está no dado
 * levantado — está no buraco entre o que o dono ACHA e o que a tela mostra.
 * "Quanto tempo vocês demoram para responder?" ... "uns dez minutos" ... e o
 * print diz nove horas. Se a prova aparece primeiro, é informação e ele
 * esquece; se a resposta dele vem antes, é ele se contradizendo sozinho, e
 * disso ele não esquece. Toda tela deste arquivo é construída nessa ordem, e
 * uma tela sem `perguntaAntes` não deveria existir.
 *
 * UMA TELA POR VEZ, NUNCA O DOSSIÊ. Relatório aberto de uma vez mostra doze
 * problemas e ele não sente nenhum. O peso vem do acúmulo acontecendo na frente
 * dele — é o mesmo motivo pelo qual o valor precede a proposta.
 *
 * O SILÊNCIO É PARTE DO ROTEIRO, por isso `depois` existe como campo e não como
 * observação solta: depois da prova, quem fala primeiro estraga o efeito. O
 * dono precisa do vazio para fazer a conta na própria cabeça.
 */
import type { CanalDoNicho, FichaDoNicho } from "@/lib/raiox/nichos";

export interface TelaDoFilme {
  id: string;
  titulo: string;
  /** A pergunta que vem ANTES da prova. Você já sabe a resposta. */
  perguntaAntes: string;
  /** O que a tela mostra depois que ele responde. */
  prova: string;
  /** O que fazer no instante seguinte. Quase sempre: calar. */
  depois: string;
  /**
   * A partir daqui a conta em R$ fica visível na tela, acumulando. Antes disso
   * o número atrapalha: dinheiro cedo demais vira preço, e preço antes da dor
   * madura mata a implicação.
   */
  mostraConta?: boolean;
}

/**
 * A PRIMEIRA TELA MUDA POR NICHO, e é a única que muda. Onde o cliente daquele
 * ramo realmente procura decide por onde o filme começa — abrir com o Google
 * num ramo que vive de indicação faz o dono desqualificar o diagnóstico inteiro
 * na primeira tela, e não há como recuperar depois disso.
 */
const TELA_DO_CANAL: Record<CanalDoNicho, TelaDoFilme> = {
  google: {
    id: "canal-google",
    titulo: "Por onde o cliente chega",
    perguntaAntes:
      "Quando alguém aí em {cidade} precisa disso e não conhece ninguém do ramo, o que você acha que essa pessoa faz primeiro?",
    prova:
      "A busca real, feita ao vivo: “{busca}”. Mostre a tela e peça para ele pesquisar no celular dele também.",
    depois:
      "Cale a boca e deixe ele ler a tela. A primeira reação dele é o diagnóstico.",
  },
  instagram: {
    id: "canal-instagram",
    titulo: "A vitrine que o cliente vê",
    perguntaAntes:
      "Quando um cliente novo quer ver seu trabalho antes de falar com você, para onde ele vai?",
    prova:
      "O perfil dele como um cliente vê: a data do último post, e o perfil do concorrente ao lado, postando toda semana.",
    depois:
      "Não explique o que ele está vendo. Espere ele comentar a diferença.",
  },
  portal: {
    id: "canal-portal",
    titulo: "Quem fica com o seu cliente",
    perguntaAntes:
      "Hoje, de cada dez clientes novos, quantos chegam por conta própria e quantos vêm do portal?",
    prova:
      "A busca real: quem aparece primeiro é o portal, com o imóvel dele dentro — e a comissão do portal no meio.",
    depois:
      "Deixe ele fazer a conta sozinho de quanto já pagou por cliente que era dele.",
  },
  indicacao: {
    id: "canal-indicacao",
    titulo: "Quando a indicação não chega",
    perguntaAntes:
      "A indicação traz quantos clientes por mês? E nos meses fracos, o que entra no lugar?",
    prova:
      "A busca real: quem aparece para quem NÃO foi indicado — e não é ele.",
    depois:
      "Espere. O ponto é o cliente que ele nunca soube que existiu.",
  },
};

/**
 * As cinco telas que valem para todo nicho, na ordem em que se revela.
 * A ordem é a do diagnóstico médico: onde você está, quem está na sua frente,
 * o exame, o que os outros dizem de você, e o laudo.
 */
const TELAS_FIXAS: TelaDoFilme[] = [
  {
    id: "concorrentes",
    titulo: "Quem está na sua frente",
    perguntaAntes:
      "Quem você diria que são seus dois maiores concorrentes aqui em {cidade}?",
    prova:
      "Quem realmente aparece na primeira página, com nota e número de avaliações de cada um.",
    depois:
      "Se ele citou nomes diferentes dos que aparecem, essa é a primeira coisa que ele não sabia que não sabia. Deixe assentar.",
  },
  {
    id: "sonda",
    titulo: "O teste que a gente fez",
    perguntaAntes:
      "Quanto tempo você acha que a sua equipe demora para responder um cliente novo no WhatsApp?",
    prova:
      "O print real: mandamos mensagem como cliente na {quando_lead} e a resposta veio {resposta_lead}. No concorrente, {resposta_concorrente}.",
    depois:
      "Nada de comentário. O cronômetro fala sozinho, e a comparação é o soco.",
    mostraConta: true,
  },
  {
    id: "avaliacoes",
    titulo: "O que seus clientes escreveram",
    perguntaAntes:
      "O que você acha que seus clientes mais elogiam? E o que mais reclamam?",
    prova:
      "As frases reais das avaliações — elogio e reclamação, com data — e quantas ficaram sem resposta.",
    depois:
      "Leia UMA reclamação em voz alta, inteira, e pare. Não amenize.",
    mostraConta: true,
  },
  {
    id: "ia",
    titulo: "O que a IA responde sobre você",
    perguntaAntes:
      "Você já perguntou para o ChatGPT qual é a melhor empresa do seu ramo aqui em {cidade}?",
    prova:
      "A resposta da IA, ao vivo. Peça para ele perguntar no celular dele — o cliente dele já está fazendo isso.",
    depois:
      "Se o nome dele não apareceu, não diga nada. Ele vai dizer.",
    mostraConta: true,
  },
  {
    id: "laudo",
    titulo: "O laudo",
    perguntaAntes:
      "Deixa eu te devolver o que eu entendi de tudo isso, em três linhas. Posso?",
    prova:
      "Onde ele está hoje, quanto isso custa por mês em cliente perdido, e o que decide. Curto e sincero, como médico.",
    depois:
      "“Isso levou três dias de levantamento, não vou te cobrar nada e o relatório é seu.” Aí a pergunta de 0 a 10 — e silêncio.",
    mostraConta: true,
  },
];

/** O filme daquele lead: a tela do canal do nicho, e depois as cinco fixas. */
export function montarFilme(ficha: FichaDoNicho): TelaDoFilme[] {
  return [TELA_DO_CANAL[ficha.canal], ...TELAS_FIXAS];
}

/**
 * Troca os marcadores do roteiro pelos dados do levantamento. O que não foi
 * levantado vira reticências visíveis em vez de texto inventado: uma tela que
 * afirma o que ninguém verificou é o único jeito de o Raio-X virar contra você
 * na frente do cliente.
 */
export function preencherTela(
  texto: string,
  dados: Record<string, string | null | undefined>,
): string {
  return texto.replace(/\{(\w+)\}/g, (_, chave: string) => {
    const valor = dados[chave]?.trim();
    return valor ? valor : "…";
  });
}
