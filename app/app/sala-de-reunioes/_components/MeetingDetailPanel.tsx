"use client";
/**
 * O dossiê de uma reunião: cabeçalho com status, notas por fase quando a
 * análise saiu, resumo, coaching, sugestões do copiloto e a transcrição —
 * fechada por padrão (é a peça mais longa e a menos relida).
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useFinishMeeting,
  useMeeting,
  type MeetingDetail,
  type MeetingSuggestion,
} from "@/hooks/sala-reunioes/useMeetings";
import {
  MEETING_OUTCOME_LABELS,
  MEETING_PHASE_LABELS,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
  type MeetingPhase,
} from "@/lib/sala-reunioes/vocabulary";
import { CaretDown, CaretUp, Check, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  meetingId: string | null;
}

export function MeetingDetailPanel({ meetingId }: Props) {
  const query = useMeeting(meetingId);

  if (meetingId === null) {
    return (
      <Card className="flex items-center justify-center p-10 text-center">
        <p className="text-sm text-text-muted">Escolha uma reunião na lista.</p>
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-error-fg">Não foi possível carregar a reunião.</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }

  const meeting = query.data.data.meeting;
  const suggestions = query.data.data.suggestions;

  return (
    <div className="flex flex-col gap-4">
      <MeetingHeader meeting={meeting} />
      {meeting.status === "falhou" && meeting.analysis_error && (
        <Card className="border-error-fg/40 p-4">
          <p className="text-sm text-error-fg">{meeting.analysis_error}</p>
        </Card>
      )}
      {meeting.spin_scores && <SpinScores scores={meeting.spin_scores} />}
      {meeting.summary && (
        <Card className="flex flex-col gap-2 p-5">
          <h3 className="text-sm font-semibold text-text">Resumo</h3>
          <p className="whitespace-pre-wrap text-base leading-relaxed text-text">
            {meeting.summary}
          </p>
        </Card>
      )}
      {meeting.coaching && <CoachingCard coaching={meeting.coaching} />}
      {suggestions.length > 0 && <SuggestionsTimeline suggestions={suggestions} />}
      <TranscriptCard meeting={meeting} />
    </div>
  );
}

function MeetingHeader({ meeting }: { meeting: MeetingDetail }) {
  const finish = useFinishMeeting();
  const duration =
    meeting.ended_at !== null
      ? Math.max(
          1,
          Math.round(
            (new Date(meeting.ended_at).getTime() - new Date(meeting.started_at).getTime()) /
              60_000,
          ),
        )
      : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold text-text">
          {MEETING_TYPE_LABELS[meeting.meeting_type]}
        </h2>
        <p className="text-sm text-text-muted">
          {new Date(meeting.started_at).toLocaleString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {duration !== null && ` · ${duration} min`}
          {` · ${meeting.turn_count} falas`}
        </p>
        <p className="text-sm font-medium text-text-muted">
          {MEETING_STATUS_LABELS[meeting.status]}
          {meeting.outcome && ` · ${MEETING_OUTCOME_LABELS[meeting.outcome]}`}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {meeting.score !== null && (
          <div className="flex flex-col items-center rounded-control bg-accent px-4 py-2 text-accent-foreground">
            <span className="text-2xl font-bold">
              {Number.isInteger(meeting.score) ? meeting.score : meeting.score.toFixed(1)}
            </span>
            <span className="text-[10px] uppercase tracking-wide">nota</span>
          </div>
        )}
        {meeting.status === "ao_vivo" && (
          <Button
            variant="secondary"
            size="sm"
            disabled={finish.isPending}
            onClick={() => finish.mutate(meeting.id)}
          >
            Encerrar
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Barras 0-10 por fase — leitura de um relance, sem tabela. */
function SpinScores({
  scores,
}: {
  scores: NonNullable<MeetingDetail["spin_scores"]>;
}) {
  const entries = Object.entries(scores).filter(
    (e): e is [string, { nota: number; comentario: string }] =>
      typeof e[1] === "object" && e[1] !== null && typeof e[1].nota === "number",
  );
  if (entries.length === 0) return null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h3 className="text-sm font-semibold text-text">Como você foi em cada fase</h3>
      <div className="flex flex-col gap-3">
        {entries.map(([fase, { nota, comentario }]) => (
          <div key={fase} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-text">
                {MEETING_PHASE_LABELS[fase as MeetingPhase] ?? fase}
              </span>
              <span className="text-sm font-bold text-text">
                {Number.isInteger(nota) ? nota : nota.toFixed(1)}/10
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-elevated">
              <div
                className={cn(
                  "h-full rounded-full",
                  nota >= 7 ? "bg-success-fg" : nota >= 4 ? "bg-warning-fg" : "bg-error-fg",
                )}
                style={{ width: `${Math.min(100, Math.max(0, nota * 10))}%` }}
              />
            </div>
            {comentario && <p className="text-xs text-text-muted">{comentario}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function CoachingCard({ coaching }: { coaching: NonNullable<MeetingDetail["coaching"]> }) {
  const hasStructured =
    (coaching.acertos?.length ?? 0) > 0 ||
    (coaching.melhorias?.length ?? 0) > 0 ||
    (coaching.perguntas_que_faltaram?.length ?? 0) > 0;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h3 className="text-sm font-semibold text-text">Coaching</h3>
      {hasStructured ? (
        <div className="flex flex-col gap-4">
          {(coaching.acertos?.length ?? 0) > 0 && (
            <CoachingBlock title="O que foi bem" items={coaching.acertos!} tone="success" />
          )}
          {(coaching.melhorias?.length ?? 0) > 0 && (
            <CoachingBlock title="A melhorar" items={coaching.melhorias!} tone="warning" />
          )}
          {(coaching.perguntas_que_faltaram?.length ?? 0) > 0 && (
            <CoachingBlock
              title="Perguntas que faltaram"
              items={coaching.perguntas_que_faltaram!}
              tone="neutral"
            />
          )}
        </div>
      ) : coaching.raw ? (
        // A análise rodou mas o modelo não devolveu o formato: o texto cru
        // ainda vale a leitura (status concluida_sem_formato).
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{coaching.raw}</p>
      ) : null}
    </Card>
  );
}

function CoachingBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "success" | "warning" | "neutral";
}) {
  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          tone === "success" && "text-success-fg",
          tone === "warning" && "text-warning-fg",
          tone === "neutral" && "text-text-muted",
        )}
      >
        {title}
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-base leading-relaxed text-text">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SuggestionsTimeline({ suggestions }: { suggestions: MeetingSuggestion[] }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold text-text">O que o copiloto sugeriu</h3>
      <ul className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <li key={s.id} className="flex items-start gap-3">
            <span className="mt-0.5 w-12 shrink-0 text-xs tabular-nums text-text-subtle">
              {formatClock(s.at_seconds)}
            </span>
            {/* ✓/✗ só depois de a análise carimbar; antes, um traço honesto. */}
            {s.was_followed === true ? (
              <Check size={16} className="mt-0.5 shrink-0 text-success-fg" aria-label="Seguiu" />
            ) : s.was_followed === false ? (
              <X size={16} className="mt-0.5 shrink-0 text-error-fg" aria-label="Não seguiu" />
            ) : (
              <span className="mt-0.5 w-4 shrink-0 text-center text-text-subtle" aria-hidden>
                –
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text">{s.suggestion}</p>
              <p className="text-xs text-text-subtle">
                {MEETING_PHASE_LABELS[s.phase_detected] ?? s.phase_detected}
                {s.alert && <span className="text-warning-fg"> · ⚠ {s.alert}</span>}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TranscriptCard({ meeting }: { meeting: MeetingDetail }) {
  const [open, setOpen] = useState(false);
  const turns = Array.isArray(meeting.transcript) ? meeting.transcript : [];

  return (
    <Card className="flex flex-col p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <h3 className="text-sm font-semibold text-text">
          Transcrição ({turns.length} falas)
        </h3>
        {open ? (
          <CaretUp size={16} className="text-text-muted" aria-hidden />
        ) : (
          <CaretDown size={16} className="text-text-muted" aria-hidden />
        )}
      </button>
      {open && (
        <div className="mt-4 flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
          {turns.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhuma fala registrada.</p>
          ) : (
            turns.map((turn) => (
              <div key={turn.i} className="flex flex-col gap-0.5">
                <p className="text-xs font-medium text-text-subtle">
                  {turn.speaker} · {formatClock(turn.t)}
                </p>
                <p
                  className={cn(
                    "whitespace-pre-wrap text-sm leading-relaxed",
                    turn.is_self ? "text-text-muted" : "text-text",
                  )}
                >
                  {turn.text}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
