"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, ArrowRight } from "@/lib/ui/icons";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useReleaseConversation } from "@/hooks/inbox/useReleaseConversation";
import { useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import { useReopenConversation } from "@/hooks/inbox/useReopenConversation";
import { ReassignDialog } from "@/components/inbox/ReassignDialog";
import { SnoozeButton } from "@/components/inbox/SnoozeButton";
import { AvisoDeTarefasDoLead } from "@/components/inbox/AvisoDeTarefasDoLead";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

interface Props {
  conversation: ConversationWithContact;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  claimed: "Em atendimento",
  ai_handling: "IA atendendo",
  closed: "Fechada",
  archived: "Arquivada",
};

export function ConversationHeader({ conversation }: Props) {
  const { user } = useAuth();
  const claim = useClaimConversation();
  const release = useReleaseConversation();
  const close = useCloseConversation();
  const reopen = useReopenConversation();
  const [reassignOpen, setReassignOpen] = useState(false);

  const c = conversation.contacts ?? null;
  const displayName = c?.display_name?.trim() || c?.name?.trim() || c?.phone_number || "Sem nome";
  const phone = c?.phone_number ?? null;
  const status = conversation.status;
  const isMineAssigned = conversation.assigned_to_user_id === user.id;
  const isClosed = status === "closed";
  // Conversa fechada não entra na fila: "Assumir" daria a impressão de que dá
  // para responder, e o composer continua desligado até reabrir.
  const isOpen = !isClosed && (status === "open" || conversation.assigned_to_user_id == null);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{displayName}</h2>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            {STATUS_LABEL[status] ?? status}
          </Badge>
        </div>
        {phone && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Phone size={11} weight="regular" aria-hidden /> {phone}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isClosed && (
          <Button
            size="sm"
            variant="default"
            disabled={reopen.isPending}
            onClick={() => reopen.mutate({ conversation_id: conversation.id })}
          >
            Reabrir
          </Button>
        )}
        {isOpen && (
          <Button
            size="sm"
            variant="default"
            disabled={claim.isPending}
            onClick={() =>
              claim.mutate({
                conversation_id: conversation.id,
                expected_assignee: conversation.assigned_to_user_id,
              })
            }
          >
            Assumir
          </Button>
        )}
        {isMineAssigned && (
          <Button
            size="sm"
            variant="outline"
            disabled={release.isPending}
            onClick={() => release.mutate({ conversation_id: conversation.id })}
          >
            Liberar
          </Button>
        )}
        {status !== "closed" && status !== "archived" && (
          <Button size="sm" variant="outline" onClick={() => setReassignOpen(true)}>
            Transferir
          </Button>
        )}
        {status !== "closed" && status !== "archived" && (
          <SnoozeButton
            conversationId={conversation.id}
            snoozeUntil={conversation.snooze_until ?? null}
            contactId={c?.id ?? null}
            nomeDoLead={displayName}
          />
        )}
        {status !== "closed" && status !== "archived" && (
          <Button
            size="sm"
            variant="outline"
            disabled={close.isPending}
            onClick={() => {
              if (confirm("Fechar esta conversa?")) {
                close.mutate({ conversation_id: conversation.id });
              }
            }}
          >
            Fechar
          </Button>
        )}
        {c?.id && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/app/contacts/${c.id}`} className="flex items-center gap-1">
              Ver contato
              <ArrowRight size={12} weight="regular" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
      <ReassignDialog
        conversationId={conversation.id}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />
      {/* Vale também para conversa fechada, ao contrário do relógio ao lado: o
          combinado com o lead não deixa de existir porque a conversa foi
          encerrada — é justamente aí que ele some da vista. A chave `key`
          remonta o componente ao trocar de conversa, para o aviso da próxima
          não herdar o estado da anterior. */}
      <AvisoDeTarefasDoLead
        key={conversation.id}
        conversationId={conversation.id}
        nomeDoLead={displayName}
      />
    </div>
  );
}
