"use client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { useAtualizarFatos } from "@/hooks/inbox/useAtualizarFatos";
import { ArrowsClockwise, CircleNotch, Sparkle, Users, Warning } from "@/lib/ui/icons";
import type { FatosDoCliente as Fatos } from "@/lib/leads/fatos-do-cliente";
import { cn } from "@/lib/utils";

/**
 * QUEM DECIDE, em cima de tudo.
 *
 * Fica colado no nome do contato de propósito, e não lá embaixo com o resto do
 * dossiê: empresa de porte médio põe atendente, secretária ou vendedor no
 * WhatsApp, e quem abre a conversa lê o nome do topo como se fosse o dono. Ler
 * "Sérgio Martins" e falar a semana inteira com quem não assina nada é o erro
 * que esta linha existe para impedir — por isso ela é a PRIMEIRA coisa abaixo
 * do nome, não um item de lista no fim da barra.
 *
 * Some quando a conversa nunca revelou quem decide. Um "Decisor: —" permanente
 * ensinaria a pular a linha justamente nos leads em que ela vai aparecer.
 */
export function DecisorDoCliente({ fatos, className }: { fatos: Fatos; className?: string }) {
  if (!fatos.decisor && fatos.falaComDecisor !== false) return null;

  return (
    <div className={cn("space-y-1", className)} data-testid="decisor-do-cliente">
      {fatos.decisor && (
        <div className="flex items-start gap-1.5 rounded-md bg-accent-soft px-2 py-1.5">
          <Users size={13} weight="regular" aria-hidden className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 text-xs leading-snug">
            <span className="text-muted-foreground">Quem decide: </span>
            <span className="font-semibold text-accent">{fatos.decisor}</span>
          </div>
        </div>
      )}
      {/* Só o `false` vira aviso. `null` é "a conversa não deixou claro", e
          tratar dúvida como alerta faria a tela gritar em todo lead. */}
      {fatos.falaComDecisor === false && (
        <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-bg px-2 py-1.5 text-xs leading-snug text-warning-fg">
          <Warning size={13} weight="regular" aria-hidden className="mt-0.5 shrink-0" />
          <span>Quem responde aqui não é quem decide.</span>
        </div>
      )}
    </div>
  );
}

/**
 * O que o cliente contou — a lista que ACUMULA.
 *
 * A nota "Resumo diário (IA)" fala do dia e é trocada amanhã. Isto aqui é o que
 * vale para sempre sobre o cliente (como ele compra, de que desconfia, há
 * quanto tempo está no ramo) e é o que se lê na hora antes da reunião.
 *
 * `conversationId` null = sem botão: no dossiê do Kanban não existe uma conversa
 * para reler, e um botão que não tem o que fazer é pior que botão nenhum.
 */
export function FatosDoCliente({
  fatos,
  conversationId,
  podeAtualizar = true,
}: {
  fatos: Fatos;
  conversationId?: string | null;
  podeAtualizar?: boolean;
}) {
  const atualizar = useAtualizarFatos(conversationId ?? null);
  const mostrarBotao = Boolean(conversationId) && podeAtualizar;
  const vazio = fatos.fatos.length === 0;

  // Sem nada guardado e sem botão não há seção: no Kanban isso seria um título
  // seguido de "nada ainda" em todo negócio que nunca conversou.
  if (vazio && !mostrarBotao) return null;

  return (
    <section data-testid="fatos-do-cliente">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkle size={12} weight="regular" aria-hidden />O que o cliente contou
        </h3>
        {mostrarBotao && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={atualizar.isPending}
            onClick={() => atualizar.mutate()}
            title="A IA relê a conversa inteira e grava o que for novo no negócio"
          >
            {atualizar.isPending ? (
              <CircleNotch size={12} className="mr-1 animate-spin" weight="regular" aria-hidden />
            ) : (
              <ArrowsClockwise size={12} className="mr-1" weight="regular" aria-hidden />
            )}
            {atualizar.isPending ? "Lendo…" : "Atualizar agora"}
          </Button>
        )}
      </div>

      {vazio ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nada guardado ainda. O resumo das 7h grava sozinho, ou clique em Atualizar agora.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {fatos.fatos.map((f) => (
            <li
              key={f}
              className="whitespace-pre-wrap break-words rounded-md border border-border bg-surface-elevated p-2 text-xs leading-snug"
            >
              {f}
            </li>
          ))}
        </ul>
      )}

      {/* O carimbo não é enfeite: sem ele não dá para saber se a lista já viu o
          áudio de hoje de manhã — que é a única pergunta que importa quando
          alguém abre isto quinze minutos antes da reunião. */}
      {fatos.atualizadoEm && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          IA leu até {format(new Date(fatos.atualizadoEm), "dd/MM/yy HH:mm", { locale: ptBR })}
        </p>
      )}
    </section>
  );
}
