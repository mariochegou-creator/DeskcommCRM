/**
 * Zod schema de POST /api/v1/leads/import — a lista de prospecção já parseada
 * no cliente (o CSV nunca viaja cru; a página de importação transforma cada
 * linha neste formato e envia em lotes).
 */
import { z } from "zod";

export const importRowSchema = z.object({
  /** Nome do negócio — vira o título do lead. */
  negocio: z.string().trim().min(1).max(200),
  /** Nome do dono, quando a lista tem — vira o nome do contato; sem ele, o negócio repete. */
  dono: z.string().trim().max(200).optional(),
  telefone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(320).optional(),
  /** Ganchos de abertura da ferramenta de prospecção → custom_fields gancho_abertura, gancho_2, … */
  ganchos: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
  /** Demais colunas do CSV que o usuário quis manter → custom_fields como vieram. */
  extras: z.record(z.string(), z.string().max(2000)).default({}),
});
export type ImportRow = z.infer<typeof importRowSchema>;

/**
 * Máx. 25 linhas por chamada: cada linha custa ~6 queries (dedupe + contato +
 * createLeadHandler com validação de stage, posição, evento e audit). O
 * cliente fatia a lista e manda os lotes em sequência.
 */
export const importLeadsSchema = z.object({
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  file_name: z.string().trim().max(200).optional(),
  rows: z.array(importRowSchema).min(1).max(25),
});
export type ImportLeadsInput = z.infer<typeof importLeadsSchema>;
