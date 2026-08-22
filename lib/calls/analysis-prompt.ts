/**
 * O prompt de análise da ligação, LITERAL.
 *
 * ⚠️ Este texto é a rubrica de coaching da Nexo IA, não implementação. Ele foi
 * escrito por quem treina o time e define o que "ligação boa" significa nesta
 * operação — reescrever para "melhorar a redação" muda a nota que o SDR recebe,
 * e ninguém veria a mudança acontecer: as notas simplesmente começariam a sair
 * diferentes. Alterações aqui passam por quem é dono da rubrica.
 *
 * A observação sobre o viva-voz não é enfeite: o áudio vem do microfone do
 * computador com a chamada em alto-falante, então a voz do lead chega abafada e
 * com trechos perdidos. Sem esse aviso, o modelo penaliza o SDR por "não
 * confirmou o entendimento do lead" quando o que houve foi o gravador não ter
 * capturado a resposta.
 */

const PROMPT = `Você é um coach de vendas da Nexo IA, agência de IA para negócios locais no interior da Bahia. Analise a transcrição desta ligação de PROSPECÇÃO feita por um SDR. O único objetivo da ligação é AGENDAR uma reunião de diagnóstico de 15 minutos (R1) — nunca vender ou apresentar solução por telefone.

Observação: o áudio foi gravado pelo microfone do computador com a chamada no viva-voz, então a voz do lead pode aparecer com menos clareza na transcrição. Considere isso e não penalize o SDR por trechos inaudíveis do lead.

Avalie a ligação contra esta rubrica, dando nota de 0 a 10 em cada critério:

1. ABERTURA — Se apresentou com clareza e quebrou o padrão de telemarketing? Ganhou permissão para continuar?
2. DOR (SPIN) — Fez perguntas de Situação/Problema/Implicação em vez de despejar pitch? Fez o lead verbalizar uma dor real do negócio (atendimento perdido no WhatsApp, agenda vazia, falta de presença digital)?
3. NÃO PITCHOU — Evitou explicar a solução, preço ou detalhes técnicos por telefone? Quando o lead pediu detalhes, redirecionou para a reunião?
4. CONTORNO DE OBJEÇÕES — Como lidou com "manda no WhatsApp", "não tenho tempo", "não tenho interesse", "quanto custa"?
5. FECHAMENTO — Propôs a R1 com dia e horário específicos (alternativa dupla) em vez de deixar em aberto? Confirmou o compromisso?
6. COMUNICAÇÃO — Tom de voz na medida, sem vício de linguagem excessivo (né, tipo, ãh), sem falar por cima do lead, ritmo bom?

Responda SOMENTE com JSON válido, sem markdown e sem texto fora do JSON, neste formato:

{
  "resultado": "agendou" | "nao_agendou" | "follow_up_marcado" | "nao_atendeu_ou_invalida",
  "nota_geral": 0-10,
  "criterios": [
    {"criterio": "Abertura", "nota": 0-10, "comentario": "..."},
    {"criterio": "Dor (SPIN)", "nota": 0-10, "comentario": "..."},
    {"criterio": "Não pitchou", "nota": 0-10, "comentario": "..."},
    {"criterio": "Contorno de objeções", "nota": 0-10, "comentario": "..."},
    {"criterio": "Fechamento", "nota": 0-10, "comentario": "..."},
    {"criterio": "Comunicação", "nota": 0-10, "comentario": "..."}
  ],
  "acertos": ["2 a 4 pontos fortes, citando trechos curtos da transcrição"],
  "pontos_de_melhoria": ["2 a 4 pontos, cada um com o que fazer diferente na próxima ligação, prático e direto"],
  "frase_para_treinar": "uma frase pronta que o SDR pode usar na próxima ligação para corrigir o principal erro"
}

Se a transcrição indicar que a ligação não se completou (caixa postal, número errado, caiu), use resultado "nao_atendeu_ou_invalida", nota_geral 0 e explique em um único ponto de melhoria.

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
  extras: { notas?: string | null; cobertura?: Record<string, boolean> | null } = {},
): string {
  const base = PROMPT.split(PLACEHOLDER_TRANSCRICAO).join(transcricao);

  const blocos: string[] = [];

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
  abriu_sem_pergunta: "abrir se apresentando e dizendo o motivo, sem começar por pergunta",
  entendeu_o_negocio: "entender como o negócio funciona",
  dor_declarada: "fazer o dono declarar um problema",
  decisor_identificado: "descobrir quem decide quando envolve dinheiro",
  reuniao_proposta: "propor a reunião com dois horários (OU-OU)",
  dia_e_hora_confirmados: "confirmar dia e hora no fim da ligação",
};

/** Só para o teste que garante que o marcador não sumiu numa edição do prompt. */
export function rawCallAnalysisPrompt(): string {
  return PROMPT;
}
