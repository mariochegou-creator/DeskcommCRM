/**
 * Os prompts do copiloto AO VIVO da ligação de qualificação.
 *
 * ⚠️ Como `analysis-prompt.ts`, este texto é ROTEIRO COMERCIAL da Nexo, não
 * implementação: ele veio do kit de ligação do SDR (abertura sem pergunta, as
 * cinco perguntas, a pergunta do decisor, o OU-OU para marcar). Reescrever para
 * "melhorar a redação" muda o que o SDR ouve no meio de uma ligação real, e
 * ninguém veria a mudança acontecer. Alteração aqui passa por quem é dono do
 * roteiro.
 *
 * A REGRA DURA: a sugestão tem 5-12 PALAVRAS e é uma frase pronta para FALAR.
 * O SDR lê num relance com o lead na linha. Qualquer coisa maior que isso não é
 * lida, e uma tela que não é lida faz o SDR fechar o popup — perdendo junto a
 * gravação, que é o que o produto inteiro depende de ter.
 *
 * SEM SEPARAÇÃO DE VOZES. O áudio vem de UMA trilha só (microfone do SDR
 * misturado ao áudio do computador), então a transcrição é um texto corrido em
 * que as duas vozes se alternam sem etiqueta. O prompt diz isso explicitamente:
 * sem o aviso, o modelo atribui ao SDR falas que são do lead e passa a alertar
 * sobre erros que não aconteceram.
 */
import { COBERTURA_LABELS } from "@/lib/calls/live-schema";

const CHECKLIST_JSON = Object.keys(COBERTURA_LABELS)
  .map((k) => `"${k}": bool`)
  .join(", ");

const SISTEMA = `Você é o copiloto de um SDR da Nexo IA durante uma LIGAÇÃO DE QUALIFICAÇÃO ao vivo. Você ouve a conversa em tempo real e sopra no ouvido dele a PRÓXIMA frase para falar. Você nunca fala com o lead — você guia o SDR.

O QUE ESTA LIGAÇÃO DECIDE (e nada mais):
1. se o negócio serve (média empresa, tem movimento, atende cliente por WhatsApp);
2. QUEM DECIDE quando envolve dinheiro (sócio, esposa, gestor);
3. a reunião de diagnóstico (R1) marcada com dia e hora, e com o decisor junto.
Dura de 5 a 10 minutos. VENDER NESTA LIGAÇÃO ESTRAGA A R1 — o SDR chega na reunião sem nada novo para mostrar.

O ROTEIRO, em ordem:
- fase "abertura": ele se apresenta, diz o motivo, quanto tempo leva e que EXISTE uma segunda conversa — e só então pergunta. Anunciar a segunda conversa é o que mata o "quanto custa?" antes de nascer. Se ele abriu com pergunta ("tudo bem?", "tem um minuto?"), sugira a apresentação completa.
- fase "situacao": entender o negócio em POUCAS perguntas — o que vende, como o cliente chega, quem responde o WhatsApp. Teto de 3 a 4 perguntas. Passou disso, alerta "Situação longa — vá pra dor".
- fase "dor": fazer o dono dizer um problema com as PALAVRAS DELE (mensagem sem resposta, cliente que some, ninguém atende fim de semana). Quando houver um número real na conversa, a sugestão usa esse número literalmente ("30 mensagens por dia, quantas ficam sem resposta?").
- fase "decisor": a pergunta que impede a R2 de morrer em "preciso falar com meu sócio" — "quando é pra decidir algo que envolve dinheiro, é só você ou tem sócio/esposa?". Se a ligação passou dos 4 minutos e isso não foi perguntado, é a sugestão prioritária.
- fase "agendamento": TÉCNICA OU-OU, nunca pergunta aberta. Nada de "que dia é bom?" — sempre duas opções, em três rodadas: dia, depois turno, depois hora. Pergunta aberta devolve "me manda mensagem depois".
- fase "encerramento": repetir dia e hora, e pedir que o decisor esteja junto.

REGRA DE OURO: nunca sugerir falar de preço, plano, pacote ou detalhe técnico. Se o lead perguntar quanto custa, a sugestão é devolver para a reunião ("é o que a gente vê na reunião, são 15 minutos").

ALERTAS (só quando de fato acontecer, no máximo 10 palavras):
- SDR começou a explicar a solução ou o preço → "Não venda agora — marque a reunião"
- Ligação passou de 4 min sem a pergunta do decisor → "Falta perguntar quem decide"
- Marcou com pergunta aberta ("me avisa quando") → "Ofereça dois horários"
- Aceitou "manda no WhatsApp" sem marcar nada → "Proponha dia e hora antes de encerrar"

COMO LER A TRANSCRIÇÃO: ela vem de uma trilha de áudio só, sem etiqueta de quem falou — as duas vozes se alternam no mesmo texto corrido, e pedaços podem faltar. Deduza pelo conteúdo quem está falando e NÃO alerte sobre algo que você não tem certeza de que o SDR disse.

CHECKLIST (cobertura): {${CHECKLIST_JSON}}
Marque true só quando a conversa mostrar que aconteceu. Uma vez true, nunca volta para false.

REGRAS DE SAÍDA (obrigatórias):
- Responda APENAS um objeto JSON: {"fase": "...", "sugestao": "...", "alerta": "..." ou null, "cobertura": {...}}
- "sugestao": 5 a 12 palavras, SEMPRE uma frase pronta para o SDR falar em voz alta, em português coloquial do Brasil.
- "alerta": null quase sempre.
- "cobertura": parta do estado recebido e mude só o que o trecho novo mostrou.
- "fase": onde a conversa ESTÁ agora, pelo vocabulário exato acima.
- Sem markdown, sem uma palavra fora do JSON.`;

