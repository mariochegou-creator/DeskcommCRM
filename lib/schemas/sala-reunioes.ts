/**
 * Schemas Zod das rotas /api/v1/meetings/* (Sala de Reuniões, migration 0098)
 * — o contrato entre a extensão do copiloto (e a aba do CRM) e o servidor.
 *
 * Não confundir com `lib/schemas/agendamento.ts`: aquele marca reunião na
 * agenda; este registra a reunião ACONTECENDO (transcrição do Meet).
 */
import { z } from "zod";

import { MEETING_TYPES } from "@/lib/sala-reunioes/vocabulary";

export const createMeetingSchema = z.object({
  meeting_type: z.enum(MEETING_TYPES),
  lead_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  /** Código da sala do Meet (abc-defg-hij) — dedupe/reconexão da extensão. */
  meet_code: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9-]+$/i, "Código de sala inválido.")
    .optional()
    .nullable(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

/**
 * Um turno como a extensão envia. `i` é o índice GLOBAL do turno na reunião —
 * a chave da idempotência do append: o servidor ignora `i < turn_count`.
 */
export const meetingTurnSchema = z.object({
  i: z.number().int().min(0),
  speaker: z.string().trim().min(1).max(200),
  is_self: z.boolean(),
  text: z.string().trim().min(1).max(8_000),
  t: z.number().min(0),
});

export const appendTranscriptSchema = z.object({
  turns: z.array(meetingTurnSchema).min(1).max(200),
});
export type AppendTranscriptInput = z.infer<typeof appendTranscriptSchema>;

export const patchMeetingSchema = z
  .object({
    lead_id: z.string().uuid().nullable().optional(),
    contact_id: z.string().uuid().nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
    meeting_type: z.enum(MEETING_TYPES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para atualizar." });
export type PatchMeetingInput = z.infer<typeof patchMeetingSchema>;

export const listMeetingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.string().optional(),
  meeting_type: z.enum(MEETING_TYPES).optional(),
  lead_id: z.string().uuid().optional(),
  /** Reconexão da extensão: "existe reunião viva nesta sala?" */
  meet_code: z.string().trim().max(64).optional(),
});
