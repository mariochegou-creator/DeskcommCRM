/**
 * Contrato de `/api/v1/client-tags` — o catálogo de tags do cliente (0105).
 *
 * O nome viaja COMO SE ESCREVE ("Cliente VIP"): a normalização para comparação
 * mora em `lib/tags/cores.ts` (`chaveDaTag`) e é aplicada na hora de casar a
 * tag aplicada com a do catálogo, nunca na hora de gravar. Guardar já
 * minúsculo apagaria a única coisa que a pessoa escolheu além da cor.
 */
import { z } from "zod";

import { CORES_DE_TAG } from "@/lib/tags/cores";

/** Casa com o CHECK `crm_client_tags_name_check` (1..40 depois do trim). */
export const MAX_NOME_DE_TAG = 40;

const nome = z.string().trim().min(1).max(MAX_NOME_DE_TAG);
const cor = z.enum(CORES_DE_TAG as unknown as [string, ...string[]]);

export const criarTagDoClienteSchema = z.strictObject({
  name: nome,
  color: cor.default("cinza"),
});
export type CriarTagDoClienteInput = z.infer<typeof criarTagDoClienteSchema>;

/**
 * Renomear e recolorir são o mesmo PATCH, e renomear tem consequência: as tags
 * já aplicadas vivem em `contacts.tags` por NOME. A rota reescreve os contatos
 * afetados na mesma requisição — ver app/api/v1/client-tags/[id]/route.ts.
 */
export const editarTagDoClienteSchema = z
  .strictObject({
    name: nome.optional(),
    color: cor.optional(),
    position: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada para mudar.");
export type EditarTagDoClienteInput = z.infer<typeof editarTagDoClienteSchema>;

/**
 * Aplicar/remover tags de um cliente.
 *
 * A lista chega INTEIRA (o estado final), não como "adiciona X": o editor de
 * chips já sabe o conjunto que quer, e um verbo incremental precisaria de
 * ordenação entre requisições concorrentes para não perder um clique.
 */
export const aplicarTagsDoClienteSchema = z.strictObject({
  tags: z.array(nome).max(20),
});
export type AplicarTagsDoClienteInput = z.infer<typeof aplicarTagsDoClienteSchema>;