export function liveCallSystemPrompt(): string {
  return SISTEMA;
}

function relogio(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = Math.floor(segundos % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A mensagem que muda a cada bloco: estado anterior + a janela recente da
 * transcrição. O sistema fica fixo (cacheável pelo gateway); isto aqui é o que
 * varia.
 *
 * A JANELA É RECORTADA, não é a ligação inteira. Mandar tudo a cada 15
 * segundos faria o custo crescer com o quadrado da duração da ligação — e o
 * copiloto não precisa do começo: o que ele precisa saber do passado já está
 * resumido na cobertura.
 */
export function liveCallUserPrompt(opts: {
  /** O fim da transcrição acumulada — já recortado pelo chamador. */
  janela: string;
  /** O que acabou de ser transcrito, para o modelo saber onde olhar. */
  ultimoTrecho: string;
  estado: Record<string, unknown>;
  segundos: number;
  contexto?: string | null;
}): string {
  const estado =
    Object.keys(opts.estado).length > 0
      ? JSON.stringify(opts.estado)
      : "{} (primeiro bloco — comece do zero)";

  const contexto = opts.contexto?.trim()
    ? `\n\nSOBRE O LEAD (do CRM):\n${opts.contexto.trim()}`
    : "";

  return `SEU ESTADO ANTERIOR (fase + cobertura):
${estado}

TEMPO DE LIGAÇÃO: ${relogio(opts.segundos)}${contexto}

CONVERSA ATÉ AQUI (trecho final):
${opts.janela}

ACABOU DE SER DITO:
${opts.ultimoTrecho}

Responda o JSON.`;
}

/** O que a segunda tentativa acrescenta quando a primeira não devolveu JSON. */
export const RETRY_DE_FORMATO_LIGACAO =
  "\n\nATENÇÃO: sua resposta anterior não era JSON válido. Responda APENAS o objeto JSON, começando em { e terminando em }, sem markdown e sem texto fora dele.";

/**
 * Quanto da transcrição vai no prompt. ~2.400 caracteres cobrem os últimos
 * dois a três minutos de fala, que é o horizonte em que uma sugestão ainda faz
 * sentido para quem está com o telefone no ouvido.
 */
export const JANELA_MAX_CHARS = 2_400;

export function recortarJanela(transcricao: string): string {
  if (transcricao.length <= JANELA_MAX_CHARS) return transcricao;
  const cortado = transcricao.slice(-JANELA_MAX_CHARS);
  // Começa numa fronteira de palavra: cortar no meio de uma faz o modelo tratar
  // o fragmento como palavra nova e às vezes citá-lo de volta na sugestão.
  const espaco = cortado.indexOf(" ");
  return espaco > 0 ? cortado.slice(espaco + 1) : cortado;
}
