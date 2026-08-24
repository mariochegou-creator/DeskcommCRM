/**
 * As sete dores e as sete palavras-eixo — aula 05 do Caderno da Ligação Fria.
 *
 * ⚠️ ROTEIRO COMERCIAL da Nexo, não implementação. Este arquivo é a transcrição
 * de uma página do caderno que o SDR decora; mexer no texto muda o que ele ouve
 * no meio de uma ligação real. Alteração aqui passa por quem é dono do roteiro.
 *
 * O QUE É A PALAVRA-EIXO. É o truque que faz uma ligação decorada parecer feita
 * só para aquele dono. Em vez de trocar de roteiro conforme a dor, o SDR escolhe
 * UMA palavra e a repete a ligação inteira: o espelho fala dela, a pergunta
 * seguinte fala dela, o número mede ela, e a ponte promete acabar com ela. No
 * fechamento a palavra já é do dono — ele a repete de volta.
 *
 * Escolher a palavra é a ÚNICA decisão que o SDR toma dentro da ligação. Todo o
 * resto é o esqueleto de quatro passos rodando (espelho → aprofunda → número →
 * ponte).
 *
 * POR QUE O EIXO É GRAVADO E NÃO REDECIDIDO A CADA BLOCO: o copiloto enxerga só
 * a janela recente da transcrição. Sem gravar, a dor declarada no minuto 2 sai
 * da janela por volta do minuto 5 e o copiloto volta ao genérico — que é
 * exatamente a ligação que o caderno existe para evitar. Gravado uma vez, o
 * eixo entra em todo prompt seguinte e a ligação inteira segue naquele galho.
 * Ver `live_state.eixo`.
 *
 * `nunca` NÃO É ESTILO, é a regra mais dura do caderno. Dizer "CRM", "IA",
 * "chatbot", "SEO", "dashboard" ou "tráfego pago" no telefone entrega a solução
 * antes da reunião: o SDR chega na R1 sem nada novo para mostrar e a reunião
 * perde o motivo de existir. As frases em `diga` são a tradução aprovada.
 */

export interface Eixo {
  /** Chave estável — é o que vai em `live_state.eixo` e no vocabulário do modelo. */
  chave: string;
  /** A palavra que se repete a ligação inteira. */
  palavra: string;
  /** Como o rótulo aparece no popup, durante a chamada. */
  rotulo: string;
  /** O que o dono diz quando é esta a dor — as falas literais do caderno. */
  ouve: readonly string[];
  /** Palavras proibidas no telefone. Dizer qualquer uma vira alerta na tela. */
  nunca: readonly string[];
  /** A tradução aprovada — o que o SDR fala no lugar. */
  diga: string;
}

export const EIXOS: readonly Eixo[] = [
  {
    chave: "controle",
    palavra: "controle",
    rotulo: "Controle",
    ouve: ["é tudo no WhatsApp mesmo", "anoto num caderno", "às vezes some, né"],
    nunca: ["CRM", "funil", "pipeline"],
    diga: "uma tela com o nome de todo mundo que chamou vocês e em que pé tá cada um",
  },
  {
    chave: "espera",
    palavra: "espera",
    rotulo: "Espera",
    ouve: ["aí só no outro dia", "fim de semana ninguém olha", "tem hora que acumula 40 mensagem"],
    nunca: ["IA", "chatbot", "bot", "automação"],
    diga: "alguém respondendo na hora, dia e noite, sem o senhor ter que contratar",
  },
  {
    chave: "cadeira_vazia",
    palavra: "cadeira vazia",
    rotulo: "Cadeira vazia",
    ouve: ["marca e some", "eu mesmo que fico confirmando", "remarca toda hora"],
    nunca: ["fluxo", "integração", "automação"],
    diga: "o cliente marca sozinho e é lembrado antes, sem ninguém aí ter que ligar",
  },
  {
    chave: "repeticao",
    palavra: "repetição",
    rotulo: "Repetição",
    ouve: ["site a gente não tem não", "manda tudo por WhatsApp mesmo", "tem um antigo lá, parado"],
    nunca: ["landing page", "responsivo", "seu site é antigo"],
    diga: "uma página onde a pessoa vê tudo sozinha antes de chamar vocês",
  },
  {
    chave: "ser_achado",
    palavra: "ser achado",
    rotulo: "Ser achado",
    ouve: ["nem sei quantas avaliações tem", "o Instagram tá abandonado", "minha filha que cuidava"],
    nunca: ["SEO", "GMB", "otimização de perfil"],
    diga: "aparecer na frente do concorrente quando procuram no celular",
  },
  {
    chave: "enxergar",
    palavra: "enxergar",
    rotulo: "Enxergar",
    ouve: ["sei mais ou menos", "olho o extrato", "meu contador que vê isso"],
    nunca: ["dashboard", "BI", "métrica", "KPI"],
    diga: "uma tela no celular com os números do mês, atualizada sozinha",
  },
  {
    chave: "balde_furado",
    palavra: "balde furado",
    rotulo: "Balde furado",
    ouve: ["já impulsionei e não deu nada", "vivo de indicação", "paguei um cara e sumiu"],
    nunca: ["tráfego pago", "ROAS", "CPA"],
    diga: "primeiro fechar o balde, depois botar água",
  },
] as const;

export const EIXO_CHAVES = EIXOS.map((e) => e.chave);

export const EIXO_POR_CHAVE = new Map(EIXOS.map((e) => [e.chave, e]));

/** O rótulo curto para o popup. Chave desconhecida devolve a própria chave. */
export function rotuloDoEixo(chave: string | null | undefined): string | null {
  if (!chave) return null;
  return EIXO_POR_CHAVE.get(chave)?.rotulo ?? chave;
}

/**
 * A tabela das sete dores, do jeito que entra no prompt do sistema.
 *
 * Gerada da constante, e não escrita à mão duas vezes: eixo novo aparece no
 * prompt sozinho. Um eixo que existe no vocabulário e não existe no prompt é o
 * defeito silencioso do sempre — o modelo nunca o escolhe e ninguém descobre.
 */
export function tabelaDeEixosParaPrompt(): string {
  return EIXOS.map(
    (e) =>
      `- "${e.chave}" (palavra: ${e.palavra}) — ele diz: ${e.ouve
        .map((o) => `"${o}"`)
        .join(" · ")}\n  NUNCA DIGA: ${e.nunca.join(" · ")}\n  DIGA ASSIM: "${e.diga}"`,
  ).join("\n");
}

/**
 * Toda palavra proibida de todos os eixos, para a checagem do alerta.
 *
 * A varredura é sobre TODOS os eixos, não só o escolhido: o SDR que fala "CRM"
 * numa ligação de eixo `espera` errou do mesmo jeito, e a dor de ter falado é a
 * mesma — a solução foi entregue por telefone.
 */
export const PALAVRAS_PROIBIDAS: readonly string[] = Array.from(
  new Set(EIXOS.flatMap((e) => e.nunca).map((p) => p.toLowerCase())),
);
