/**
 * importKaptarSchema → POST /api/v1/leads/import/kaptar
 *
 * O CSV é lido no navegador (para a pré-visualização) pelo mesmo módulo puro
 * que valida aqui — `lib/import/kaptar`. Mesmo assim TUDO é revalidado no
 * servidor: o cliente é conveniência, não fonte de verdade. Em especial o
 * telefone, que precisa chegar em E.164 ou o CHECK do banco derruba o insert.
 */
import { z } from "zod";

/** Teto por requisição. A tela fatia a lista e mostra progresso — 587 leads não cabem num request só sem estourar timeout. */
export const KAPTAR_LOTE_MAX = 250;

const leadKaptarSchema = z.object({
  linha: z.number().int().positive(),
  nome: z.string().min(1).max(300),
  placeId: z.string().min(1).max(255).nullable(),
  /** Mesmo formato do CHECK `contacts_phone_e164_format`. */
  telefone: z.string().regex(/^\+\d{8,15}$/),
  email: z.string().email().nullable(),
  site: z.string().max(500).nullable(),
  instagram: z.string().max(500).nullable(),
  temSite: z.boolean(),
  categoria: z.string().max(120).nullable(),
  cidade: z.string().max(120).nullable(),
  estado: z.string().max(60).nullable(),
  score: z.number().int().nullable(),
  avaliacao: z.number().nullable(),
  numAvaliacoes: z.number().int().nullable(),
  criadoEm: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Ganchos de abertura da lista enriquecida. `.default([])`: lote antigo sem o campo continua válido. */
  ganchos: z.array(z.string().min(1).max(2000)).max(10).default([]),
});

export const importKaptarSchema = z.object({
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  leads: z.array(leadKaptarSchema).min(1).max(KAPTAR_LOTE_MAX),
});

export type ImportKaptarInput = z.infer<typeof importKaptarSchema>;
export type LeadKaptarInput = z.infer<typeof leadKaptarSchema>;
