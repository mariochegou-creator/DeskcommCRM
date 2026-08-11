"use client";
import Link from "next/link";
import { useMemo } from "react";

import { ListaDeTarefas } from "@/components/tarefas/ListaDeTarefas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonoLabel } from "@/components/ui/mono-label";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useTarefas, type Tarefa } from "@/hooks/tarefas/useTarefas";
import { estadoDoPrazo, mesmoDia } from "@/lib/tarefas/tarefa";

/**
 * "// tarefas de hoje" no Painel — o resumo, não a tela.
 *
 * Mostra só o que está ATRASADO ou vence hoje, das minhas e das que eu pedi. O
 * resto (próximas, resolvidas, filtros) mora na aba Tarefas: um Painel que
 * lista trabalho futuro vira uma segunda caixa de entrada, e aí a pessoa passa
 * a ler as duas.
 *
 * Some inteira quando não há nada vencendo. Seção fixa com "nenhuma tarefa"
 * ocuparia, todo dia, o espaço mais nobre da tela para dizer que não há
 * novidade — e o Painel já tem quatro blocos disputando esse espaço.
 */
export function TarefasDeHojeSection({ now }: { now: Date }) {
  const minhas = useTarefas({ escopo: "minhas", status: "abertas" });
  const pedidas = useTarefas({ escopo: "criadas", status: "abertas" });
  const membros = useAssignableMembers(true);

  const doDia = useMemo(() => {
    // União pelo id: uma tarefa que eu criei PARA MIM aparece nas duas
    // consultas, e sem a deduplicação ela seria listada duas vezes.
    const lista: Tarefa[] = [...(minhas.data ?? []), ...(pedidas.data ?? [])];
    const porId = new Map<string, Tarefa>();
    for (const t of lista) {
      const prazo = new Date(t.due_at);
      const estado = estadoDoPrazo(prazo, now);
      if (estado === "atrasada" || estado === "agora" || mesmoDia(prazo, now)) {
        porId.set(t.id, t);
      }
    }
    return [...porId.values()];
  }, [minhas.data, pedidas.data, now]);

  // Enquanto carrega não há o que mostrar, e um esqueleto aqui piscaria uma
  // seção que talvez nem exista neste dia.
  if (minhas.isLoading || pedidas.isLoading) return null;
  if (doDia.length === 0) return null;

  const atrasadas = doDia.filter((t) => new Date(t.due_at).getTime() <= now.getTime()).length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <MonoLabel>tarefas de hoje</MonoLabel>
          <p className="text-xs text-text-subtle">
            {atrasadas > 0
              ? `${atrasadas} ${atrasadas === 1 ? "vencida" : "vencidas"} · ${doDia.length} no total de hoje`
              : `${doDia.length} ${doDia.length === 1 ? "tarefa" : "tarefas"} para hoje`}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/app/tarefas">Ver todas</Link>
        </Button>
      </div>

      <Card className="p-5">
        <ListaDeTarefas
          tarefas={doDia}
          membros={membros.data ?? []}
          agora={now}
          vazio="Nada para hoje."
        />
      </Card>
    </section>
  );
}
