/**
 * O contrato de saída do copiloto AO VIVO da reunião (Haiku, uma chamada por
 * janela de turnos que a extensão manda).
 *
 * ESTE ARQUIVO É O MOTOR DA LIGAÇÃO PORTADO PARA A SALA DE REUNIÕES — a mesma
 * arquitetura de `lib/calls/live-schema.ts`, decidida lá com o Caderno da
 * Ligação Fria e trazida para cá porque os defeitos eram os mesmos:
 *
 * 1. A FASE ERA PERGUNTADA AO MODELO e por isso andava para trás (um trecho de
 *    rapport no minuto 20 devolvia "abertura") e podia contradizer o próprio
 *    checklist ("pit2" com o investimento por extrair — a reunião que apresenta
 *    preço sem saber quanto ele topa pagar). Agora ela é CALCULADA do checklist
 *    (`faseDaCobertura`) e só anda para frente.
 * 2. A COBERTURA ERA UM RECORD LIVRE e era SOBRESCRITA a cada chamada — uma
 *    resposta ruim do modelo apagava a memória da reunião inteira. Agora as
 *    chaves são FIXAS por tipo de reunião e o merge é só-liga (`true` vence).
 * 3. Não existia "calar", nem palavra-eixo, nem conta feita em código.
 *
 * DIFERENÇAS para a ligação, e por que existem:
 * - As fases vêm de `vocabulary.ts` (CHECK `crm_meeting_suggestions_phase_check`
 *   da 0098 — invariante banco×TypeScript), não daqui. Nada de fase nova sem
 *   migration.
 * - Há DOIS roteiros (R1 diagnóstico SPIN, R2 proposta em Pits), então checklist
 *   e portões são POR TIPO.
 * - Não há degrau: o esqueleto de 4 passos é da ligação fria; na R1 o papel dele
 *   é das próprias fases do SPIN.
 * - A transcrição vem ETIQUETADA (o Meet legenda quem fala) — o modelo não
 *   precisa adivinhar voz, e isso está dito no prompt.
 *
 * `live_state` mora em `crm_meetings.live_state` (jsonb, criado na 0098) — sem
 * CHECK no banco, então as partes novas do estado não entram no invariante de
 * vocabulário.
 */
import { z } from "zod";

import { PERIODOS } from "@/lib/calls/conta-da-dor";
import {
  MEETING_PHASES,
  type MeetingPhase,
  type MeetingType,
} from "@/lib/sala-reunioes/vocabulary";

/**
 * A sugestão é para FALAR ou para CALAR — portado da ligação, e numa reunião
 * vale ainda mais: depois do "de 0 a 10, quanto você quer resolver isso?" e do
 * "quanto você se programou pra investir?", quem preenche o silêncio responde a
 * pergunta no lugar do cliente e perde a resposta que decide a venda.
 */
export const TIPOS_DE_SUGESTAO = ["falar", "calar"] as const;
export type TipoDeSugestao = (typeof TIPOS_DE_SUGESTAO)[number];

/** O que o cliente disse em número — o modelo EXTRAI, `conta-da-dor.ts` calcula. */
export const NumerosSchema = z.object({
  quantidade: z.number().positive().max(100_000),
  periodo: z.enum(PERIODOS),
  valor_unitario: z.number().positive().max(10_000_000).nullable().default(null),
});
export type Numeros = z.infer<typeof NumerosSchema>;

/**
 * As objeções da R2 — da skill /r2 da Nexo ("Objeções típicas"). São as que
 * aparecem FORA do checklist de objeções do diagnóstico (lá se antecipa
 * dinheiro, decisor e urgência) ou que voltam com força no Pit 2/fechamento.
 * A R1 não tem resposta pronta: quem chegou até a reunião de diagnóstico não
 * está fugindo dela.
 */
export const OBJECOES_REUNIAO = [
  "ta_caro",
  "vou_pensar",
  "eu_mesmo_faco",
  "ja_tentei_antes",
  "sem_tempo",
] as const;
export type ObjecaoReuniao = (typeof OBJECOES_REUNIAO)[number];

export const OBJECAO_REUNIAO_LABELS: Record<ObjecaoReuniao, string> = {
  ta_caro: "Tá caro",
  vou_pensar: "Vou pensar / falar com sócio",
  eu_mesmo_faco: "Vou fazer eu mesmo",
  ja_tentei_antes: "Já tentei antes",
  sem_tempo: "Não tenho tempo",
};

/**
 * O checklist de cada roteiro. Chaves FIXAS por tipo — record livre era o que
 * deixava uma resposta ruim do modelo apagar a memória da reunião. Item novo
 * entra aqui, no rótulo e no prompt, os três juntos.
 *
 * R1 = os critérios objetivos da skill /r1 (SPIN com régua).
 * R2 = o checklist de execução dos Pits da skill /r2.
 */
