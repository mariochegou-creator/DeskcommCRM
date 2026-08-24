/**
 * O vocabulário e a forma da análise de ligação.
 *
 * `CallStatus` e `CallOutcome` são os MESMOS valores do CHECK em
 * `crm_call_recordings` (migration 0100). O invariante
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` compara os dois —
 * mudar um lado sem o outro fica vermelho. Escritos como union literal (e não
 * derivados de um `as const`) porque é isso que o extrator daquele invariante
 * sabe ler: derivar por `(typeof X)[number]` faria a lista chegar vazia e o par
 * passaria por vacuidade, que é o defeito que aquele arquivo existe para pegar.
 */
import { z } from "zod";

export type CallStatus =
  | "pending"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "done"
  | "done_unformatted"
  | "failed";

export type CallOutcome =
  | "agendou"
  | "nao_agendou"
  | "follow_up_marcado"
  | "nao_atendeu_ou_invalida";

/** As listas para uso em runtime, amarradas aos types acima pelo `satisfies`. */
export const CALL_STATUSES = [
  "pending",
  "uploading",
  "transcribing",
  "analyzing",
  "done",
  "done_unformatted",
  "failed",
] as const satisfies readonly CallStatus[];

export const CALL_OUTCOMES = [
  "agendou",
  "nao_agendou",
  "follow_up_marcado",
  "nao_atendeu_ou_invalida",
] as const satisfies readonly CallOutcome[];

/** Status a partir dos quais nada mais acontece sozinho. */
export function isTerminalCallStatus(s: CallStatus): boolean {
  return s === "done" || s === "done_unformatted" || s === "failed";
}

/**
 * O JSON que o modelo tem de devolver, exatamente como o prompt pede.
 *
 * DELIBERADAMENTE FROUXO onde o texto é livre e ESTRITO onde o valor vira
 * decisão: `resultado` e as notas entram em coluna e viram badge, chip e média,
 * então um valor fora da faixa tem de reprovar aqui e cair no caminho
 * `done_unformatted` — nunca ser gravado e virar `NaN` numa média semana que
 * vem. Já `criterio`/`comentario` são prosa: exigir os seis nomes exatos faria
 * a análise inteira ser descartada porque o modelo escreveu "Abertura da
 * ligação" em vez de "Abertura".
 *
 * `.min(1)` nas listas, não `.nonempty()`: uma análise sem nenhum acerto e
 * nenhum ponto de melhoria não é análise, é resposta vazia com forma de JSON —
 * e ela passaria pelo parse, viraria card em branco e o SDR concluiria que a
 * ferramenta não funciona.
 */
export const CriterioSchema = z.object({
  criterio: z.string().min(1).max(120),
  nota: z.number().min(0).max(10),
  comentario: z.string().min(1).max(2000),
});

/**
 * O QUE O DONO DISSE — a única parte da análise que não fala do SDR.
 *
 * Todo o resto deste schema é coaching: nota, critério, acerto, ponto de
 * melhoria. Nada disso responde "o que eu descobri sobre este negócio", e era
 * essa a informação que morria dentro da ligação: a transcrição fica no card, e
 * a linha que vai para a timeline do negócio é PII-free de propósito (fala da
 * nota do SDR, nunca da fala do dono). Resultado: três dias depois, na R1,
 * ninguém lembra por que o dono aceitou conversar.
 *
 * A aula 10 do Caderno da Ligação Fria manda fazer isto à mão nos 30 segundos
 * depois de desligar — "colar a dor nas notas com as palavras que ele usou".
 * Isto é o mesmo trabalho, feito sozinho, e vira uma linha em `lead_notes`, que
 * é de onde o preparo da R1 já lê (`lib/agendamento/material-gerar.ts`).
 *
 * NULLABLE de propósito. Ligação que não chegou à dor não tem nota a escrever,
 * e forçar o campo faria o modelo inventar uma. Ausente, nada é gravado.
 */
export const NotaDoNegocioSchema = z.object({
  /** A linha do índice — é o que aparece na lista sem abrir nada. */
  headline: z.string().min(1).max(300),
  /**
   * O corpo, nas PALAVRAS DO DONO. O caderno é explícito: a frase dele vale
   * mais que o resumo do SDR, então isto é para copiar, não interpretar.
   */
  corpo: z.string().min(1).max(3000),
});
export type NotaDoNegocio = z.infer<typeof NotaDoNegocioSchema>;

export const CallAnalysisSchema = z.object({
  resultado: z.enum(CALL_OUTCOMES),
  nota_geral: z.number().min(0).max(10),
  criterios: z.array(CriterioSchema).min(1).max(12),
  acertos: z.array(z.string().min(1).max(2000)).min(1).max(8),
  pontos_de_melhoria: z.array(z.string().min(1).max(2000)).min(1).max(8),
  frase_para_treinar: z.string().min(1).max(2000),
  nota_do_negocio: NotaDoNegocioSchema.nullable().default(null),
});

export type CallAnalysis = z.infer<typeof CallAnalysisSchema>;
export type CallCriterio = z.infer<typeof CriterioSchema>;

/**
 * O que fica em `analysis` quando nem o retry produziu JSON válido.
 *
 * Guardar o texto cru é melhor que guardar nada: o coach lê a avaliação em
 * prosa e o SDR aproveita a ligação, enquanto um `null` faria o trabalho do
 * modelo (e o dinheiro dele) sumir por um problema de formatação. O status
 * `done_unformatted` é o que impede a UI de tentar renderizar chips a partir
 * disso.
 */
export interface CallAnalysisRaw {
  raw: string;
}

export function isRawAnalysis(a: unknown): a is CallAnalysisRaw {
  return (
    typeof a === "object" &&
    a !== null &&
    typeof (a as CallAnalysisRaw).raw === "string"
  );
}

/** Rótulo do resultado para a tela — nunca o identificador cru. */
export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  agendou: "Agendou a reunião",
  nao_agendou: "Não agendou",
  follow_up_marcado: "Follow-up marcado",
  nao_atendeu_ou_invalida: "Não atendeu / inválida",
};

/**
 * O que o SDR lê enquanto espera. Cada passo é um estado REAL do pipeline, não
 * uma barra de progresso decorativa: se travar em "Transcrevendo…", isso diz em
 * qual etapa procurar.
 */
export const STATUS_LABELS: Record<CallStatus, string> = {
  pending: "Aguardando gravação",
  uploading: "Enviando…",
  transcribing: "Transcrevendo…",
  analyzing: "Analisando…",
  done: "Concluído",
  done_unformatted: "Concluído (análise sem formatação)",
  failed: "Falhou",
};
