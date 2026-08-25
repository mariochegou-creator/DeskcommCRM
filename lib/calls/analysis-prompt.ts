/**
 * O prompt de análise da ligação, LITERAL.
 *
 * ⚠️ Este texto é a rubrica de coaching da Nexo IA, não implementação. Ele foi
 * escrito por quem treina o time e define o que "ligação boa" significa nesta
 * operação — reescrever para "melhorar a redação" muda a nota que o SDR recebe,
 * e ninguém veria a mudança acontecer: as notas simplesmente começariam a sair
 * diferentes. Alterações aqui passam por quem é dono da rubrica.
 *
 * A RUBRICA SEGUE O CADERNO DA LIGAÇÃO FRIA, e isso não é detalhe: por um tempo
 * ela não seguia. O copiloto ao vivo foi reescrito para o caderno (abertura de
 * dois minutos, esqueleto Espelho→Aprofunda→Número→Ponte, palavra-eixo) e a
 * rubrica ficou no kit antigo, cobrando "Dor (SPIN)" e falando em reunião de 15
 * minutos. O SDR treinava uma coisa e era avaliado por outra — o pior estado
 * possível para uma ferramenta de coaching, porque a nota deixa de ensinar e
 * passa a confundir. Critério novo aqui só entra se existir no caderno; passo
 * novo no caderno tem de aparecer aqui.
 *
 * As oito notas espelham a ordem da ligação de propósito: ler a coluna de cima
 * para baixo é reviver a chamada, e o primeiro zero mostra onde ela quebrou.
 *
 * A observação sobre o viva-voz não é enfeite: o áudio vem do microfone do
 * computador com a chamada em alto-falante, então a voz do lead chega abafada e
 * com trechos perdidos. Sem esse aviso, o modelo penaliza o SDR por "não
 * confirmou o entendimento do lead" quando o que houve foi o gravador não ter
 * capturado a resposta.
 */

