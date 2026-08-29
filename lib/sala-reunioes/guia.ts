/**
 * O GUIA DA REUNIÃO — as etapas do diagnóstico consultivo que o vendedor segue
 * na própria tela, com ou sem copiloto ouvindo.
 *
 * ⚠️ ROTEIRO COMERCIAL da Nexo, não implementação — mesma regra do
 * `live-prompt.ts`. As etapas vêm do método de venda consultiva estudado em
 * 08/2026 (diagnóstico com ferramenta visível → aprofundar em camadas → nota
 * 0-10 antes do preço → antecipar objeções → fechamento dentro da call),
 * adaptado ao roteiro da casa: aqui NÃO se pergunta faturamento (pergunta-se o
 * valor de UM cliente) e o preço é fixo nos cards — o que se antecipa é a
 * objeção, não o caixa. Alteração aqui passa por quem é dono do roteiro.
 *
 * POR QUE UM ARQUIVO DE DADOS: a tela (`GuiaDaReuniao.tsx`) é layout; o que se
 * pergunta numa reunião de venda é decisão comercial. Separado, o roteiro muda
 * sem mexer em componente — e dá para testar a montagem da nota sem renderizar
 * nada.
 */

export interface EtapaDoGuia {
  id: string;
  titulo: string;
  /** Uma frase: o que precisa ter acontecido para esta etapa estar completa. */
  objetivo: string;
  /** Frases prontas para falar em voz alta, em ordem de uso. */
  perguntas: string[];
  /** O lembrete que evita o erro clássico da etapa. */
  dica: string;
}

export const ETAPAS_DO_GUIA: EtapaDoGuia[] = [
  {
    id: "dor",
    titulo: "Achar a dor",
    objetivo: "A dor aparece na voz DELE — você só escuta e anota.",
    perguntas: [
      "O que te fez aceitar essa conversa hoje?",
      "O que mais te segura hoje: pouca gente chegando, gente que chama e some, ou o dia que não dá conta?",
      "Como um cliente novo chega até você hoje?",
    ],
    dica: "Anote as palavras exatas dele — elas voltam na hora da proposta.",
  },
  {
    id: "camadas",
    titulo: "Descer camadas",
    objetivo: "A dor vira um número dito por ele — uma pergunta por vez.",
    perguntas: [
      "Quantos clientes (ou orçamentos) chegam por semana?",
      "Desses, quantos fecham? Você mede isso ou é sensação?",
      "Quanto vale um cliente fechado pra você?",
      "Se travar: “chuta um número, mais ou menos”. Se for difícil medir: “quantas horas por semana isso te toma?”",
    ],
    dica:
      "Nunca pergunte faturamento — pergunte o valor de UM cliente. Depois da pergunta, silêncio: quem faz a conta é ele.",
  },
  {
    id: "cegueira",
    titulo: "O que ele não sabe que não sabe",
    objetivo: "Ele vê algo que não via — a busca no Google, o concorrente na frente.",
    perguntas: [
      "Posso te mostrar uma coisa? Pesquisa aí comigo: [serviço] em [cidade].",
      "Quem aparece primeiro é [concorrente]. Quantos clientes por mês você acha que ele leva na sua frente?",
      "Se isso seguir do jeito que tá por 12 meses, onde o negócio vai estar?",
    ],
    dica:
      "Hora do Quadro Branco: desenhe a conta na frente dele. Diagnóstico falado não gera valor — mostrado, gera.",
  },
  {
    id: "laudo",
    titulo: "Laudo + nota 0 a 10",
    objetivo: "Ele se compromete com a própria voz — antes de qualquer preço.",
    perguntas: [
      "Deixa eu te devolver o que eu entendi: [resuma a dor com as palavras dele].",
      "De 0 a 10, o quanto você quer resolver isso?",
      "Deu menos de 10? “Por que [nota] e não 10 — o que falta?”",
      "Deu 10? “Por que 10 e não menos?” — deixe ele se vender sozinho.",
    ],
    dica: "Com menos de 10 firmado, não mostre preço. Volte uma etapa.",
  },
  {
    id: "objecoes",
    titulo: "Antecipar objeções",
    objetivo: "O que mata a venda no fim morre aqui no meio, antes dos cards.",
    perguntas: [
      "Além de você, quem mais decide? Sócio, esposa?",
      "Se fizer sentido pra você, tem algo que te impediria de começar hoje?",
      "Já contratou agência antes? Como foi? (se se queimou: a garantia de 60 dias responde)",
    ],
    dica: "Marque abaixo as que aparecerem — elas entram na nota do card.",
  },
  {
    id: "fechamento",
    titulo: "Fechar (ou combinar)",
    objetivo: "Quem quer resolver, resolve dentro da call.",
    perguntas: [
      "Mostre os cards e pergunte: “Fechamos?”",
      "Fechou? Manda a chave Pix agora, na própria call.",
      "Não fechou? “Devo te chamar de novo? O que muda daqui uma semana?” — saia com dia e hora.",
    ],
    dica:
      "A hora do pagamento tem que ser a parte mais leve da reunião — se ficou pesada, faltou etapa antes.",
  },
];

