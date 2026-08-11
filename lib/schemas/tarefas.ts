/**
 * Contrato de `/api/v1/tarefas` — criar, listar e resolver tarefas do time.
 *
 * O prazo chega em ISO UTC (instante), diferente do agendamento de reunião que
 * chega em data+hora civis: aqui quem escolhe quase sempre clica num ATALHO
 * ("5h antes da reunião", "em 3 horas") que a tela já calculou com a aritmética
 * de `lib/tarefas/tarefa.ts`. Mandar de volta data e hora civis obrigaria a
 * rota a refazer a mesma conta com outro código — duas aritméticas para o mesmo
 * instante é como os dois lados começam a discordar.
 */
import { z } from "zod";

import { MAX_NOTA, MAX_TITULO, TIPOS_DE_TAREFA } from "@/lib/tarefas/tarefa";

const uuid = z.string().uuid();

/** ISO 8601 que o `Date` entende. Rejeita string vazia e data impossível. */
const instanteIso = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), "due_at precisa ser uma data ISO válida");

export const criarTarefaSchema = z.strictObject({
  title: z.string().trim().min(1).max(MAX_TITULO),
  kind: z.enum(TIPOS_DE_TAREFA as unknown as [string, ...string[]]).default("outro"),
  notes: z.string().trim().max(MAX_NOTA).optional(),
  due_at: instanteIso,
  /**
   * Ausente = para mim. O caso comum é a pessoa criando o próprio lembrete, e
   * exigir a escolha explícita transformaria dois cliques em três.
   */
  assigned_to_user_id: uuid.optional(),
  conversation_id: uuid.optional(),
  contact_id: uuid.optional(),
  lead_id: uuid.optional(),
});
export type CriarTarefaInput = z.infer<typeof criarTarefaSchema>;

/**
 * Uma tarefa pendente pode mudar de estado (feita/cancelada/reaberta), de prazo
 * (adiar) e de dono (passar pro closer). O `.strictObject` recusa campo
 * desconhecido, e o `refine` recusa o PATCH vazio — corpo sem nada seria um
 * 200 que não muda nada, o pior tipo de sucesso.
 */
export const atualizarTarefaSchema = z
  .strictObject({
    status: z.enum(["pending", "done", "canceled"]).optional(),
    due_at: instanteIso.optional(),
    assigned_to_user_id: uuid.optional(),
    title: z.string().trim().min(1).max(MAX_TITULO).optional(),
    notes: z.string().trim().max(MAX_NOTA).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "nada para atualizar");
export type AtualizarTarefaInput = z.infer<typeof atualizarTarefaSchema>;

/**
 * O recorte da lista. `minhas` = as que eu tenho de fazer; `criadas` = as que
 * eu pedi e ainda não voltaram; `alerta` = a UNIÃO das duas, só o que já
 * venceu — é ela que alimenta o número vermelho do menu, e é a razão de
 * "criadas" existir como recorte: quem delega precisa do mesmo aviso de quem
 * executa.
 */
export const ESCOPOS_DE_TAREFA = ["minhas", "criadas", "equipe", "alerta"] as const;
export type EscopoDeTarefa = (typeof ESCOPOS_DE_TAREFA)[number];