const PROMPT = `Você é um coach de vendas da Nexo IA, agência de IA para negócios locais no interior da Bahia. Analise a transcrição desta LIGAÇÃO FRIA feita por um SDR. O único objetivo dela é conseguir 30 MINUTOS MARCADOS — nunca vender, nunca apresentar a solução, nunca dizer o nome do produto por telefone.

Você avalia contra o CADERNO DA LIGAÇÃO FRIA, que é o material que este SDR decorou. Avalie o que o caderno manda fazer, e nada além.

Observação: o áudio foi gravado pelo microfone do computador com a chamada no viva-voz, então a voz do lead pode aparecer com menos clareza na transcrição. Considere isso e não penalize o SDR por trechos inaudíveis do lead.

Dê nota de 0 a 10 em cada critério:

1. ABERTURA — Duas falas e um pedido de permissão. Disse quem é, de onde fala, e o motivo; PEDIU OS DOIS MINUTOS. Penalize pergunta de cortesia ("tudo bem?", "tem um minutinho?"), que entrega a saída fácil. Penalize FORTE ter falado em "reunião"/"conversa" na abertura: antes de o dono sentir a dor, isso acende a luzinha de vendedor e traz o "manda no WhatsApp".
2. A PERGUNTA — Fez UMA pergunta aberta sobre o CLIENTE dele (o que acontece com a mensagem de sábado à tarde; quem responde o WhatsApp; de cada dez quantas responde). Pergunta de sim/não não conta. E depois de perguntar, CALOU A BOCA: preencher o silêncio é o erro que custa a resposta.
3. ESPELHO — Repetiu a dor devolvendo AS PALAVRAS DO DONO antes de perguntar qualquer outra coisa. Parafrasear com as palavras do SDR não é espelho. Sem espelho a conversa vira interrogatório e o dono encurta as respostas.
4. O NÚMERO — Mediu a dor (com que frequência, há quanto tempo, já deu problema) e fez O DONO botar quantidade ou dinheiro na mesa. Penalize o SDR que dá o número no lugar dele: número que sai da boca do dono vira valor, número que sai da do SDR vira achismo. Se o dono desconversou duas vezes e o SDR seguiu em frente, isso é ACERTO, não falha.
5. PONTE E NÃO-VENDA — Disse que aquilo precisa ser mostrado na tela e pediu os 30 minutos, sem explicar como funciona. Penalize FORTE preço, pacote, ou palavra que entrega a solução: CRM, funil, pipeline, IA, chatbot, bot, automação, integração, landing page, SEO, GMB, dashboard, BI, KPI, tráfego pago, ROAS.
6. OBJEÇÕES — Como respondeu "manda no WhatsApp", "quanto custa", "não tenho tempo", "já tenho quem faz", "me liga outro dia", "tá tudo tranquilo". A regra do caderno: nenhuma resposta termina em ponto final — toda uma volta ao fechamento com DUAS opções de dia. No "tá tudo tranquilo", concordar e virar para o futuro ("se dobrasse, a estrutura dava conta?") em vez de discordar.
7. DECISOR E FECHAMENTO — Perguntou quem decide quando envolve dinheiro ANTES de marcar. Fechou com OU-OU em rodadas (dia, turno, hora), nunca "que dia é bom pro senhor?". Repetiu dia e hora no fim.
8. COMUNICAÇÃO — Tom na medida, sem vício de linguagem excessivo (né, tipo, ãh), sem falar por cima do dono, ritmo bom.

A PALAVRA-EIXO: o caderno manda escolher UMA palavra (controle, espera, cadeira vazia, repetição, ser achado, enxergar, balde furado) e repeti-la a ligação inteira. Se o SDR trocou de assunto a cada resposta em vez de seguir um eixo só, diga isso no ponto de melhoria — é o que faz a ligação parecer decorada.

Responda SOMENTE com JSON válido, sem markdown e sem texto fora do JSON, neste formato:

{
  "resultado": "agendou" | "nao_agendou" | "follow_up_marcado" | "nao_atendeu_ou_invalida",
  "nota_geral": 0-10,
  "criterios": [
    {"criterio": "Abertura", "nota": 0-10, "comentario": "..."},
    {"criterio": "A pergunta", "nota": 0-10, "comentario": "..."},
    {"criterio": "Espelho", "nota": 0-10, "comentario": "..."},
    {"criterio": "O número", "nota": 0-10, "comentario": "..."},
    {"criterio": "Ponte e não-venda", "nota": 0-10, "comentario": "..."},
    {"criterio": "Objeções", "nota": 0-10, "comentario": "..."},
    {"criterio": "Decisor e fechamento", "nota": 0-10, "comentario": "..."},
    {"criterio": "Comunicação", "nota": 0-10, "comentario": "..."}
  ],
  "acertos": ["2 a 4 pontos fortes, citando trechos curtos da transcrição — LISTA VAZIA quando a ligação não se completou; não invente elogio"],
  "pontos_de_melhoria": ["2 a 4 pontos, cada um com o que fazer diferente na próxima ligação, prático e direto"],
  "frase_para_treinar": "uma frase pronta que o SDR pode usar na próxima ligação para corrigir o principal erro",
  "nota_do_negocio": {
    "headline": "uma linha que identifique a ligação na lista de notas do negócio",
    "corpo": "o que o DONO disse, nas palavras dele"
  },
  "retorno_combinado": {
    "data": "AAAA-MM-DD",
    "hora": "HH:MM",
    "combinado": "o que ele pediu, nas palavras dele"
  }
}

SOBRE "nota_do_negocio" — é a única parte que NÃO fala do SDR, e ela vai para as notas do negócio, onde o preparo da reunião vai lê-la dias depois. Regras:
- Escreva o que o DONO falou, COM AS PALAVRAS DELE. Copie, não interprete: "chega mensagem de noite e só no outro dia alguém vê" vale mais que "cliente relata demora no atendimento".
- No corpo, em linhas curtas e só o que de fato apareceu: a dor; os números que ele deu; quem decide quando envolve dinheiro; o que ficou combinado (dia e hora, ou o próximo passo).
- Nada de conselho, nada de nota, nada de opinião sobre o SDR — isso já está nos outros campos.
- Se a ligação não chegou a nenhuma dor (caixa postal, número errado, ele desligou), devolva "nota_do_negocio": null. NÃO invente nota para preencher o campo.

SOBRE "retorno_combinado" — é o único campo que vira TAREFA com hora marcada na agenda de quem ligou. Por isso ele é o mais fácil de estragar. Regras:
- Preencha SÓ quando o próprio lead pediu um retorno com momento identificável: "me liga quinta de manhã", "depois das 6 da tarde", "semana que vem". Se ele não pediu, devolva "retorno_combinado": null.
- "Vou pensar", "depois eu vejo", "me manda no zap" NÃO são retorno marcado. Devolva null. Tarefa inventada faz o SDR parar de confiar na lista inteira, e aí as verdadeiras também morrem.
- Resolva a data em cima da data do bloco HOJE, no fim deste prompt. "Quinta" é a próxima quinta; "semana que vem" é a segunda-feira seguinte.
- Sem hora exata, use a faixa que ele deu: manhã 09:00, início da tarde 14:00, fim de tarde 17:00, "à noite" 19:00. Nunca deixe a hora vazia.
- "combinado" é o que ELE disse, curto, sem interpretação: "pediu pra ligar quinta de manhã, antes das 10".
- Reunião marcada NÃO entra aqui: nesse caso o resultado é "agendou" e a reunião tem lugar próprio. Este campo é para o retorno de quem ainda não marcou.

Se a transcrição indicar que a ligação não se completou (caixa postal, número errado, caiu), use resultado "nao_atendeu_ou_invalida", nota_geral 0, "nota_do_negocio": null e explique em um único ponto de melhoria.

TRANSCRIÇÃO DA LIGAÇÃO:
[TRANSCRICAO_AQUI]`;