/** As objeções que se marca com um toque durante a conversa. */
export const OBJECOES_DO_GUIA = [
  { chave: "socio_esposa", rotulo: "Sócio / esposa decide junto" },
  { chave: "vou_pensar", rotulo: "“Vou pensar”" },
  { chave: "financeiro", rotulo: "Financeiro / achou caro" },
  { chave: "ja_se_queimou", rotulo: "Já se queimou com agência" },
  { chave: "quer_comparar", rotulo: "Quer comparar concorrente" },
  { chave: "decisor_ausente", rotulo: "Decisor não está na call" },
] as const;

export type ObjecaoDoGuia = (typeof OBJECOES_DO_GUIA)[number]["chave"];

export const DESFECHOS_DO_GUIA = [
  { chave: "fechou", rotulo: "Fechou na call" },
  { chave: "combinado", rotulo: "Saiu com combinado" },
  { chave: "nao_quer", rotulo: "Não quer" },
] as const;

export type DesfechoDoGuia = (typeof DESFECHOS_DO_GUIA)[number]["chave"];

export interface ResultadoDoGuia {
  nota: number | null;
  /** O cliente justificou a nota com a própria voz ("por que não menos?"). */
  justificou: boolean;
  objecoes: ObjecaoDoGuia[];
  desfecho: DesfechoDoGuia | null;
  /** O combinado de follow-up feito DENTRO da call, com dia e hora. */
  combinado: string;
  /** Anotação livre por etapa, indexada por `EtapaDoGuia.id`. */
  anotacoes: Record<string, string>;
}

const ROTULO_DA_OBJECAO = new Map<string, string>(
  OBJECOES_DO_GUIA.map((o) => [o.chave, o.rotulo]),
);
const ROTULO_DO_DESFECHO = new Map<string, string>(
  DESFECHOS_DO_GUIA.map((d) => [d.chave, d.rotulo]),
);

/**
 * O resultado do guia virando o texto da nota do card — headline curta para a
 * lista, corpo com só o que foi preenchido. Vazio não vira linha: nota com
 * "Objeções: —" ensina a pular a leitura.
 */
export function montarNotaDoGuia(r: ResultadoDoGuia): { headline: string; body: string } {
  const partes: string[] = [];
  if (r.nota !== null) partes.push(`quer resolver ${r.nota}/10`);
  if (r.desfecho) partes.push(ROTULO_DO_DESFECHO.get(r.desfecho) ?? r.desfecho);
  const headline = `Guia da reunião: ${partes.length > 0 ? partes.join(" · ") : "anotações"}`;

  const linhas: string[] = [];
  if (r.nota !== null) {
    linhas.push(
      `Nota 0-10: ${r.nota}${r.justificou ? " (justificou com a própria voz)" : " (não justificou)"}`,
    );
  }
  if (r.objecoes.length > 0) {
    linhas.push(
      `Objeções que apareceram: ${r.objecoes
        .map((o) => ROTULO_DA_OBJECAO.get(o) ?? o)
        .join("; ")}`,
    );
  }
  if (r.desfecho) linhas.push(`Desfecho: ${ROTULO_DO_DESFECHO.get(r.desfecho) ?? r.desfecho}`);
  if (r.combinado.trim()) linhas.push(`Combinado de follow-up: ${r.combinado.trim()}`);

  for (const etapa of ETAPAS_DO_GUIA) {
    const texto = r.anotacoes[etapa.id]?.trim();
    if (texto) linhas.push(`${etapa.titulo}: ${texto}`);
  }

  return { headline, body: linhas.join("\n") };
}
