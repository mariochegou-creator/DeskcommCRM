"use client";
/**
 * A lista das reuniões que ainda vão acontecer — o topo da coluna esquerda.
 *
 * Fica ACIMA das que já aconteceram porque a pergunta que traz alguém a esta
 * tela num dia de reunião é "o que tenho pela frente?", não "como fui na
 * semana passada". O que já aconteceu continua logo abaixo, sem sumir.
 *
 * O contador "faltam N" sai do MESMO `montarChecklist` que o painel de preparo
 * desenha — é por isso que o número nunca discorda da lista aberta ao lado.
 */
import { Card } from "@/components/ui/card";
import { ROTULO_DO_TIPO } from "@/lib/agendamento/reuniao";
import type { ProximaReuniao } from "@/hooks/sala-reunioes/usePreparo";
import {
  estaAcontecendo,
  montarChecklist,
  quandoDaReuniao,
  resumoDoChecklist,
} from "@/lib/sala-reunioes/preparo";
import { cn } from "@/lib/utils";

interface Props {
  proximas: ProximaReuniao[];
  selectedLeadId: string | null;
  onSelect: (leadId: string) => void;
  /** Instante congelado pela tela — dois cartões nunca caem em dias diferentes. */
  agora: Date;
}

export function ProximasReunioes({ proximas, selectedLeadId, onSelect, agora }: Props) {
  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Próximas reuniões">
      {proximas.map((p) => {
        const itens = montarChecklist(p.reuniao, agora);
        const { faltam } = resumoDoChecklist(itens);
        const agoraMesmo = estaAcontecendo(p.reuniao, agora);
        const isSelected = p.lead_id === selectedLeadId;

        return (
          <Card
            key={p.lead_id}
            role="listitem"
            tabIndex={0}
            onClick={() => onSelect(p.lead_id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p.lead_id);
              }
            }}
            className={cn(
              "flex cursor-pointer items-center gap-3 p-4 transition-colors",
              "hover:bg-surface-elevated",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
              isSelected && "border-accent bg-surface-elevated",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                agoraMesmo ? "bg-success-fg animate-pulse" : "bg-accent",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text">
                {p.lead_title ?? "Negócio sem nome"}
              </p>
              <p className="text-xs text-text-muted">
                {ROTULO_DO_TIPO[p.reuniao.tipo]} ·{" "}
                {agoraMesmo ? "acontecendo agora" : quandoDaReuniao(p.reuniao, agora)}
              </p>
            </div>
            {/* Só aparece quando falta algo: "0 pendências" é ruído, e o
                cartão sem selo já diz que está pronto. */}
            {faltam > 0 && (
              <span className="shrink-0 rounded-control bg-warning-bg px-2 py-1 text-xs font-semibold text-warning-fg">
                faltam {faltam}
              </span>
            )}
          </Card>
        );
      })}
    </div>
  );
}
