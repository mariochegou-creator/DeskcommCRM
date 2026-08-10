/**
 * O contrato da ANÁLISE pós-reunião (Sonnet, uma vez por reunião encerrada).
 *
 * `resultado` espelha o CHECK `crm_meetings_outcome_check` (0098) via
 * MEETING_OUTCOMES e `fases[].fase` espelha o CHECK de fases — os dois sob o
 * invariante banco×TypeScript. O que não passar no Zod cai no caminho
 * `concluida_sem_formato` (o texto cru fica legível em coaching.raw), nunca
 * vira NaN numa média.
 */
import { z } from "zod";

import { MEETING_OUTCOMES, MEETING_PHASES } from "@/lib/sala-reunioes/vocabulary";

export const MeetingAnalysisSchema = z.object({
  resultado: z.enum(MEETING_OUTCOMES),
  nota_geral: z.number().min(0).max(10),
  /** 3-5 linhas de resumo — o que a reunião foi, direto. */
  resumo: z.string().trim().min(20).max(1_500),
  /** Nota + comentário de UMA frase por fase executada (só as que ocorreram). */
  fases: z
    .array(
      z.object({
        fase: z.enum(MEETING_PHASES),
        nota: z.number().min(0).max(10),
        comentario: z.string().trim().min(3).max(400),
      }),
    )
    .min(1)
    .max(11),
  coaching: z.object({
    acertos: z.array(z.string().trim().min(3).max(400)).max(5),
    melhorias: z.array(z.string().trim().min(3).max(400)).max(5),
    /** Cada uma citando um dado REAL da transcrição — regra da skill r1. */
    perguntas_que_faltaram: z.array(z.string().trim().min(3).max(400)).max(3),
  }),
  /**
   * Veredito por sugestão exibida ao vivo, pelo número (1-based) da lista que
   * o prompt apresentou — o modelo não conhece os UUIDs.
   */
  sugestoes: z
    .array(z.object({ n: z.number().int().min(1), seguiu: z.boolean() }))
    .max(200)
    .default([]),
});
export type MeetingAnalysis = z.infer<typeof MeetingAnalysisSchema>;

/** Mesma tolerância a cerca de código do parse das ligações e do live. */
export function parseMeetingAnalysis(texto: string): MeetingAnalysis | null {
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

  const parsed = MeetingAnalysisSchema.safeParse(cru);
  return parsed.success ? parsed.data : null;
}
