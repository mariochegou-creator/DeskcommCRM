import { z } from "zod";

/**
 * Áudios salvos do composer (migration 0095). O create chega por multipart —
 * todo campo vem string, daí o coerce/enum em vez de z.boolean()/z.number().
 */
export const createSavedAudioSchema = z.object({
  title: z.string().trim().min(1).max(80),
  /** "true" = compartilhado da org (owner null, exige manager+); default pessoal. */
  shared: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  duration_seconds: z.coerce.number().int().min(0).max(600).optional(),
});
export type CreateSavedAudioInput = z.infer<typeof createSavedAudioSchema>;

export const updateSavedAudioSchema = z.object({
  title: z.string().trim().min(1).max(80),
});
export type UpdateSavedAudioInput = z.infer<typeof updateSavedAudioSchema>;

export const attachSavedAudioSchema = z.object({
  conversation_id: z.string().uuid(),
});
export type AttachSavedAudioInput = z.infer<typeof attachSavedAudioSchema>;
