/**
 * O contrato de saída do copiloto AO VIVO da ligação (Haiku, uma chamada por
 * bloco de áudio transcrito).
 *
 * DIFERENÇA PARA `lib/sala-reunioes/live-schema.ts`, e por que não é o mesmo
 * arquivo: lá as fases são as do SPIN de uma reunião de uma hora e a cobertura
 * é um `record` livre, porque o overlay do Meet não desenha checklist. Aqui a
 * ligação dura cinco minutos, tem DEZ itens fechados, e o popup os desenha em
 * caixinhas que se marcam sozinhas — checklist com chave livre viraria uma
 * lista que muda de tamanho no meio da ligação, que é exatamente o tipo de tela
 * inquieta que tira o SDR da conversa.
 *
 * Nenhum destes valores tem CHECK no banco (a 0106 não criou tabela; tudo isto
 * mora em `crm_call_recordings.live_state`, um jsonb). Então este arquivo NÃO
 * entra no invariante de vocabulário banco×TypeScript — não há o outro lado
 * para comparar.
 */
import { z } from "zod";

/**
 * O tamanho de cada bloco de áudio do copiloto, em segundos.
 *
 * MORA AQUI porque três lados dependem de concordar: o popup fatia o áudio
 * neste passo, e o worker usa o mesmo número para decidir se a transcrição ao
 * vivo cobriu a ligação inteira ou parou no meio.
 *
 * ERA 15 s, e os 15 s ERAM o gargalo: a frase que o lead acabou de dizer só
 * saía do navegador quando o bloco fechasse — isso sozinho colocava até 15
 * segundos entre a fala e a sugestão, antes de qualquer modelo pensar. Com 5 s
 * a espera do bloco cai para 2,5 s em média e a transcrição aparece na tela
 * três vezes mais rápido, que é o que faz o SDR ver a tela viva.
 *
 * O PREÇO, dito claro: bloco menor pica palavra na fronteira com mais
 * frequência, então a transcrição bruta fica um pouco mais suja. Vale a troca
 * porque quem lê a transcrição bruta é a análise final (Sonnet), que tolera
 * ruído. E bloco menor NÃO vira conta maior: o modelo não é mais chamado por
 * bloco, e sim quando junta fala suficiente — ver `MIN_CHARS_PARA_SUGERIR` na
 * rota.
 */
export const LIVE_CHUNK_SECONDS = 5;

/**
 * Onde a ligação FRIA está agora — as fases do Caderno da Ligação Fria.
 *
 * `situacao` SAIU. Ela vinha do kit antigo ("entender o negócio em 3 a 4
 * perguntas") e não existe no caderno: numa ligação fria o SDR não tem crédito
 * para um questionário, e cada pergunta de situação é um convite a desligar. O
 * caderno abre, faz UMA pergunta escolhida antes de discar, e a resposta dela é
 * de onde a dor sai — normalmente sem o dono perceber que entregou.
 *
 * Ver `lib/calls/live-prompt.ts`.
 */
export const CALL_PHASES = [
  "abertura",
  "pergunta",
  "dor",
  "decisor",
  "agendamento",
  "encerramento",
] as const;
export type CallPhase = (typeof CALL_PHASES)[number];

export const CALL_PHASE_LABELS: Record<CallPhase, string> = {
  abertura: "Abertura",
  pergunta: "A pergunta",
  dor: "A dor",
  decisor: "Quem decide",
  agendamento: "Marcar 30 min",
  encerramento: "Confirmar",
};

