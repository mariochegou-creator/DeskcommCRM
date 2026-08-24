/**
 * O contrato de saída do copiloto AO VIVO da ligação (Haiku, uma chamada por
 * bloco de áudio transcrito).
 *
 * DIFERENÇA PARA `lib/sala-reunioes/live-schema.ts`, e por que não é o mesmo
 * arquivo: lá as fases são as do SPIN de uma reunião de uma hora e a cobertura
 * é um `record` livre, porque o overlay do Meet não desenha checklist. Aqui a
 * ligação dura cinco minutos, tem SETE itens fechados, e o popup os desenha em
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
 * DENTRO da fase "dor", em que degrau a conversa está.
 *
 * A fase "dor" sozinha não bastava. O lead responde "minha dificuldade é só
 * manter a organização" e o copiloto marcava dor_declarada e ia embora para o
 * decisor — o SDR saía da ligação com uma frase vaga que não sustenta uma R1.
 * Uma dor sem tamanho não é dor, é assunto: na reunião o dono não lembra por
 * que aceitou conversar.
 *
 * Os três degraus, sempre nesta ordem:
 * - `aprofundar`: sair do genérico. Fazer o dono contar o caso concreto — o
 *   que exatamente se perde, quando aconteceu a última vez.
 * - `prejuizo`: fazer O DONO (nunca o SDR) botar tamanho — quantos por semana,
 *   quanto vale um cliente, quanto tempo por dia. É o degrau que transforma
 *   "é chato" em "custa X".
 * - `ponte`: uma frase ligando o que ele acabou de dizer ao que a reunião vai
 *   mostrar, e vai marcar. NÃO é vender: sem preço, sem pacote, sem detalhe
 *   técnico — ver a regra de ouro em `live-prompt.ts`.
 */
export const DEGRAUS_DA_DOR = ["aprofundar", "prejuizo", "ponte"] as const;
export type DegrauDaDor = (typeof DEGRAUS_DA_DOR)[number];

export const DEGRAU_LABELS: Record<DegrauDaDor, string> = {
  aprofundar: "Aprofundar a dor",
  prejuizo: "Quanto isso custa",
  ponte: "Ponte para a reunião",
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
  prejuizo_dimensionado: z.boolean().default(false),
  decisor_identificado: z.boolean().default(false),
  reuniao_proposta: z.boolean().default(false),
  dia_e_hora_confirmados: z.boolean().default(false),
});
export type Cobertura = z.infer<typeof CoberturaSchema>;

export type CoberturaKey = keyof Cobertura;

export const COBERTURA_LABELS: Record<CoberturaKey, string> = {
  abriu_sem_pergunta: "Se apresentou e disse o motivo",
  entendeu_o_negocio: "Entendeu o negócio dele",
  dor_declarada: "Ele contou um caso concreto",
  prejuizo_dimensionado: "Ele mesmo disse o tamanho",
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
  /**
   * Em que degrau da dor a conversa está. `null` fora da fase "dor" — e o
   * popup só desenha o rótulo quando vem preenchido, para não inventar etapa
   * onde não há.
   */
  degrau: z.enum(DEGRAUS_DA_DOR).nullable().default(null),
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
  alerta: z.string().nullable().optional(),
  cobertura: CoberturaSchema.optional(),
  chunks: z.number().int().min(0).optional(),
  pendente: z.string().optional(),
  contexto: z.string().nullable().optional(),
});
export type LiveState = z.infer<typeof LiveStateSchema>;

export function parseLiveState(cru: unknown): LiveState {
  const parsed = LiveStateSchema.safeParse(cru ?? {});
  return parsed.success ? parsed.data : {};
}
