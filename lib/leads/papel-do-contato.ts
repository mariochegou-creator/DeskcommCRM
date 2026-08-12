/**
 * Quem é essa pessoa dentro do negócio — o vocabulário dos contatos vinculados.
 *
 * Um negócio tem UM contato de origem (`crm_leads.contact_id`: quem atendeu o
 * telefone, quem respondeu o primeiro toque) e, do segundo toque em diante,
 * quase sempre ganha outros — o sócio que decide, o filho que cuida do
 * WhatsApp, o financeiro que assina. Esses entram por `crm_lead_links`
 * (`target_kind='contact'`, `link_kind` = o papel), que é a mesma via que a
 * cascata LGPD já varre desde a 0071.
 *
 * O PAPEL É O QUE FAZ O VÍNCULO VALER. "Este negócio tem 2 contatos" responde
 * pouco; "o decisor é o outro número" muda para quem o SDR liga. Por isso o
 * papel não é opcional na hora de vincular: um vínculo sem papel obrigaria
 * quem lê a abrir a conversa para descobrir de quem é o número — que é
 * exatamente o trabalho que vincular deveria ter poupado.
 *
 * SEM CHECK NO BANCO, de propósito, e a razão é a mesma de
 * `crm_lead_activities.type`: `link_kind` é coluna COMPARTILHADA por vínculos
 * de outros alvos (pedido, conversa), e um CHECK de conjunto nela quebraria no
 * `update.sh` de qualquer clone com um `link_kind` legado que não conhecemos.
 * O banco aceita; quem escreve daqui é que fica preso a esta lista.
 */

export type PapelDoContato = "decisor" | "socio" | "financeiro" | "tecnico" | "outro";

export const PAPEIS_DO_CONTATO: readonly PapelDoContato[] = [
  "decisor",
  "socio",
  "financeiro",
  "tecnico",
  "outro",
] as const;

/**
 * O rótulo da tela. `Record` exaustivo pelo mesmo motivo de `ACTIVITY_LABELS`:
 * papel novo sem rótulo não compila, e não existe caminho para a tela mostrar
 * o valor cru do banco.
 */
export const ROTULO_DO_PAPEL: Record<PapelDoContato, string> = {
  decisor: "Decisor",
  socio: "Sócio",
  financeiro: "Financeiro",
  tecnico: "Técnico",
  outro: "Outro",
};

/**
 * O contato de ORIGEM do negócio não tem linha em `crm_lead_links` — ele é a
 * coluna `contact_id` do próprio lead. A tela mostra os dois na mesma lista, e
 * este é o rótulo do primeiro: não é um papel escolhido por ninguém, é de onde
 * o negócio nasceu.
 */
export const ROTULO_DO_CONTATO_DE_ORIGEM = "Contato principal";

export function ehPapelDeContato(v: unknown): v is PapelDoContato {
  return typeof v === "string" && (PAPEIS_DO_CONTATO as readonly string[]).includes(v);
}

/**
 * O rótulo de um `link_kind` lido do banco. Cai em "Outro" quando o valor não
 * é do vocabulário — a coluna não tem CHECK (ver o cabeçalho), então um valor
 * desconhecido é possível e a tela precisa de alguma coisa para mostrar.
 */
export function rotuloDoPapel(linkKind: string | null | undefined): string {
  return ehPapelDeContato(linkKind) ? ROTULO_DO_PAPEL[linkKind] : ROTULO_DO_PAPEL.outro;
}