/**
 * O ESQUELETO DE QUATRO PASSOS — aula 04 do Caderno da Ligação Fria, a aula que
 * o caderno chama de "a mais importante".
 *
 * "Se você decorar uma única coisa do caderno inteiro, que seja esta sequência:
 * Espelho → Aprofunda → Número → Ponte." Ele roda em cima de QUALQUER dor que
 * apareça — é por isso que o SDR não precisa decorar sete roteiros.
 *
 * - `espelho`: repetir a dor que ele acabou de contar COM AS PALAVRAS DELE.
 *   Ele se escuta por fora, o que incomoda mais que pensar por dentro, e de
 *   quebra percebe que alguém estava ouvindo de verdade. Era o passo que
 *   faltava aqui: sem ele o copiloto ia direto interrogar.
 * - `aprofunda`: mostrar o TAMANHO que a dor já tem — com que frequência, há
 *   quanto tempo, já deu problema. Não é aumentar a dor; é medir a que existe e
 *   que ele nunca parou para olhar.
 * - `numero`: fazer o dono botar quantidade ou dinheiro na mesa. O SDR só soma,
 *   devagar, na frente dele — e a soma é feita em `conta-da-dor.ts`, não de
 *   cabeça pelo modelo.
 * - `ponte`: dizer que aquilo não dá para mostrar por telefone, e pedir os 30
 *   minutos. A reunião vira consequência do que ele mesmo acabou de dizer.
 */
export const DEGRAUS_DA_DOR = ["espelho", "aprofunda", "numero", "ponte"] as const;
export type DegrauDaDor = (typeof DEGRAUS_DA_DOR)[number];

export const DEGRAU_LABELS: Record<DegrauDaDor, string> = {
  espelho: "Espelho",
  aprofunda: "Aprofunda",
  numero: "Número",
  ponte: "Ponte",
};

/**
 * O checklist do roteiro. Chaves FIXAS: é o que o popup desenha, na ordem em
 * que aparecem aqui, e é o que a análise final recebe como "o que ficou de
 * fora". Item novo entra aqui, no rótulo e no prompt — os três juntos, porque
 * um checklist com um item que o modelo nunca preenche fica eternamente
 * vermelho e o SDR aprende a ignorar a tela inteira.
 */
export const CoberturaSchema = z.object({
  abriu_sem_pergunta: z.boolean().default(false),
  permissao_pedida: z.boolean().default(false),
  pergunta_feita: z.boolean().default(false),
  espelho_feito: z.boolean().default(false),
  dor_aprofundada: z.boolean().default(false),
  numero_dele: z.boolean().default(false),
  ponte_feita: z.boolean().default(false),
  decisor_identificado: z.boolean().default(false),
  reuniao_proposta: z.boolean().default(false),
  dia_e_hora_confirmados: z.boolean().default(false),
});
export type Cobertura = z.infer<typeof CoberturaSchema>;

export type CoberturaKey = keyof Cobertura;

/**
 * Dois rótulos por item, e não é duplicação por preguiça.
 *
 * O CURTO é o que cabe embaixo do tracinho do trilho, no popup — dez marcas
 * dividindo a largura de uma janela, com o dono na linha. O LONGO é o que a
 * análise final entrega como "o que ficou de fora": ali quem lê é uma pessoa,
 * dias depois, e "Espelho" sozinho não diz nada fora do contexto da chamada.
 */
export const COBERTURA_LABELS_CURTOS: Record<CoberturaKey, string> = {
  abriu_sem_pergunta: "Abriu",
  permissao_pedida: "2 min",
  pergunta_feita: "Pergunta",
  espelho_feito: "Espelho",
  dor_aprofundada: "Tamanho",
  numero_dele: "Número",
  ponte_feita: "Ponte",
  decisor_identificado: "Decide",
  reuniao_proposta: "2 horários",
  dia_e_hora_confirmados: "Dia e hora",
};

export const COBERTURA_LABELS: Record<CoberturaKey, string> = {
  abriu_sem_pergunta: "Abriu sem pergunta de cortesia",
  permissao_pedida: "Pediu os dois minutos",
  pergunta_feita: "Fez a pergunta que abre",
  espelho_feito: "Repetiu a dor com as palavras dele",
  dor_aprofundada: "Mediu o tamanho da dor",
  numero_dele: "O dono deu o número",
  ponte_feita: "Pediu os 30 minutos",
  decisor_identificado: "Descobriu quem decide",
  reuniao_proposta: "Ofereceu dois horários",
  dia_e_hora_confirmados: "Repetiu dia e hora",
};

export const COBERTURA_VAZIA: Cobertura = CoberturaSchema.parse({});

/**
 * O ROTEIRO COMO LISTA DE PORTÕES, na ordem em que a ligação acontece: cada
 * fase é atravessada quando o item de checklist correspondente marca. É desta
 * lista que a fase é CALCULADA — ela não é mais perguntada ao modelo.
 */
