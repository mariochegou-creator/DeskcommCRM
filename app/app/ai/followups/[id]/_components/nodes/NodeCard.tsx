"use client";

import { Handle, Position, useReactFlow } from "@xyflow/react";

import { Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { NodeVisual } from "./nodeVisuals";

interface Props {
  id: string;
  visual: NodeVisual;
  label: string;
  subtitle: string;
  selected?: boolean;
  errors?: string[];
  showTarget?: boolean;
  showSource?: boolean;
}

/**
 * Shared card shell for all 6 node types — a card, not a bare React Flow box:
 * icon chip + title + one-line subtitle + connection handles, left border in
 * the type's accent. Red ring + inline message when `errors` is non-empty
 * (publish 422 anchored to this node — Task 6.2 PublishBar wires this).
 */
export function NodeCard({
  id,
  visual,
  label,
  subtitle,
  selected,
  errors,
  showTarget = true,
  showSource = true,
}: Props) {
  const Icon = visual.icon;
  const hasError = (errors?.length ?? 0) > 0;
  const { deleteElements } = useReactFlow();

  return (
    <div
      className={cn(
        "group w-56 rounded-md border border-l-4 border-border bg-surface shadow-sm transition-shadow",
        visual.borderClassName,
        selected && "ring-2 ring-accent-500 ring-offset-1 ring-offset-bg",
        hasError && "border-error ring-2 ring-error ring-offset-1 ring-offset-bg",
      )}
      data-testid={`node-card-${id}`}
      title={hasError ? errors!.join("; ") : undefined}
    >
      {showTarget && <Handle type="target" position={Position.Top} />}
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            visual.chipClassName,
          )}
        >
          <Icon size={14} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{label}</p>
          <p className="truncate text-xs text-text-muted">{subtitle}</p>
        </div>
        <button
          type="button"
          className={cn(
            // `nodrag` — sem ela o React Flow trata o clique como início de drag e o botão nunca dispara
            "nodrag shrink-0 rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100",
            selected && "opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            void deleteElements({ nodes: [{ id }] });
          }}
          aria-label="Excluir nó"
          title="Excluir nó"
          data-testid={`node-delete-${id}`}
        >
          <Trash size={14} aria-hidden />
        </button>
      </div>
      {hasError && (
        <p
          className="border-t border-error/30 px-3 py-1.5 text-xs leading-snug text-error-fg"
          data-testid={`node-error-${id}`}
        >
          {errors![0]}
        </p>
      )}
      {showSource && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}
