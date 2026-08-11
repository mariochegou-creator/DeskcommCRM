"use client";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { TarefaDialog } from "@/components/tarefas/TarefaDialog";
import { useCrmSummary } from "@/hooks/inbox/useCrmSummary";
import { useSnoozeConversation } from "@/hooks/inbox/useSnoozeConversation";
import { useTarefas } from "@/hooks/tarefas/useTarefas";
import { lerReuniao } from "@/lib/agendamento/reuniao";
import { Clock } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  conversationId: string;
  snoozeUntil: string | null;
  /** Contato da conversa — de onde saem o negócio e a reunião marcada. */
  contactId?: string | null;
  /** Nome do lead, só para o dialog sugerir o título da tarefa. */
  nomeDoLead?: string | null;
  disabled?: boolean;
}

function lembreteAtivo(snoozeUntil: string | null): boolean {
  return snoozeUntil != null && new Date(snoozeUntil).getTime() > Date.now();
}

/**
 * O relógio do cabeçalho da conversa.
 *
 * Continua se chamando SnoozeButton no arquivo (é o botão do snooze da 0062, e
 * renomear o módulo só espalharia diff), mas o que ele abre mudou: era um menu
 * de três durações, virou o dialog de tarefas (0101), com o adiar preservado
 * dentro dele como primeiro bloco. O motivo está no cabeçalho do TarefaDialog.
 *
 * O rótulo conta o que existe: "Tarefas · 2" quando há trabalho combinado neste
 * lead, "Lembrete ativo" quando a conversa está adiada, "Tarefa" no vazio. Um
 * botão que diz sempre a mesma palavra obriga a abrir para saber se tem algo lá
 * dentro — e o que tem lá dentro é justamente o que não pode ser esquecido.
 */
export function SnoozeButton({
  conversationId,
  snoozeUntil,
  contactId = null,
  nomeDoLead = null,
  disabled,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const { snooze, cancel } = useSnoozeConversation();
  const ativo = lembreteAtivo(snoozeUntil);
  const pendenteSnooze = snooze.isPending || cancel.isPending;

  // As duas leituras extras acontecem SEM o dialog aberto, e é deliberado: as
  // duas alimentam o rótulo do botão. Ambas são cacheadas por React Query e o
  // resumo do CRM já é carregado pelo painel lateral desta mesma tela — abrir a
  // conversa não faz uma consulta a mais por causa disto.
  const tarefas = useTarefas({
    escopo: "equipe",
    status: "abertas",
    conversationId,
    enabled: !!conversationId,
  });
  const resumo = useCrmSummary(contactId);

  const lead = resumo.data?.leads?.[0] ?? null;
  const reuniaoEm = useMemo(() => {
    const r = lerReuniao(lead?.custom_fields ?? null);
    return r?.em ?? null;
  }, [lead]);

  const abertas = tarefas.data?.length ?? 0;
  const rotulo = abertas > 0 ? `Tarefas · ${abertas}` : ativo ? "Lembrete ativo" : "Tarefa";

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setAberto(true)}
        className={cn("flex items-center gap-1", abertas > 0 && "border-accent-500 text-text")}
      >
        <Clock size={12} weight="regular" aria-hidden />
        {rotulo}
      </Button>

      <TarefaDialog
        open={aberto}
        onOpenChange={setAberto}
        conversationId={conversationId}
        contactId={contactId}
        leadId={lead?.id ?? null}
        nomeDoLead={nomeDoLead}
        reuniaoEm={reuniaoEm}
        adiar={{
          ativoAte: snoozeUntil,
          pendente: pendenteSnooze,
          onAdiar: (horas) =>
            snooze.mutate({ conversation_id: conversationId, duration_hours: horas }),
          onCancelar: () => cancel.mutate({ conversation_id: conversationId }),
        }}
      />
    </>
  );
}
