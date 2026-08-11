import type { QueryClient } from "@tanstack/react-query";

import { CRM_SUMMARY_KEY } from "@/hooks/inbox/useCrmSummary";

/**
 * Quem lê um negócio na tela — e portanto quem precisa reler quando ele muda.
 *
 * Eram DOIS leitores desde o dia em que o painel do inbox passou a mostrar (e
 * deixar mexer em) etapa e tags: o board do Kanban e o painel. Cada mutação
 * invalidando só o board deixaria o painel exibindo a etapa antiga logo depois
 * de o próprio atendente tê-la mudado por ali — e o jeito de descobrir seria
 * recarregar a página, que é o mesmo que dizer "não confie na tela".
 *
 * Peça única de propósito: a lista de leitores cresce (radar, métricas), e o
 * lugar de acrescentar um é aqui, não em cada `onSettled` espalhado.
 */
export function invalidaLeitoresDeLead(qc: QueryClient, pipelineId: string): void {
  qc.invalidateQueries({ queryKey: ["board", pipelineId] });
  // Sem o contato na chave: quem move o lead nem sempre sabe de quem ele é, e
  // o painel só tem um contato aberto por vez — invalidar todos custa nada.
  qc.invalidateQueries({ queryKey: [CRM_SUMMARY_KEY] });
}