const PORTOES: ReadonlyArray<readonly [CallPhase, CoberturaKey]> = [
  ["abertura", "abriu_sem_pergunta"],
  ["abertura", "permissao_pedida"],
  ["pergunta", "pergunta_feita"],
  ["dor", "espelho_feito"],
  ["dor", "dor_aprofundada"],
  ["dor", "numero_dele"],
  ["dor", "ponte_feita"],
  ["decisor", "decisor_identificado"],
  ["agendamento", "reuniao_proposta"],
  ["encerramento", "dia_e_hora_confirmados"],
] as const;

/**
 * Em que fase a ligação está, DEDUZIDA do checklist — não perguntada ao modelo.
 *
 * POR QUE DEIXOU DE SER PERGUNTADA: a fase era um campo que o Haiku devolvia em
 * todo bloco, olhando só a janela recente da transcrição. Duas coisas quebravam
 * sozinhas. (1) Ela andava PARA TRÁS: um trecho em que o SDR retoma o nome da
 * empresa fazia o modelo dizer "abertura" no minuto 6, e o popup voltava a
 * sugerir apresentação. (2) Ela podia CONTRADIZER o próprio checklist —
 * "agendamento" com `dor_declarada` ainda falso, que é exatamente a ligação que
 * marca reunião sem motivo e vira no-show. Nada conferia as duas coisas uma
 * contra a outra, porque as duas vinham da mesma opinião do modelo.
 *
 * Calculada, a fase é de graça, nunca alucina, nunca discorda do checklist, e o
 * modelo passa a fazer só o que sabe fazer: marcar o que aconteceu e escrever a
 * próxima frase.
 *
 * O ALGORITMO É "DEPOIS DO ÚLTIMO MARCADO", e não "primeiro não marcado" — a
 * diferença importa. Um portão que nunca marca congelaria a ligação inteira
 * naquela fase, e o caso real existe: numa ligação FRIA a pergunta vai direto
 * na dor e `entendeu_o_negocio` nunca acontece. Com "primeiro não marcado" o
 * copiloto sugeriria perguntas de situação até o SDR desligar. Pular etapa é
 * assunto do alerta, não motivo para a tela parar.
 */
export function faseDaCobertura(cobertura: Partial<Cobertura> | undefined): CallPhase {
  let ultimo = -1;
  PORTOES.forEach(([, chave], i) => {
    if (cobertura?.[chave]) ultimo = i;
  });
  const proximo = PORTOES[ultimo + 1];
  return proximo ? proximo[0] : "encerramento";
}

/**
 * Em que degrau da dor a conversa está — também calculado, e `null` fora da
 * fase "dor". Mesma razão da fase: o degrau é consequência do que já marcou,
 * não uma segunda leitura da conversa que pode discordar da primeira.
 */
export function degrauDaCobertura(cobertura: Partial<Cobertura> | undefined): DegrauDaDor | null {
  if (faseDaCobertura(cobertura) !== "dor") return null;
  if (!cobertura?.espelho_feito) return "espelho";
  if (!cobertura?.dor_aprofundada) return "aprofunda";
  if (!cobertura?.numero_dele) return "numero";
  return "ponte";
}

/**
 * O QUE O MODELO AINDA DEVOLVE. `fase` e `degrau` saíram daqui de propósito:
 * são calculados de `cobertura` (ver `faseDaCobertura`), então o modelo não tem
 * mais como colocar a tela numa etapa que o checklist desmente. Chave a mais na
 * resposta é ignorada pelo zod — modelo teimando em mandar "fase" não quebra
 * nada, só não é ouvido.
 */
/**
 * A sugestão é para FALAR ou para CALAR.
 *
 * "Fez a pergunta? Cale a boca" é regra do caderno, aula 03, e é a instrução que
 * mais salva ligação: o silêncio é o dono pensando, e quem preenche o silêncio
 * perde a resposta — que é a ligação inteira. Um copiloto que só sabe sugerir
 * frases empurra o SDR a falar exatamente na hora em que ele deveria esperar.
 * Por isso "calar" é uma sugestão de primeira classe, com desenho próprio no
 * popup, e não um texto que se confunde com algo a ser lido em voz alta.
 */
