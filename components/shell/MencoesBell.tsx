"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMarcarMencaoVista, useMencoes, type Mencao } from "@/hooks/inbox/useMencoes";
import { At } from "@/lib/ui/icons";
import { TOPBAR_BADGE, TOPBAR_ICON_BUTTON } from "./icon-button";

/**
 * "Olha isso aqui" (0110): o @ do topo acende quando alguém te cita numa nota
 * interna, e o clique abre a conversa.
 *
 * Ao lado do sino, não DENTRO dele, de propósito: o sino é a central de avisos
 * do RUNTIME do agente (`agent_inbox_items`, por organização). Menção é uma
 * pessoa chamando outra. Somar as duas faria "3" querer dizer duas coisas ao
 * mesmo tempo — a mesma razão que manteve o badge de tarefas fora do sino.
 *
 * Some da tela quando não há nada pendente: ícone apagado permanente vira
 * moldura, e a topbar já tem quatro controles.
 */
function quando(iso: string): string {
  const d = new Date(iso);
  return isToday(d) ? format(d, "HH:mm") : format(d, "dd/MM 'às' HH:mm", { locale: ptBR });
}

export function MencoesBell() {
  const [aberto, setAberto] = useState(false);
  const { data } = useMencoes();
  const marcarVista = useMarcarMencaoVista();
  const router = useRouter();
  const mencoes = data ?? [];
  if (mencoes.length === 0) return null;

  function abrir(m: Mencao) {
    setAberto(false);
    marcarVista.mutate(m.id);
    router.push(`/app/inbox?id=${m.conversation_id}`);
  }

  const rotulo = `${mencoes.length} menç${mencoes.length === 1 ? "ão" : "ões"} pra você`;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        aria-label={rotulo}
        data-testid="mencoes-bell"
        className={TOPBAR_ICON_BUTTON}
      >
        <At size={18} aria-hidden />
        <span data-testid="mencoes-bell-count" className={TOPBAR_BADGE}>
          {mencoes.length > 99 ? "99+" : mencoes.length}
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-1">
        <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          Te marcaram numa nota
        </p>
        {mencoes.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => abrir(m)}
            className="flex w-full flex-col items-start gap-0.5 rounded-control px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-elevated"
          >
            <span className="text-xs font-medium text-text">
              {m.autor}
              {m.cliente ? ` · ${m.cliente}` : ""}
            </span>
            <span className="line-clamp-2 text-xs text-text-muted">{m.body}</span>
            <span className="text-[10px] text-text-subtle">{quando(m.created_at)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
