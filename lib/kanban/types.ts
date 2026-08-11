import type { Lead } from "@/lib/types/leads";

export interface PipelineVocabulary {
  lead?: string;
  deal?: string;
  won?: string;
  lost?: string;
}

export interface Pipeline {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  is_archived: boolean;
  position: number;
  vocabulary: PipelineVocabulary;
  settings: Record<string, unknown>;
}

export interface Stage {
  id: string;
  organization_id: string;
  pipeline_id: string;
  name: string;
  slug: string;
  position: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  is_archived: boolean;
  expected_duration_hours: number | null;
}

/**
 * Etapa mais o topo da coluna — a menor `position_in_stage` ocupada nela.
 *
 * Existe para quem move um negócio SEM ter o board na tela (o painel do inbox):
 * ir para o topo é a mesma decisão do arrasto entre colunas, e sem este número
 * não há como calcular o `midpoint` — só chutar uma posição. `null` = coluna
 * vazia.
 */
export interface StageComTopo extends Stage {
  top_position: number | null;
}

/**
 * Uma etapa reduzida ao que um seletor precisa: o nome, e de qual funil ele é.
 *
 * O funil viaja junto porque nome de etapa NÃO é único na org — "Pago" existe
 * em mais de um quadro, e uma lista só de nomes obrigaria a escolher no escuro.
 */
export interface OrgStage {
  id: string;
  name: string;
  pipeline_id: string;
  pipeline_name: string;
}

export interface BoardData {
  pipeline: Pipeline;
  stages: Stage[];
  leads: Lead[];
}
