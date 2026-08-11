import { TarefasClient } from "./_components/TarefasClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tarefas" };

/**
 * Tarefas — o que o time combinou de fazer com cada lead (0101).
 *
 * Aba própria, e não uma seção do Painel: o Painel responde "como estamos
 * indo" e é lido de manhã; isto responde "o que eu faço agora" e é aberto
 * várias vezes por dia. O Painel ganhou um resumo com o que vence hoje, que é
 * o quanto de tarefa cabe lá sem afogar as métricas.
 *
 * Sem dado resolvido no servidor: tudo vem de `/api/v1/tasks` por React Query,
 * porque o mesmo hook alimenta o dialog do inbox e o número do menu — três
 * telas lendo a mesma chave se atualizam juntas quando alguém conclui algo.
 */
export default function TarefasPage() {
  return <TarefasClient />;
}
