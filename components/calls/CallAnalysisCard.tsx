"use client";
/**
 * A análise da ligação, na timeline.
 *
 * O que o SDR vem buscar aqui é COACHING, não relatório: a nota diz onde ele
 * está, a frase para treinar diz o que fazer na próxima ligação. Por isso a
 * frase ganha o destaque e a transcrição fica fechada — quem lê a transcrição
 * inteira toda vez é quem está auditando, não quem está melhorando.
 *
 * A transcrição fechada por padrão também é decisão de privacidade: é a fala de
 * uma pessoa que não sabe que um CRM a transcreveu, e ela não precisa ficar
 * aberta na tela enquanto alguém passa por trás da mesa.
 */
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCall } from "@/hooks/calls/useCalls";
import {
  CallAnalysisSchema,
  OUTCOME_LABELS,
  STATUS_LABELS,
  isRawAnalysis,
  type CallOutcome,
} from "@/lib/calls/analysis-schema";
import { CaretDown, CaretUp, CircleNotch, Lightbulb } from "@/lib/ui/icons";

interface Props {
  callId: string;
}

/**
 * A cor do desfecho. "Não agendou" é NEUTRO de propósito, não vermelho: a maior
 * parte da prospecção não agenda, e pintar o normal de erro treina o SDR a
 * ignorar a cor — aí o vermelho para de significar alguma coisa quando importa.
 */
const OUTCOME_VARIANT: Record<CallOutcome, "success" | "neutral" | "info"> = {
  agendou: "success",
  nao_agendou: "neutral",
  follow_up_marcado: "info",
  nao_atendeu_ou_invalida: "neutral",
};

export function CallAnalysisCard({ callId }: Props) {
  const [verTranscricao, setVerTranscricao] = useState(false);
  const q = useCall(callId);
  const call = q.data?.data;

  if (q.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleNotch size={14} className="animate-spin" aria-hidden />
        Carregando análise…
      </p>
    );
  }

  if (q.isError || !call) {
    return <p className="text-sm text-muted-foreground">Não foi possível carregar a análise.</p>;
  }

  const parsed = CallAnalysisSchema.safeParse(call.analysis);
  const analysis = parsed.success ? parsed.data : null;

  return (
    <div className="mt-2 space-y-3">
      {/* ---- desfecho + nota ---- */}
      <div className="flex flex-wrap items-center gap-3">
        {analysis ? (
          <Badge variant={OUTCOME_VARIANT[analysis.resultado]}>
            {OUTCOME_LABELS[analysis.resultado]}
          </Badge>
        ) : (
          <Badge variant="neutral">{STATUS_LABELS[call.status]}</Badge>
        )}
        {analysis && (
          <span className="text-2xl font-semibold tabular-nums">
            {formatNota(analysis.nota_geral)}
            <span className="ml-0.5 text-sm font-normal text-muted-foreground">/10</span>
          </span>
        )}
        {call.duration_seconds != null && (
          <span className="text-xs text-muted-foreground">
            {Math.floor(call.duration_seconds / 60)} min {call.duration_seconds % 60}s
          </span>
        )}
      </div>

      {call.error_detail && (
        <p className="rounded-md border border-warning-fg/30 bg-warning-bg p-2 text-sm text-warning-fg">
          {call.error_detail}
        </p>
      )}

      {/* ---- notas por critério ---- */}
      {analysis && (
        <ul className="space-y-1.5">
          {analysis.criterios.map((c) => (
            <li key={c.criterio}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{c.criterio}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNota(c.nota)}/10
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent-500"
                  style={{ width: `${Math.round((c.nota / 10) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.comentario}</p>
            </li>
          ))}
        </ul>
      )}

      {/* ---- acertos e melhorias ---- */}
      {analysis && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Acertos
            </h4>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
              {analysis.acertos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pontos de melhoria
            </h4>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
              {analysis.pontos_de_melhoria.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ---- a frase para treinar ---- */}
      {analysis && (
        <Card className="border-accent-500/40 bg-accent-500/5 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Lightbulb size={14} weight="duotone" aria-hidden />
            Frase para treinar
          </h4>
          <p className="mt-1 text-sm italic">“{analysis.frase_para_treinar}”</p>
        </Card>
      )}

      {/* ---- análise sem formatação ---- */}
      {!analysis && isRawAnalysis(call.analysis) && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Avaliação (texto)
          </h4>
          <p className="mt-1 whitespace-pre-wrap text-sm">{call.analysis.raw}</p>
        </div>
      )}

      {/* ---- áudio ---- */}
      {/* `preload="none"`: a URL é assinada e curta, e pré-carregar todo áudio
          da timeline gastaria banda de quem só veio ler a análise. A alternativa
          textual ao áudio é a transcrição, logo abaixo. */}
      {call.audio_url && (
        <audio controls preload="none" src={call.audio_url} className="w-full">
          Seu navegador não reproduz áudio.
        </audio>
      )}

      {/* ---- transcrição ---- */}
      {call.transcript && (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVerTranscricao((v) => !v)}
            aria-expanded={verTranscricao}
          >
            {verTranscricao ? (
              <CaretUp size={14} weight="bold" aria-hidden />
            ) : (
              <CaretDown size={14} weight="bold" aria-hidden />
            )}
            <span>{verTranscricao ? "Ocultar transcrição" : "Ver transcrição"}</span>
          </Button>
          {verTranscricao && (
            <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-elevated p-3 text-sm">
              {call.transcript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatNota(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace(".", ",");
}
