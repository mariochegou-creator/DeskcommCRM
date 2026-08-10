"use client";
/**
 * A lista da Sala de Reuniões — um cartão por reunião, o mínimo que identifica:
 * tipo (R1/R2), quando, status e a nota quando a análise já saiu.
 */
import { Card } from "@/components/ui/card";
import type { MeetingListItem } from "@/hooks/sala-reunioes/useMeetings";
import {
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  type MeetingStatus,
} from "@/lib/sala-reunioes/vocabulary";
import { cn } from "@/lib/utils";

/** Cor do ponto de status — verde vivo = acontecendo agora. */
function statusTone(status: MeetingStatus): string {
  switch (status) {
    case "ao_vivo":
      return "bg-success-fg";
    case "analisando":
      return "bg-warning-fg animate-pulse";
    case "falhou":
      return "bg-error-fg";
    default:
      return "bg-text-subtle";
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  meetings: MeetingListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function MeetingsList({ meetings, selectedId, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Reuniões">
      {meetings.map((m) => {
        const isSelected = m.id === selectedId;
        return (
          <Card
            key={m.id}
            role="listitem"
            tabIndex={0}
            onClick={() => onSelect(m.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(m.id);
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
              className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusTone(m.status))}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text">
                {MEETING_TYPE_LABELS[m.meeting_type]}
              </p>
              <p className="text-xs text-text-muted">
                {formatWhen(m.started_at)} · {MEETING_STATUS_LABELS[m.status]}
              </p>
            </div>
            {m.score !== null && (
              <span className="shrink-0 rounded-control bg-accent px-2 py-1 text-sm font-bold text-accent-foreground">
                {Number.isInteger(m.score) ? m.score : m.score.toFixed(1)}
              </span>
            )}
          </Card>
        );
      })}
    </div>
  );
}
