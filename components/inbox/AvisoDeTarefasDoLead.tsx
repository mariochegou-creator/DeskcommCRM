"use client";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListaDeTarefas } from "@/components/tarefas/ListaDeTarefas";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useTarefas, type Tarefa } from "@/hooks/tarefas/useTarefas";
import {
  carimboDoDia,
  chaveDoAviso,
  precisaAvisar,
  tarefasParaAvisar,
} from "@/lib/tarefas/aviso-do-dia";

interface Props {
  conversationId: string;
  /** Nome que aparece no cabeçalho da conversa — só para o texto do aviso. */
  nomeDoLead?: string | null;
}

/**
 * O pop-up que aparece na PRIMEIRA vez do dia em que se abre um lead que tem
 * tarefa para hoje. O porquê e as três regras estão em `lib/tarefas/aviso-do-dia`.
 *
 * A leitura das tarefas é a MESMA do relógio do cabeçalho (mesmas opções ⇒
 * mesma chave no React Query): abrir a conversa não faz uma consulta a mais por
 * causa deste componente.
 *
 * O carimbo vai no `localStorage` no momento em que o aviso APARECE, não no
 * clique do "Entendi": quem fecha a aba sem clicar já viu, e reabrir a conversa
 * cinco minutos depois para tomar o mesmo susto é justamente o que transforma
 * aviso em incômodo.
 */
export function AvisoDeTarefasDoLead({ conversationId, nomeDoLead }: Props) {
  const tarefas = useTarefas({
    escopo: "equipe",
    status: "abertas",
    conversationId,
    enabled: !!conversationId,
  });
  const membros = useAssignableMembers(true);

  /** Congelado na abertura: os rótulos de prazo do aviso não podem escorregar. */
  const [aviso, setAviso] = useState<{ tarefas: Tarefa[]; agora: Date } | null>(null);

  useEffect(() => {
    if (!conversationId || !tarefas.data) return;

    const agora = new Date();
    const doDia = tarefasParaAvisar(tarefas.data, agora);
    if (doDia.length === 0) return;

    const chave = chaveDoAviso(conversationId);
    let carimbo: string | null = null;
    try {
      carimbo = window.localStorage.getItem(chave);
    } catch {
      // Navegador com armazenamento bloqueado: sem memória do que já foi
      // avisado, o aviso deixa de aparecer em vez de aparecer toda hora.
      return;
    }
    if (!precisaAvisar(carimbo, agora)) return;

    try {
      window.localStorage.setItem(chave, carimboDoDia(agora));
    } catch {
      return;
    }
    setAviso({ tarefas: doDia, agora });
  }, [conversationId, tarefas.data]);

  if (!aviso) return null;

  const uma = aviso.tarefas.length === 1;
  const nome = (nomeDoLead ?? "").trim();

  return (
    <Dialog open onOpenChange={(v) => !v && setAviso(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {uma ? "Tem uma tarefa para hoje" : `Tem ${aviso.tarefas.length} tarefas para hoje`}
          </DialogTitle>
          <DialogDescription>
            {nome.length > 0 ? `Combinado neste lead: ${nome}.` : "Combinado neste lead."} Dá para
            marcar como feita aqui mesmo.
          </DialogDescription>
        </DialogHeader>

        {/* Sem `compacta`: é aqui que a NOTA aparece — o recado que quem pediu
            deixou junto ("o sócio é quem decide", "só atende depois das 18h").
            Esconder isso deixaria o aviso com metade da informação. */}
        <ListaDeTarefas tarefas={aviso.tarefas} membros={membros.data ?? []} agora={aviso.agora} />

        <DialogFooter>
          <Button onClick={() => setAviso(null)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
