/**
 * O contrato de saída do copiloto AO VIVO da ligação (Haiku, uma chamada por
 * bloco de áudio transcrito).
 *
 * DIFERENÇA PARA `lib/sala-reunioes/live-schema.ts`, e por que não é o mesmo
 * arquivo: lá as fases são as do SPIN de uma reunião de uma hora e a cobertura
 * é um `record` livre, porque o overlay do Meet não desenha checklist. Aqui a
 * ligação dura cinco minutos, tem SEIS itens fechados, e o popup os desenha em
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
 * vivo cobriu a ligação inteira ou parou no meio. Quinze segundos é o ponto em
 * que a sugestão ainda chega a tempo de ser dita e o Whisper ainda tem contexto
 * suficiente para não picotar palavra.
 */
export const LIVE_CHUNK_SECONDS = 15;

/** Onde a ligação de qualificação está agora. Ver `lib/calls/live-prompt.ts`. */
export const CALL_PHASES = [
  "abertura",
  "situacao",
  "dor",
  "decisor",
  "agendamento",
  "encerramento",
] as const;
export type CallPhase = (typeof CALL_PHASES)[number];

export const CALL_PHASE_LABELS: Record<CallPhase, string> = {
  abertura: "Abertura",
  situacao: "Entender o negócio",
  dor: "Dor",
  decisor: "Quem decide",
  agendamento: "Marcar a reunião",
  encerramento: "Encerramento",
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
  entendeu_o_negocio: z.boolean().default(false),
  dor_declarada: z.boolean().default(false),
  decisor_identificado: z.boolean().default(false),
  reuniao_proposta: z.boolean().default(false),
  dia_e_hora_confirmados: z.boolean().default(false),
});
export type Cobertura = z.infer<typeof CoberturaSchema>;

export type CoberturaKey = keyof Cobertura;

export const COBERTURA_LABELS: Record<CoberturaKey, string> = {
  abriu_sem_pergunta: "Se apresentou e disse o motivo",
  entendeu_o_negocio: "Entendeu o negócio dele",
  dor_declarada: "Ele falou de um problema",
  decisor_identificado: "Descobriu quem decide",
  reuniao_proposta: "Ofereceu dois horários",
  dia_e_hora_confirmados: "Dia e hora confirmados",
};

export const COBERTURA_VAZIA: Cobertura = CoberturaSchema.parse({});

export const LiveCallSuggestionSchema = z.object({
  fase: z.enum(CALL_PHASES),
  /**
   * 5-12 palavras, uma pergunta pronta para o SDR falar em voz alta. O teto de
   * caracteres é a guarda dura: o prompt PEDE curto, o schema RECUSA longo.
   * Uma sugestão de três linhas no meio de uma ligação não é lida — é ignorada,
   * e junto com ela o resto da tela.
   */
  sugestao: z.string().trim().min(5).max(120),
  /** Quase sempre null. Só quando o SDR furou uma regra do roteiro. */
  alerta: z.string().trim().min(3).max(90).nullable().default(null),
  cobertura: CoberturaSchema.default(COBERTURA_VAZIA),
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
 */
export const LiveStateSchema = z.object({
  fase: z.enum(CALL_PHASES).optional(),
  sugestao: z.string().optional(),
  alerta: z.string().nullable().optional(),
  cobertura: CoberturaSchema.optional(),
  chunks: z.number().int().min(0).optional(),
});
export type LiveState = z.infer<typeof LiveStateSchema>;

export function parseLiveState(cru: unknown): LiveState {
  const parsed = LiveStateSchema.safeParse(cru ?? {});
  return parsed.success ? parsed.data : {};
}
