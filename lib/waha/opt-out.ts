/**
 * O contato pediu para não receber mais? — a leitura do opt-out.
 *
 * A REGRA ANTERIOR ERA UMA BUSCA DE PALAVRA SOLTA:
 *
 *     /\b(STOP|PARAR|SAIR|UNSUBSCRIBE)\b/i
 *
 * e ela bloqueava a palavra em QUALQUER lugar de QUALQUER frase. O bloqueio é
 * irrevogável (não há rota nem botão que o desfaça — `send-message.ts` chama de
 * "veto permanente de negócio"), então cada falso positivo apagava um lead vivo
 * em silêncio. Dois casos reais, medidos nesta base em 12/08/2026, e nenhum dos
 * dois era pedido de descadastro:
 *
 *   - "uns 15 a 20 minutos antes de SAIR de casa" — a resposta automática da
 *     Pousada Love Story, que estava respondendo e virou lead morto;
 *   - "Vou PARAR de te escrever pra não virar incômodo" — a mensagem de
 *     despedida da NOSSA PRÓPRIA cadência, que voltou pelo webhook como
 *     recebida e bloqueou o contato usando o nosso texto.
 *
 * O segundo é o mais instrutivo: o sistema se auto-bloqueou. Nenhuma lista de
 * palavras resolve isso enquanto a palavra sozinha bastar — a intenção é que
 * separa "quero sair da lista" de "antes de sair de casa", e intenção tem
 * FORMA: opt-out é mensagem curta e sobre a própria lista.
 *
 * As duas portas, e só elas:
 *
 *   1. A mensagem É a palavra (`PARAR`, `stop`, `sair.`, `Cancelar!`) —
 *      opcionalmente com um "por favor" na frente. Ninguém escreve só isso
 *      dentro de uma conversa a não ser para encerrar.
 *   2. A mensagem CURTA contém uma frase inequívoca sobre a lista ("me tira da
 *      lista", "não quero mais receber", "para de me mandar mensagem").
 *
 * O teto de palavras da porta 2 é o que impede o textão: quanto mais longa a
 * mensagem, maior a chance de a frase estar dentro de um assunto, não sendo o
 * assunto. Trinta palavras cobrem o pedido educado inteiro ("agradeço o
 * contato, mas por favor não quero mais receber essas mensagens, obrigado") e
 * deixam de fora a resposta comercial que só menciona sair de casa.
 *
 * Módulo PURO e testado: é a peça que decide um efeito IRREVERSÍVEL, e ela
 * precisa poder ser exercitada sem webhook, sem banco e sem WhatsApp.
 */

/** Minúsculas, sem acento e sem pontuação — "Não!" e "nao" são a mesma coisa. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A mensagem inteira sendo a palavra. `remover` NÃO entra: sozinha ela é o que
 * o cliente escreve pedindo para tirar um item do orçamento, não para sair da
 * lista — e o custo do engano aqui é o lead apagado.
 */
const PALAVRAS_SOZINHAS = new Set([
  "stop",
  "parar",
  "pare",
  "para",
  "sair",
  "cancelar",
  "cancela",
  "descadastrar",
  "desinscrever",
  "unsubscribe",
]);

/** Rodeios que não mudam o pedido: "por favor, PARAR" continua sendo PARAR. */
const CORTESIAS = /^(por favor|pf|pfv|favor|obrigado|obrigada|ok|blz)\s+|\s+(por favor|pf|pfv|obrigado|obrigada)$/g;

/**
 * Frases sobre a LISTA — o que distingue intenção de coincidência. Todas
 * afirmam alguma coisa sobre receber mensagens nossas; nenhuma cabe no meio de
 * uma conversa sobre o negócio do cliente.
 */
const FRASES = [
  "sair da lista",
  "sair dessa lista",
  "tira da lista",
  "tirar da lista",
  "tire da lista",
  "remove da lista",
  "remover da lista",
  "remover meu numero",
  "remove meu numero",
  "descadastr",
  "nao quero mais receber",
  "nao quero receber mais",
  "nao quero receber nada",
  "nao desejo receber",
  "para de me mandar",
  "pare de me mandar",
  "parem de me mandar",
  "para de mandar mensagem",
  "pare de mandar mensagem",
  "nao me mande mais",
  "nao me mandem mais",
  "nao manda mais mensagem",
  "nao me envie mais",
  "nao envie mais mensagem",
  "nao me perturbe",
  "nao me incomode",
];

/**
 * Teto de palavras da porta 2. Ver o cabeçalho: mensagem longa que MENCIONA a
 * lista quase sempre está falando de outra coisa.
 */
const MAX_PALAVRAS = 30;

/**
 * `true` quando a mensagem recebida é um pedido de descadastro.
 *
 * Só é chamada para mensagem RECEBIDA (`handleInbound`). Na dúvida devolve
 * `false`, e a assimetria é deliberada: deixar de bloquear quem pediu custa uma
 * mensagem a mais, que o próximo pedido resolve; bloquear quem não pediu apaga
 * o lead para sempre, sem tela que desfaça.
 */
export function ehPedidoDeOptOut(body: string | null | undefined): boolean {
  if (typeof body !== "string") return false;

  const texto = normalizar(body);
  if (!texto) return false;

  // Porta 1 — a mensagem É a palavra.
  const semCortesia = texto.replace(CORTESIAS, "").trim();
  if (PALAVRAS_SOZINHAS.has(semCortesia)) return true;

  // Porta 2 — mensagem curta falando da lista.
  const palavras = texto.split(" ").length;
  if (palavras > MAX_PALAVRAS) return false;
  return FRASES.some((f) => texto.includes(f));
}
