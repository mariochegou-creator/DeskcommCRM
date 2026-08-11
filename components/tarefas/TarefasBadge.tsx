"use client";
import { useAlertaDeTarefas } from "@/hooks/tarefas/useTarefas";
import { cn } from "@/lib/utils";

/**
 * O número vermelho ao lado de "Tarefas" no menu — o alerta pedido: quem tem de
 * fazer E quem pediu veem o mesmo aviso, porque a consulta une os dois lados
 * (escopo=alerta).
 *
 * Conta só o que JÁ VENCEU. Contar tudo que está aberto transformaria o badge
 * num número que nunca zera, e badge que nunca zera é badge que ninguém mais
 * olha — o mesmo caminho que o `unread_count` percorreu antes da 0099.
 *
 * Mora ao lado do item de menu, e não no sino da topbar, de propósito: o sino é
 * a central de avisos do RUNTIME do agente (`agent_inbox_items`, por
 * organização). Tarefa é trabalho de PESSOA. Empilhar as duas coisas no mesmo
 * contador faria "3" querer dizer duas coisas diferentes ao mesmo tempo.
 */
export function TarefasBadge({ className }: { className?: string }) {
  const { data } = useAlertaDeTarefas();
  const total = data?.length ?? 0;
  if (total === 0) return null;

  const rotulo = `${total} tarefa${total === 1 ? "" : "s"} vencida${total === 1 ? "" : "s"}`;

  return (
    <span
      title={rotulo}
      aria-label={rotulo}
      className={cn(
        "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground",
        className,
      )}
    >
      {total > 99 ? "99+" : total}
    </span>
  );
}
