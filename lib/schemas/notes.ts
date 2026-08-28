import { z } from "zod";

export const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(4096),
  /**
   * Ids citados com @ (0110). A tela resolve o nome → id porque é ela que tem a
   * lista aberta; a rota NÃO confia na lista e confere cada id contra a
   * organização ativa antes de gravar. Teto de 10: menção é toque no ombro, não
   * lista de transmissão.
   */
  mentions: z.array(z.string().uuid()).max(10).optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
