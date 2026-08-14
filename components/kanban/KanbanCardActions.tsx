"use client";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CalendarBlank, DotsThree, PencilSimple, Tag, Users } from "@/lib/ui/icons";
import { useAplicarTagsNoCliente, useClientTags } from "@/hooks/tags/useClientTags";
import { CLASSE_DA_BOLINHA, chaveDaTag } from "@/lib/tags/cores";
import { cn } from "@/lib/utils";
import { lerReuniao } from "@/lib/agendamento/reuniao";
import { AgendarReuniaoDialog } from "./AgendarReuniaoDialog";
import { useWinLead, useEditLead } from "@/hooks/kanban/useUpdateLead";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { LoseLeadDialog } from "./LoseLeadDialog";
import { EditLeadDialog } from "./EditLeadDialog";
import type { Lead } from "@/lib/types/leads";

interface KanbanCardActionsProps {
  lead: Lead;
  pipelineId: string;
}

export function KanbanCardActions({ lead, pipelineId }: KanbanCardActionsProps) {
  const [loseOpen, setLoseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // Segunda porta para o agendamento. A primeira é arrastar o card para a
  // coluna de reunião marcada — mas quem fecha aquele dialog sem preencher
  // ficaria sem nenhuma forma de voltar, e um card na coluna certa SEM hora é
  // exatamente a reunião que ninguém lembra de confirmar.
  const [agendarOpen, setAgendarOpen] = useState(false);
  const winMutation = useWinLead(pipelineId);
  const editMutation = useEditLead(pipelineId);
  // spec 13 §4: escrita no funil é agent+ — viewer não reatribui (a rota
  // PATCH também recusa; aqui é só não oferecer o que seria negado).
  const canAssign = usePermission("pipeline.move_card");
  const { data: members } = useAssignableMembers(canAssign);
  // A rota já devolve só agente ativo e não arquivado — é o picker.
  const { data: agents } = useAssignableAgents(canAssign);

  // Tags do cliente (0105). Marcar escreve em `contacts`, não em `crm_leads` —
  // daí a permissão ser `contact.update` e não a do funil, e daí o submenu
  // sumir no card sem contato: não há onde gravar.
  const podeMarcarTag = usePermission("contact.update");
  const { data: catalogo } = useClientTags({ enabled: podeMarcarTag && !!lead.contact_id });
  const aplicarTags = useAplicarTagsNoCliente();
  const tagsDoCliente = lead.client_tags ?? [];
  const chavesAplicadas = new Set(tagsDoCliente.map(chaveDaTag));

  /**
   * Marca/desmarca uma tag preservando o que NÃO está no catálogo.
   *
   * `contacts.tags` recebia texto livre antes da 0105 e ainda recebe da
   * importação de prospecção. Mandar só as do catálogo apagaria essas outras em
   * silêncio — no card do Kanban, onde ninguém as vê para notar a falta.
   */
  const alternarTag = (nome: string) => {
    if (!lead.contact_id) return;
    const doCatalogo = new Set((catalogo ?? []).map((t) => chaveDaTag(t.name)));
    const forasteiras = tagsDoCliente.filter((t) => !doCatalogo.has(chaveDaTag(t)));
    const marcada = chavesAplicadas.has(chaveDaTag(nome));
    const proximas = (catalogo ?? [])
      .filter((t) =>
        chaveDaTag(t.name) === chaveDaTag(nome) ? !marcada : chavesAplicadas.has(chaveDaTag(t.name)),
      )
      .map((t) => t.name);
    aplicarTags.mutate({ contactId: lead.contact_id, tags: [...proximas, ...forasteiras] });
  };

  const reassignToUser = (ownerUserId: string | null) => {
    if (ownerUserId === lead.owner_user_id) return;
    editMutation.mutate({ leadId: lead.id, patch: { owner_user_id: ownerUserId } });
  };

  /** Transferir para um agente: o handler zera o dono humano e deriva owner_kind. */
  const reassignToAgent = (agentId: string) => {
    if (agentId === lead.owner_agent_id) return;
    editMutation.mutate({ leadId: lead.id, patch: { owner_agent_id: agentId } });
  };

  const clearOwner = () => {
    if (lead.owner_user_id === null && lead.owner_agent_id === null) return;
    editMutation.mutate({
      leadId: lead.id,
      patch: lead.owner_agent_id ? { owner_agent_id: null } : { owner_user_id: null },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
            aria-label="Ações do lead"
          >
            <DotsThree size={16} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem
            onSelect={() => {
              setEditOpen(true);
            }}
          >
            <PencilSimple size={14} className="mr-2" /> Editar
          </DropdownMenuItem>
          {canAssign && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Users size={14} className="mr-2" /> Responsável
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  disabled={
                    editMutation.isPending ||
                    (lead.owner_user_id === null && lead.owner_agent_id === null)
                  }
                  onSelect={clearOwner}
                >
                  Sem responsável
                </DropdownMenuItem>
                {(members ?? []).length > 0 && <DropdownMenuSeparator />}
                {(members ?? []).map((m) => (
                  <DropdownMenuItem
                    key={m.user_id}
                    disabled={editMutation.isPending || m.user_id === lead.owner_user_id}
                    onSelect={() => reassignToUser(m.user_id)}
                  >
                    {m.full_name ?? "Sem nome"}
                  </DropdownMenuItem>
                ))}
                {(agents ?? []).length > 0 && <DropdownMenuSeparator />}
                {(agents ?? []).map((a) => (
                  <DropdownMenuItem
                    key={a.agent_id}
                    disabled={editMutation.isPending || a.agent_id === lead.owner_agent_id}
                    onSelect={() => reassignToAgent(a.agent_id)}
                  >
                    {a.name}
                    {a.version_number != null && (
                      <span className="ml-1.5 font-mono text-[10px] text-text-muted">
                        v{a.version_number}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {podeMarcarTag && lead.contact_id && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Tag size={14} className="mr-2" /> Tags do cliente
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                {(catalogo ?? []).length === 0 ? (
                  <DropdownMenuItem disabled>Nenhuma tag configurada</DropdownMenuItem>
                ) : (
                  (catalogo ?? []).map((t) => (
                    <DropdownMenuCheckboxItem
                      key={t.id}
                      checked={chavesAplicadas.has(chaveDaTag(t.name))}
                      disabled={aplicarTags.isPending}
                      // `onSelect` com preventDefault: sem isso o menu fecha a
                      // cada clique, e marcar três tags viraria três idas ao
                      // menu — o gesto é justamente escolher várias de uma vez.
                      onSelect={(e) => {
                        e.preventDefault();
                        alternarTag(t.name);
                      }}
                    >
                      <span
                        className={cn("mr-2 h-2 w-2 rounded-full", CLASSE_DA_BOLINHA[t.color])}
                        aria-hidden
                      />
                      {t.name}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem
            onSelect={() => {
              setAgendarOpen(true);
            }}
          >
            <CalendarBlank size={14} className="mr-2" /> Marcar reunião
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={winMutation.isPending}
            onSelect={() => {
              winMutation.mutate({ leadId: lead.id });
            }}
          >
            Marcar como ganho
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setLoseOpen(true);
            }}
          >
            Marcar como perdido
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LoseLeadDialog
        open={loseOpen}
        onOpenChange={setLoseOpen}
        leadId={lead.id}
        pipelineId={pipelineId}
      />
      <EditLeadDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={lead}
        pipelineId={pipelineId}
      />
      {agendarOpen && (
        <AgendarReuniaoDialog
          open
          onOpenChange={setAgendarOpen}
          leadId={lead.id}
          leadTitulo={lead.title}
          pipelineId={pipelineId}
          reuniaoAtual={lerReuniao(lead.custom_fields)}
        />
      )}
    </>
  );
}
