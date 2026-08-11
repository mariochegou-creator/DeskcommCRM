"use client";
import Link from "next/link";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/auth/AuthProvider";
import type { AssignableMember } from "@/hooks/inbox/useAssignableMembers";
import { useAtualizarTarefa, type Tarefa } from "@/hooks/tarefas/useTarefas";
import { ArrowRight, Check, DotsThree } from "@/lib/ui/icons";
import {
  ROTULO_DO_TIPO,
  compararTarefas,
  estadoDoPrazo,
  formatarPrazo,
} from "@/lib/tarefas/tarefa";
import { cn } from "@/lib/utils";

interface Props {
  tarefas: Tarefa[];
  carregando?: boolean;
  erro?: boolean;
  membros?: AssignableMember[];
  vazio?: string;
  /** Densa: some com a nota e com o link, para caber dentro do dialog. */
  compacta?: boolean;
  /** Instante congelado pela tela (mesma regra do resto do CRM). */
  agora?: Date;
}

/**
 * A lista de tarefas — a MESMA peça no dialog do inbox, na aba Tarefas e no
 * Painel.
 *
 * Uma peça só porque as três telas respondem a mesma pergunta e precisam
 * concordar sobre o que é "atrasada". Quando esse cálculo vivia em dois lugares
 * (foi assim que o Painel e a seção do plano começaram), bastou uma mudança de
 * fuso num deles para as duas telas discordarem sobre a mesma linha.
 */
export function ListaDeTarefas({
  tarefas,
  carregando = false,
  erro = false,
  membros = [],
  vazio = "Nenhuma tarefa.",
  compacta = false,
  agora,
}: Props) {
  const { user } = useAuth();
  const atualizar = useAtualizarTarefa();
  const instante = useMemo(() => agora ?? new Date(), [agora]);

  const nomePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const membro of membros) {
      m.set(membro.user_id, membro.full_name ?? `Atendente ${membro.user_id.slice(0, 8)}`);
    }
    return m;
  }, [membros]);

  function nome(id: string | null): string {
    if (!id) return "—";
    if (id === user.id) return "eu";
    return nomePorId.get(id) ?? `Atendente ${id.slice(0, 8)}`;
  }

  const ordenadas = useMemo(() => [...tarefas].sort(compararTarefas), [tarefas]);

  if (carregando) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (erro) {
    return <p className="py-4 text-center text-xs text-error-fg">Não consegui ler as tarefas.</p>;
  }

  if (ordenadas.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{vazio}</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {ordenadas.map((t) => {
        const pendente = t.status === "pending";
        const prazo = new Date(t.due_at);
        const estado = estadoDoPrazo(prazo, instante);
        const urgente = pendente && (estado === "atrasada" || estado === "agora");
        const delegada = t.created_by_user_id !== null && t.created_by_user_id !== t.assigned_to_user_id;

        return (
          <li
            key={t.id}
            className={cn(
              "group flex items-start gap-3 rounded-[10px] border px-3 py-2 transition-colors duration-fast",
              urgente ? "border-destructive/40 bg-destructive/5" : "border-border",
              !pendente && "opacity-70",
            )}
          >
            <button
              type="button"
              aria-label={pendente ? `Concluir "${t.title}"` : `Reabrir "${t.title}"`}
              disabled={atualizar.isPending}
              onClick={() =>
                atualizar.mutate({ id: t.id, status: pendente ? "done" : "pending" })
              }
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
                t.status === "done"
                  ? "border-transparent bg-accent text-accent-foreground"
                  : "border-border-strong bg-transparent text-transparent hover:border-accent-500",
              )}
            >
              <Check size={12} weight="bold" aria-hidden />
            </button>

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-sm",
                  pendente ? "text-text" : "text-text-subtle line-through",
                )}
                title={t.title}
              >
                {t.title}
              </p>

              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>{ROTULO_DO_TIPO[t.kind] ?? t.kind}</span>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    "tabular",
                    pendente && estado === "atrasada" && "font-semibold text-error-fg",
                    pendente && estado === "agora" && "font-semibold text-warning-fg",
                  )}
                >
                  {pendente
                    ? formatarPrazo(prazo, instante)
                    : t.status === "canceled"
                      ? "cancelada"
                      : "feita"}
                </span>
                <span aria-hidden>·</span>
                <span>para {nome(t.assigned_to_user_id)}</span>
                {delegada && (
                  <>
                    <span aria-hidden>·</span>
                    <span>pedida por {nome(t.created_by_user_id)}</span>
                  </>
                )}
              </div>

              {!compacta && t.notes && (
                <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-warning/40 bg-warning-bg p-2 text-xs leading-snug text-warning-fg">
                  {t.notes}
                </p>
              )}
            </div>

            {!compacta && t.conversation_id && (
              <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs">
                <Link href={`/app/inbox?id=${t.conversation_id}`}>
                  Abrir
                  <ArrowRight size={12} className="ml-1" weight="regular" aria-hidden />
                </Link>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Ações de "${t.title}"`}
                  className="h-8 w-8 shrink-0"
                >
                  <DotsThree size={18} weight="bold" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[170px]">
                <DropdownMenuItem
                  onClick={() =>
                    atualizar.mutate({ id: t.id, status: pendente ? "done" : "pending" })
                  }
                >
                  {pendente ? "Concluir" : "Reabrir"}
                </DropdownMenuItem>
                {pendente && (
                  <>
                    {/* Adiar a partir de AGORA, não do prazo antigo: tarefa
                        atrasada empurrada "1 hora" a partir do vencimento
                        continuaria atrasada, e o clique não faria nada visível. */}
                    <DropdownMenuItem
                      onClick={() =>
                        atualizar.mutate({
                          id: t.id,
                          due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                        })
                      }
                    >
                      Adiar 1 hora
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        atualizar.mutate({
                          id: t.id,
                          due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                        })
                      }
                    >
                      Adiar 1 dia
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => atualizar.mutate({ id: t.id, status: "canceled" })}
                    >
                      Cancelar tarefa
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}
