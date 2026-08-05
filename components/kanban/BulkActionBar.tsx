"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useBulkAction } from "@/hooks/kanban/useBulkAction";
import type { Stage } from "@/lib/kanban/types";

interface BulkActionBarProps {
  selectedIds: string[];
  stages: Stage[];
  pipelineId: string;
  onClear: () => void;
}

export function BulkActionBar({
  selectedIds,
  stages,
  pipelineId,
  onClear,
}: BulkActionBarProps) {
  const user = useUser();
  const bulk = useBulkAction(pipelineId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tagInput, setTagInput] = useState("");

  // Esc to clear selection
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds.length, onClear]);

  if (selectedIds.length === 0) return null;

  const runMove = (stageId: string) => {
    bulk.mutate(
      {
        action: "move",
        lead_ids: selectedIds,
        params: { stage_id: stageId, position_in_stage: 1_000_000 },
      },
      { onSuccess: () => onClear() },
    );
  };

  const runAssign = (ownerId: string | null) => {
    bulk.mutate(
      {
        action: "assign",
        lead_ids: selectedIds,
        params: { owner_user_id: ownerId },
      },
      {
        onSuccess: (res) => {
          const n = res.data.updated_count;
          toast.success(
            ownerId === null
              ? `${n} lead${n > 1 ? "s" : ""} sem responsável.`
              : `${n} lead${n > 1 ? "s" : ""} atribuído${n > 1 ? "s" : ""}.`,
          );
          onClear();
        },
      },
    );
  };

  const runTagAdd = () => {
    const t = tagInput.trim();
    if (!t) return;
    bulk.mutate(
      { action: "tag", lead_ids: selectedIds, params: { add: [t] } },
      {
        onSuccess: () => {
          setTagInput("");
          onClear();
        },
      },
    );
  };

  const runDelete = () => {
    bulk.mutate(
      { action: "delete", lead_ids: selectedIds, params: {} },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          onClear();
        },
      },
    );
  };

  return (
    <>
      {/* SEM posicionamento próprio: a barra é um bloco na linha de filtros,
          que já vive no topo e nunca sai da vista.

          Antes era `sticky bottom-4`, e o sticky depende de o elemento estar no
          fluxo de um ancestral rolável — nas duas telas o resultado era a barra
          repousar no fim do documento, alcançável só rolando até o rodapé.
          Marcar um card e não ver nada acontecer parece defeito, e era: a ação
          existia e ninguém chegava nela. Ancorar no topo, junto dos filtros,
          resolve sem depender de altura de container nem de scroll. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent/5 p-2">
        <span className="text-sm font-medium">
          {selectedIds.length} selecionado{selectedIds.length > 1 ? "s" : ""}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              Mover para…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Stage</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {stages.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => runMove(s.id)}>
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              Atribuir a…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => runAssign(user.id)}>Eu</DropdownMenuItem>
            <DropdownMenuItem onClick={() => runAssign(null)}>
              Remover responsável
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={bulk.isPending}>
              Tag…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <div className="flex items-center gap-2 p-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="nova tag"
                className="h-8 w-40"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runTagAdd();
                  }
                }}
              />
              <Button size="sm" onClick={runTagAdd} disabled={!tagInput.trim()}>
                Adicionar
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={bulk.isPending}
        >
          Excluir
        </Button>

        <Button size="sm" variant="ghost" onClick={onClear}>
          Cancelar
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir {selectedIds.length} lead(s)?</DialogTitle>
            <DialogDescription>
              Esta ação remove os leads selecionados. Não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={bulk.isPending}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
