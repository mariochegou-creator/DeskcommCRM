/**
 * Contrato de `/api/v1/leads/[id]/contatos` — os contatos vinculados ao
 * negócio, além do de origem.
 *
 * O telefone chega em TEXTO CRU, do jeito que o vCard trazia, e a rota
 * normaliza. A tentação era exigir E.164 do cliente (o navegador já leu o
 * cartão, afinal) — mas isso põe a regra do nono dígito, que a migration 0102
 * passou um dia inteiro consertando, em dois lugares. Quem grava é quem
 * normaliza; a leitura do navegador serve para MOSTRAR o cartão, não para
 * decidir a identidade.
 */
import { z } from "zod";

import { PAPEIS_DO_CONTATO } from "@/lib/leads/papel-do-contato";

/** Nome de pessoa cabe nisso; acima é texto colado por engano. */
export const MAX_NOME_DO_CONTATO = 120;

export const vincularContatoSchema = z.strictObject({
  /**
   * Como veio no cartão. `telefoneE164` decide se dá para confiar — e é ele que
   * recusa o número sem DDD, que é o caso em que o vínculo nasceria inútil.
   */
  telefone: z.string().trim().min(1).max(40),
  /**
   * Só é usado quando o contato NASCE aqui: contato que já existe nunca é
   * renomeado pelo cartão. O nome da agenda de quem mandou ("Zé da peça 2")
   * não é melhor que o nome que o CRM já tinha — e sobrescrever apagaria o
   * cadastro que alguém digitou.
   */
  nome: z.string().trim().min(1).max(MAX_NOME_DO_CONTATO),
  papel: z.enum(PAPEIS_DO_CONTATO as unknown as [string, ...string[]]).default("outro"),
  /**
   * De onde o cartão veio, para a procedência do vínculo. Sem PII (ver o
   * comment de `crm_lead_links.metadata` na 0103).
   */
  origem: z.enum(["vcard", "manual"]).default("manual"),
  message_id: z.string().uuid().optional(),
});
export type VincularContatoInput = z.infer<typeof vincularContatoSchema>;
