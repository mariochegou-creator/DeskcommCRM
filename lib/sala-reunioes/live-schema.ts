/**
 * O contrato de saída do copiloto AO VIVO (Haiku, uma chamada por turno do
 * lead). Zod valida faixa e vocabulário — o que não passar cai no retry de
 * formato, e depois do retry o overlay simplesmente mantém a sugestão
 * anterior (sugestão velha é melhor que sugestão inválida).
 *
 * `FASES` espelha o CHECK `crm_meeting_suggestions_phase_check` (0098) via
 * MEETING_PHASES — invariante banco×TypeScript.
 */
import { z } from "zod";

import { MEETING_PHASES } from "@/lib/sala-reunioes/vocabulary";

export const LiveSuggestionSchema = z.object({
  fase: z.enum(MEETING_PHASES),
  /**
   * 5-12 palavras, sempre uma pergunta pronta para falar. O teto de
   * caracteres é a guarda dura — o prompt pede curto, o schema recusa longo
   * (texto longo no overlay é exatamente o que o Mario não consegue absorver).
   */
  sugestao: z.string().trim().min(5).max(140),
  alerta: z.string().trim().min(3).max(120).nullable(),
  /**
   * Checklist livre de cobertura ("ja_tem_numero": true, "meta_declarada":
   * false…). O servidor guarda em `live_state` e devolve na chamada seguinte —
   * é a memória do copiloto entre chamadas, sem reenviar a transcrição toda.
   */
  cobertura: z.record(z.string(), z.unknown()).optional().default({}),
});
export type LiveSuggestion = z.infer<typeof LiveSuggestionSchema>;

/**
 * O JSON de dentro da resposta do modelo — mesma tolerância do parseAnalysis
 * das ligações: cerca de código (```json) é o desvio mais comum e mais barato
 * de aceitar; conteúdo fora do vocabulário NÃO é tolerado (Zod recusa).
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