export const COBERTURA_KEYS: Record<MeetingType, readonly string[]> = {
  r1: [
    "numero_coletado",
    "meta_declarada",
    "problema_comparativo",
    "ticket_medio",
    "tempo_do_problema",
    "implicacao_em_reais",
    "contraste_cenarios",
    "proximo_passo_datado",
  ],
  r2: [
    "dores_reconfirmadas",
    "pagamento_sondado",
    "decisor_sondado",
    "urgencia_sondada",
    "pit1_nota",
    "pit1_porque",
    "investimento_extraido",
    "pit2_amarrado",
    "data_de_decisao",
  ],
} as const;

export const COBERTURA_REUNIAO_LABELS: Record<MeetingType, Record<string, string>> = {
  r1: {
    numero_coletado: "Coletou um número mensurável",
    meta_declarada: "O cliente declarou a meta",
    problema_comparativo: "Pergunta comparativa (dado × meta)",
    ticket_medio: "Ticket médio na mesa",
    tempo_do_problema: "Há quanto tempo o problema dura",
    implicacao_em_reais: "A dor virou R$ por mês",
    contraste_cenarios: "Contraste: nada mudar × ideal",
    proximo_passo_datado: "R2 marcada com data",
  },
  r2: {
    dores_reconfirmadas: "Dores da R1 reconfirmadas",
    pagamento_sondado: "Forma de pagamento sondada",
    decisor_sondado: "Quem decide junto",
    urgencia_sondada: "Urgência real sondada",
    pit1_nota: "Nota 0-10 dada",
    pit1_porque: "O 'por que não menos'",
    investimento_extraido: "Investimento extraído",
    pit2_amarrado: "Apresentação amarrada às dores",
    data_de_decisao: "Data de decisão marcada",
  },
};

/** O checklist como vive no estado: chaves do tipo, valores booleanos. */
export type CoberturaReuniao = Record<string, boolean>;

/**
 * O ROTEIRO COMO LISTA DE PORTÕES, por tipo, na ordem em que a reunião
 * acontece. É desta lista que a fase é CALCULADA — não perguntada ao modelo.
 *
 * A ABERTURA NÃO TEM PORTÃO de propósito: rapport não é item de checklist
 * detectável, e a primeira sugestão só nasce quando já há conversa — a fase
 * calculada começa direto no primeiro trabalho de verdade (situação na R1,
 * diagnóstico na R2), que é exatamente o que os dois roteiros mandam fazer
 * ("sinalize migrar rápido"). `abertura` continua no vocabulário para a
 * análise final, que enxerga a reunião inteira.
 */
const PORTOES: Record<MeetingType, ReadonlyArray<readonly [MeetingPhase, string]>> = {
  r1: [
    ["situacao", "numero_coletado"],
    ["situacao", "meta_declarada"],
    ["problema", "problema_comparativo"],
    ["implicacao", "ticket_medio"],
    ["implicacao", "tempo_do_problema"],
    ["implicacao", "implicacao_em_reais"],
    ["necessidade", "contraste_cenarios"],
    ["fechamento", "proximo_passo_datado"],
  ],
  r2: [
    ["diagnostico", "dores_reconfirmadas"],
    ["objecoes", "pagamento_sondado"],
    ["objecoes", "decisor_sondado"],
    ["objecoes", "urgencia_sondada"],
    ["pit1", "pit1_nota"],
    ["pit1", "pit1_porque"],
    ["extracao", "investimento_extraido"],
    ["pit2", "pit2_amarrado"],
    ["fechamento", "data_de_decisao"],
  ],
};

/**
 * Em que fase a reunião está, DEDUZIDA do checklist — mesma decisão (e mesmo
 * algoritmo) de `faseDaCobertura` da ligação: "depois do último marcado", e
 * não "primeiro não marcado", porque um portão que nunca marca congelaria a
 * reunião naquela fase. Pular etapa é assunto do alerta, não motivo para a
 * tela parar. Calculada, a fase é de graça, nunca alucina, nunca discorda do
 * checklist e nunca anda para trás (o merge só-liga garante).
 */
export function faseDaCobertura(
  tipo: MeetingType,
  cobertura: CoberturaReuniao | undefined,
): MeetingPhase {
  const portoes = PORTOES[tipo];
  let ultimo = -1;
  portoes.forEach(([, chave], i) => {
    if (cobertura?.[chave]) ultimo = i;
  });
  const proximo = portoes[ultimo + 1];
  return proximo ? proximo[0] : "fechamento";
}

/**
 * O merge só-liga do checklist: `true` vence sempre, e chave que não pertence
 * ao roteiro do tipo é DESCARTADA — o modelo não tem como inventar item novo
 * nem desmarcar um antigo. É esta trava que faz a fase só andar para frente.
 */
