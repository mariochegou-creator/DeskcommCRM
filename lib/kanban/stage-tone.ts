import type { Stage } from "@/lib/kanban/types";

/**
 * Tom visual de uma etapa do funil.
 *
 * O briefing nomeia as etapas do desenho de referência (Entrada de leads = azul,
 * R1 agendada = amarelo, Proposta = ciano, Fechado = verde, Perdido = vermelho),
 * mas as etapas REAIS vêm de `crm_stages`: nome livre, definido por quem
 * configura o pipeline, e cada organização escolhe os seus. Casar por nome
 * ("se chama 'Proposta' então é ciano") quebraria no primeiro tenant que
 * escrevesse "Proposta enviada" ou "Orçamento".
 *
 * Então o tom sai da SEMÂNTICA que o banco já guarda:
 *   - `is_lost` → perdido (vermelho)
 *   - `is_won`  → fechado (verde)
 *   - as demais, por POSIÇÃO no funil: a primeira é entrada (azul), a última
 *     aberta é proposta (ciano — o degrau mais perto do fechamento), e o miolo
 *     é r1 (âmbar).
 *
 * Assim um pipeline de 3 etapas e um de 8 recebem os mesmos extremos, e o
 * gradiente do meio continua legível. `color` da etapa (coluna livre) NÃO é
 * usado aqui de propósito: é hex arbitrário escolhido por quem configurou, sem
 * garantia nenhuma de contraste contra o navy.
 */
export type StageTone = "entrada" | "r1" | "proposta" | "fechado" | "perdido";

export function stageTone(stage: Stage, openStages: Stage[]): StageTone {
  if (stage.is_lost) return "perdido";
  if (stage.is_won) return "fechado";

  const index = openStages.findIndex((s) => s.id === stage.id);
  if (index <= 0) return "entrada";
  if (index === openStages.length - 1) return "proposta";
  return "r1";
}

/** As etapas abertas (nem ganho nem perdido), na ordem do funil. */
export function openStagesOf(stages: Stage[]): Stage[] {
  return stages
    .filter((s) => !s.is_won && !s.is_lost && !s.is_archived)
    .sort((a, b) => a.position - b.position);
}

/**
 * Classes Tailwind por tom. Mapa literal e não template string
 * (`bg-stage-${tone}/12`) porque o Tailwind varre o código como TEXTO: uma
 * classe montada em runtime nunca entra no CSS gerado e o pill sairia sem cor
 * nenhuma em produção.
 *
 * O fundo é o hex da etapa a 12% via `color-mix`, e o texto é o hex cheio —
 * o par translúcido/saturado que a regra do sistema pede para todo status.
 */
export const STAGE_PILL_CLASS: Record<StageTone, string> = {
  entrada: "bg-[color-mix(in_srgb,var(--stage-entrada)_12%,transparent)] text-stage-entrada",
  r1: "bg-[color-mix(in_srgb,var(--stage-r1)_12%,transparent)] text-stage-r1",
  proposta: "bg-[color-mix(in_srgb,var(--stage-proposta)_12%,transparent)] text-stage-proposta",
  fechado: "bg-[color-mix(in_srgb,var(--stage-fechado)_12%,transparent)] text-stage-fechado",
  perdido: "bg-[color-mix(in_srgb,var(--stage-perdido)_12%,transparent)] text-stage-perdido",
};

/** Cor sólida do tom — header do card de resumo do funil e bolinha de legenda. */
export const STAGE_SOLID_VAR: Record<StageTone, string> = {
  entrada: "var(--stage-entrada)",
  r1: "var(--stage-r1)",
  proposta: "var(--stage-proposta)",
  fechado: "var(--stage-fechado)",
  perdido: "var(--stage-perdido)",
};