export const TIPOS_DE_SUGESTAO = ["falar", "calar"] as const;
export type TipoDeSugestao = (typeof TIPOS_DE_SUGESTAO)[number];

/** O que o dono disse em número — o modelo EXTRAI, `conta-da-dor.ts` calcula. */
export const NumerosSchema = z.object({
  quantidade: z.number().positive().max(100_000),
  periodo: z.enum(["dia", "semana", "mes"]),
  valor_unitario: z.number().positive().max(10_000_000).nullable().default(null),
});
export type Numeros = z.infer<typeof NumerosSchema>;

/** As cinco respostas da aula 08. `null` quando nenhuma apareceu. */
export const OBJECOES = [
  "manda_whatsapp",
  "quanto_custa",
  "sem_tempo",
  "ja_tenho_quem_faz",
  "liga_outro_dia",
  "ta_tranquilo",
] as const;
export type Objecao = (typeof OBJECOES)[number];

export const OBJECAO_LABELS: Record<Objecao, string> = {
  manda_whatsapp: "Manda no WhatsApp",
  quanto_custa: "Quanto custa?",
  sem_tempo: "Não tenho tempo",
  ja_tenho_quem_faz: "Já tenho quem faz",
  liga_outro_dia: "Me liga outro dia",
  ta_tranquilo: "Tá tudo tranquilo",
};

const LiveCallSuggestionBase = z.object({
  /**
   * 5-12 palavras, uma pergunta pronta para o SDR falar em voz alta. O teto de
   * caracteres é a guarda dura: o prompt PEDE curto, o schema RECUSA longo.
   * Uma sugestão de três linhas no meio de uma ligação não é lida — é ignorada,
   * e junto com ela o resto da tela.
   *
   * A EXCEÇÃO É A OBJEÇÃO: as respostas da aula 08 são scripts inteiros, de
   * propósito ("mando sim, e já te mando agora. Só que o que eu tenho pra te
   * mostrar é tela…"). Elas não cabem em 12 palavras e encurtá-las destrói o
   * que as faz funcionar. Por isso o teto é 320 e a regra de tamanho vive no
   * prompt, onde consegue distinguir os dois casos.
   */
  sugestao: z.string().trim().min(5).max(320),
  tipo: z.enum(TIPOS_DE_SUGESTAO).default("falar"),
  /** Quase sempre null. Só quando o SDR furou uma regra do roteiro. */
  alerta: z.string().trim().min(3).max(90).nullable().default(null),
  /**
   * A palavra-eixo escolhida. Uma vez escolhida ela NÃO troca por capricho: o
   * merge no servidor só aceita troca quando o modelo manda uma chave diferente
   * e a dor de fato mudou — ver o comentário em `route.ts`.
   */
  eixo: z.string().trim().max(40).nullable().default(null),
  /** Preenchido só quando o DONO acabou de dar quantidade ou valor. */
  numeros: NumerosSchema.nullable().default(null),
  /** Qual das respostas prontas está sendo usada, para a tela dizer qual é. */
  objecao: z.enum(OBJECOES).nullable().default(null),
  /** O dono acabou de desconversar de uma pergunta de número. Alimenta a regra de desistir. */
  desviou_do_numero: z.boolean().default(false),
  cobertura: CoberturaSchema.default(COBERTURA_VAZIA),
});

/**
 * O teto de tamanho, que é DOIS tetos.
 *
 * A guarda original era 120 caracteres e existia por um motivo específico: uma
 * sugestão de três linhas no meio de uma ligação não é lida — é ignorada, e
 * junto com ela o resto da tela. Os scripts de objeção da aula 08 obrigaram a
 * subir o limite do campo para 320, e subir o limite para todo mundo teria
 * jogado fora a guarda: nada mais impediria o modelo de escrever um parágrafo
 * numa sugestão comum.
 *
 * Então o teto passou a depender do que a sugestão É. Script de objeção pode ser
 * longo porque encurtá-lo destrói o que o faz funcionar; qualquer outra coisa
 * continua presa aos 120 caracteres de sempre. O prompt PEDE curto; isto RECUSA
 * longo.
 */