export function mesclarCobertura(
  tipo: MeetingType,
  anterior: CoberturaReuniao | undefined,
  nova: Record<string, unknown> | undefined,
): CoberturaReuniao {
  const saida: CoberturaReuniao = {};
  for (const chave of COBERTURA_KEYS[tipo]) {
    saida[chave] = Boolean(anterior?.[chave]) || Boolean(nova?.[chave]);
  }
  return saida;
}

const LiveSuggestionBase = z.object({
  /**
   * 5-12 palavras, uma pergunta pronta para falar em voz alta — o teto de
   * caracteres é a guarda dura (o prompt PEDE curto, o schema RECUSA longo).
   * A EXCEÇÃO é a objeção da R2: as respostas da skill /r2 são scripts
   * inteiros e param de funcionar encurtadas — para elas o teto é 360.
   */
  sugestao: z.string().trim().min(5).max(360),
  tipo: z.enum(TIPOS_DE_SUGESTAO).default("falar"),
  /** Quase sempre null. Só quando o vendedor furou uma regra do método. */
  alerta: z.string().trim().min(3).max(120).nullable().default(null),
  /**
   * A palavra-eixo (dor prioritária) — mesma tabela das 7 dores da ligação
   * (`lib/calls/palavras-eixo.ts`). Trava na primeira escolha, no servidor.
   */
  eixo: z.string().trim().max(40).nullable().default(null),
  /** R1, fase implicação: o cliente acabou de dar quantidade ou valor. */
  numeros: NumerosSchema.nullable().default(null),
  /** R2, Pit 1: a nota que o cliente deu (só quando ELE disse o número). */
  nota_pit1: z.number().min(0).max(10).nullable().default(null),
  /** R2, extração: o número ou faixa que o cliente revelou, literal. */
  investimento: z.string().trim().min(1).max(80).nullable().default(null),
  /** R2: qual resposta pronta está em uso, para a tela dizer qual é. */
  objecao: z.enum(OBJECOES_REUNIAO).nullable().default(null),
  /** O cliente acabou de desconversar de uma pergunta de número/investimento. */
  desviou_do_numero: z.boolean().default(false),
  /** Só as chaves que passaram a ser true agora — o merge só-liga faz o resto. */
  cobertura: z.record(z.string(), z.boolean()).optional().default({}),
});

export const MAX_CHARS_SUGESTAO_CURTA = 140;

export const LiveSuggestionSchema = LiveSuggestionBase.superRefine((v, ctx) => {
  if (v.objecao === null && v.sugestao.length > MAX_CHARS_SUGESTAO_CURTA) {
    ctx.addIssue({
      code: "custom",
      path: ["sugestao"],
      message: `Sugestão sem objeção passa de ${MAX_CHARS_SUGESTAO_CURTA} caracteres — não seria lida.`,
    });
  }
});
export type LiveSuggestion = z.infer<typeof LiveSuggestionSchema>;

/**
 * O JSON de dentro da resposta do modelo — mesma tolerância dos irmãos
 * (ligação e análise): cerca de código é aceita, vocabulário errado não.
 * `null` é desfecho previsto: o overlay mantém a sugestão anterior.
 */
export function parseLiveSuggestion(texto: string): LiveSuggestion | null {
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

  const parsed = LiveSuggestionSchema.safeParse(cru);
  return parsed.success ? parsed.data : null;
}

/**
 * O que fica em `crm_meetings.live_state` entre uma chamada e a seguinte.
 *
 * `contexto` é o que o CRM sabe do lead, buscado UMA vez por reunião (era o
 * padrão da ligação; aqui a consulta nem existia — a sugestão era genérica).
 * `eixo`, `numeros` e `desviou_do_numero` são a memória que sobrevive à janela
 * deslizante de turnos: a dor dita no minuto 5 sai da janela no minuto 15, e
 * sem gravar o copiloto voltava ao genérico no meio da reunião.
 */
export const LiveMeetingStateSchema = z.object({
  fase: z.enum(MEETING_PHASES).optional(),
  sugestao: z.string().optional(),
  tipo: z.enum(TIPOS_DE_SUGESTAO).optional(),
  alerta: z.string().nullable().optional(),
  cobertura: z.record(z.string(), z.boolean()).optional(),
  contexto: z.string().nullable().optional(),
  eixo: z.string().nullable().optional(),
  numeros: NumerosSchema.nullable().optional(),
  nota_pit1: z.number().nullable().optional(),
  investimento: z.string().nullable().optional(),
  /** Esquivas seguidas na pergunta de número/investimento. Ver a escada no prompt. */
  desviou_do_numero: z.number().int().min(0).optional(),
});
export type LiveMeetingState = z.infer<typeof LiveMeetingStateSchema>;

export function parseLiveMeetingState(cru: unknown): LiveMeetingState {
  const parsed = LiveMeetingStateSchema.safeParse(cru ?? {});
  return parsed.success ? parsed.data : {};
}