/** O marcador que a transcrição substitui. Fica exposto para o teste conferir. */
export const PLACEHOLDER_TRANSCRICAO = "[TRANSCRICAO_AQUI]";

/**
 * O prompt com a transcrição no lugar do marcador, mais o que o SDR anotou
 * durante a ligação e o checklist do roteiro que o copiloto ao vivo marcou.
 *
 * OS DOIS BLOCOS EXTRAS VÃO DEPOIS DA TRANSCRIÇÃO, e a rubrica acima não muda
 * uma vírgula. É deliberado: a rubrica é de quem treina o time e define a nota
 * que o SDR recebe. O que entra aqui é CONTEXTO — a anotação diz o que o áudio
 * não capta (a reação do dono, o que ficou combinado por fora, por que a
 * ligação terminou cedo), e o checklist diz o que o roteiro previa e não
 * aconteceu. Sem a anotação, o modelo já penalizou SDR por "não confirmou o
 * combinado" quando o combinado tinha sido confirmado fora do microfone.
 *
 * Substituição SIMPLES (`split`/`join`), nunca `String.replace` com o texto do
 * usuário do lado direito: numa transcrição, `$&` e `$1` são sequências
 * plausíveis, e `replace` as interpretaria como referências de captura,
 * corrompendo em silêncio o texto que o modelo vai ler.
 */
export function buildCallAnalysisPrompt(
  transcricao: string,
  extras: {
    notas?: string | null;
    cobertura?: Record<string, boolean> | null;
    /** Data civil da Bahia no dia da ligação (AAAA-MM-DD) — âncora de 'quinta', 'semana que vem'. */
    hoje?: string | null;
  } = {},
): string {
  const base = PROMPT.split(PLACEHOLDER_TRANSCRICAO).join(transcricao);

  const blocos: string[] = [];

  // O bloco HOJE vem PRIMEIRO e existe só para o "retorno_combinado": sem uma
  // âncora explícita o modelo resolve "quinta" contra a data em que ele foi
  // treinado, e a tarefa nasce meses no passado — vencida antes de existir.
  const hoje = extras.hoje?.trim();
  if (hoje) {
    blocos.push(
      `HOJE É ${hoje} (data civil da Bahia). Use esta data para resolver qualquer dia relativo que o lead tenha dito.`,
    );
  }

  const notas = extras.notas?.trim();
  if (notas) {
    blocos.push(
      `ANOTAÇÃO DO SDR (escrita por ele DURANTE a ligação — trate como fato, não como opinião do lead):
${notas}`,
    );
  }

  const cobertura = extras.cobertura;
  if (cobertura && Object.keys(cobertura).length > 0) {
    const naoFeito = Object.entries(cobertura)
      .filter(([, v]) => !v)
      .map(([k]) => COBERTURA_EM_PORTUGUES[k] ?? k);
    if (naoFeito.length > 0) {
      blocos.push(
        `ITENS DO ROTEIRO QUE O COPILOTO AO VIVO NÃO VIU ACONTECER: ${naoFeito.join("; ")}.
Use isto como pista, não como veredito — o copiloto ouve a mesma trilha imperfeita que você está lendo.`,
      );
    }
  }

  const SEPARADOR = "\n\n";
  return blocos.length > 0 ? base + SEPARADOR + blocos.join(SEPARADOR) : base;
}

/**
 * Os itens do checklist em português, para o prompt. As CHAVES são as de
 * `lib/calls/live-schema.ts` — mandar `dia_e_hora_confirmados` cru para o
 * modelo funciona, mas o texto em português é o que faz o comentário da análise
 * sair na língua do SDR. Chave sem tradução cai no `?? k` e aparece crua, o que
 * é feio mas nunca some.
 */
const COBERTURA_EM_PORTUGUES: Record<string, string> = {
  abriu_sem_pergunta: "abrir se apresentando e dizendo o motivo, sem pergunta de cortesia",
  permissao_pedida: "pedir os dois minutos antes de emendar a pergunta",
  pergunta_feita: "fazer a pergunta aberta sobre o cliente dele (aula 03)",
  espelho_feito: "repetir a dor devolvendo as palavras do próprio dono",
  dor_aprofundada: "medir a dor — frequência, há quanto tempo, se já deu problema",
  numero_dele: "fazer o próprio dono botar quantidade ou dinheiro na mesa",
  ponte_feita: "dizer que precisa mostrar na tela e pedir os 30 minutos",
  decisor_identificado: "descobrir quem decide quando envolve dinheiro",
  reuniao_proposta: "propor com dois horários (OU-OU), nunca pergunta aberta",
  dia_e_hora_confirmados: "repetir dia e hora no fim da ligação",
};

/** Só para o teste que garante que o marcador não sumiu numa edição do prompt. */
export function rawCallAnalysisPrompt(): string {
  return PROMPT;
}