export const MAX_CHARS_SUGESTAO_CURTA = 120;

export const LiveCallSuggestionSchema = LiveCallSuggestionBase.superRefine((v, ctx) => {
  if (v.objecao === null && v.sugestao.length > MAX_CHARS_SUGESTAO_CURTA) {
    ctx.addIssue({
      code: "custom",
      path: ["sugestao"],
      message: `Sugestão sem objeção passa de ${MAX_CHARS_SUGESTAO_CURTA} caracteres — não seria lida.`,
    });
  }
});
export type LiveCallSuggestion = z.infer<typeof LiveCallSuggestionSchema>;

/**
 * O JSON de dentro da resposta do modelo — mesma tolerância do `parseAnalysis`
 * das ligações: cerca de código (```json) é o desvio mais comum e mais barato
 * de aceitar; conteúdo fora do vocabulário NÃO é tolerado.
 *
 * Devolver `null` aqui é desfecho previsto, não pane: o popup simplesmente
 * mantém a sugestão anterior na tela. Sugestão velha atrapalha menos que tela
 * piscando no meio de uma ligação.
 */
export function parseLiveCallSuggestion(texto: string): LiveCallSuggestion | null {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) return null;

  let cru: unknown;
  try {
    cru = JSON.parse(limpo.slice(inicio, fim + 1));
  } catch {
    return null;
  }

  const parsed = LiveCallSuggestionSchema.safeParse(cru);
  return parsed.success ? parsed.data : null;
}

/**
 * O que fica em `crm_call_recordings.live_state` entre um bloco e o seguinte.
 *
 * `chunks` não é enfeite de telemetria: é o que permite responder "a
 * transcrição ao vivo cobriu a ligação inteira?" na hora de decidir se o worker
 * pode aproveitar o texto em vez de mandar o áudio para o Whisper de novo.
 *
 * `pendente` e `contexto` existem para o bloco ficar barato. Com bloco de 5 s
 * um pedaço sozinho quase nunca é uma fala inteira: `pendente` acumula o que
 * ainda não foi mostrado ao modelo, e só quando junta fala de verdade a
 * chamada acontece. `contexto` guarda o que o CRM sabe do lead, buscado UMA vez
 * na ligação — antes essa consulta ao banco acontecia em todo bloco, sempre
 * devolvendo a mesma linha, e ficava na frente do modelo no caminho crítico.
 */
export const LiveStateSchema = z.object({
  fase: z.enum(CALL_PHASES).optional(),
  degrau: z.enum(DEGRAUS_DA_DOR).nullable().optional(),
  sugestao: z.string().optional(),
  tipo: z.enum(TIPOS_DE_SUGESTAO).optional(),
  alerta: z.string().nullable().optional(),
  cobertura: CoberturaSchema.optional(),
  chunks: z.number().int().min(0).optional(),
  pendente: z.string().optional(),
  contexto: z.string().nullable().optional(),
  /**
   * A palavra-eixo da ligação. GRAVADA, e é essa gravação que responde ao
   * problema do galho: o copiloto enxerga só a janela recente da transcrição, e
   * a dor declarada no minuto 2 sai da janela lá pelo minuto 5. Sem guardar o
   * eixo, o copiloto voltava ao genérico no meio da ligação — acertava o galho
   * no começo e depois esquecia qual era. Guardado, ele entra em todo prompt
   * seguinte e a ligação inteira segue naquele galho.
   */
  eixo: z.string().nullable().optional(),
  /** O que o dono já disse em número, para a conta não recomeçar do zero. */
  numeros: NumerosSchema.nullable().optional(),
  /**
   * Quantas vezes seguidas o dono desconversou no passo do número. Aos 2, o
   * roteiro DESISTE e segue para o decisor — ver a escada em `live-prompt.ts`.
   * Sem contador, o copiloto insiste até o dono ficar incomodado, e o SDR perde
   * a reunião para ganhar um número.
   */
  desviou_do_numero: z.number().int().min(0).optional(),
});
export type LiveState = z.infer<typeof LiveStateSchema>;

export function parseLiveState(cru: unknown): LiveState {
  const parsed = LiveStateSchema.safeParse(cru ?? {});
  return parsed.success ? parsed.data : {};
}
