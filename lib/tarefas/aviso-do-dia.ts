/**
 * O aviso de uma vez por dia: "hoje tem tarefa neste lead".
 *
 * A tarefa já aparecia no botão do relógio ("Tarefas · 2") e na aba Tarefas —
 * as duas exigem que a pessoa OLHE. Quem abre uma conversa está lendo a última
 * mensagem do lead, não conferindo o cabeçalho; o combinado com hora marcada
 * passava batido justamente na tela em que ele seria executado.
 *
 * Três decisões:
 *
 * 1. **Uma vez por dia POR LEAD, não por sessão.** Quem trabalha a fila abre a
 *    mesma conversa seis vezes numa manhã; um pop-up a cada abertura seria
 *    fechado sem ler já na terceira — e aí não avisa mais nada, mesmo aparecendo.
 *
 * 2. **O carimbo é o DIA CIVIL da Bahia**, não um "faz 24 horas". A operação
 *    pensa em dias ("hoje tem isso pra fazer"), e um relógio de 24h faria o
 *    aviso das 8h de segunda reaparecer às 8h01 de terça e nunca mais no resto
 *    da terça.
 *
 * 3. **Atrasada de ontem também avisa.** O aviso é sobre o que está pendente
 *    AGORA neste lead; esconder o que venceu ontem seria esconder exatamente o
 *    que mais precisa aparecer.
 *
 * Módulo PURO: `agora` entra por parâmetro e o carimbo é só uma string — quem
 * lê e escreve no `localStorage` é o componente.
 */
import { dataCivilBahia } from "@/lib/agendamento/reuniao";
import { mesmoDia } from "@/lib/tarefas/tarefa";

export interface TarefaParaAvisar {
  status: string;
  due_at: string;
}

/**
 * As tarefas que merecem o pop-up: pendentes que vencem hoje ou já venceram.
 *
 * O que está marcado para depois de hoje fica de fora — avisar hoje sobre uma
 * ligação de sexta treina a pessoa a fechar o aviso sem ler.
 */
export function tarefasParaAvisar<T extends TarefaParaAvisar>(tarefas: T[], agora: Date): T[] {
  return tarefas.filter((t) => {
    if (t.status !== "pending") return false;
    const prazo = new Date(t.due_at);
    if (Number.isNaN(prazo.getTime())) return false;
    return prazo.getTime() <= agora.getTime() || mesmoDia(prazo, agora);
  });
}

/** A chave do carimbo no `localStorage` — uma por conversa. */
export function chaveDoAviso(conversationId: string): string {
  return `nexo:aviso-tarefa:${conversationId}`;
}

/** O carimbo de hoje: "2026-08-12" (dia civil da Bahia). */
export function carimboDoDia(agora: Date): string {
  return dataCivilBahia(agora);
}

/** Já avisei hoje sobre este lead? Carimbo ausente ou de outro dia ⇒ avisa. */
export function precisaAvisar(carimbo: string | null, agora: Date): boolean {
  return carimbo !== carimboDoDia(agora);
}
