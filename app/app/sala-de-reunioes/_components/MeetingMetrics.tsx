"use client";
/**
 * Os números da sala — 5 cards grandes, sem gráfico denso. Um número por
 * card, com a pergunta que ele responde escrita por extenso.
 */
import { Card } from "@/components/ui/card";
import { useMeetingMetrics } from "@/hooks/sala-reunioes/useMeetings";
import { MEETING_PHASE_LABELS, type MeetingPhase } from "@/lib/sala-reunioes/vocabulary";

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

function nota(v: number | null): string {
  if (v === null) return "—";
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace(".", ",");
}

export function MeetingMetrics() {
  const query = useMeetingMetrics(30);
  const m = query.data?.data ?? null;
  if (query.isLoading || !m || m.total_reunioes === 0) return null;

  const fases = Object.entries(m.nota_por_fase) as Array<[MeetingPhase, number]>;
  const piorFase =
    fases.length > 0
      ? fases.reduce((min, cur) => (cur[1] < min[1] ? cur : min))
      : null;

  const cards: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Reuniões (30 dias)", value: String(m.total_reunioes) },
    { label: "R1 que avançou", value: pct(m.taxa_avanco_r1), hint: "saiu com próximo passo datado" },
    { label: "R2 que fechou", value: pct(m.taxa_fechamento_r2) },
    { label: "Nota média", value: nota(m.nota_media) },
    {
      label: "Seguiu o copiloto",
      value: pct(m.pct_sugestoes_seguidas),
      hint: piorFase ? `fase mais fraca: ${MEETING_PHASE_LABELS[piorFase[0]]}` : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label} className="flex flex-col gap-1 p-4">
          <span className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            {c.label}
          </span>
          <span className="text-3xl font-bold text-text">{c.value}</span>
          {c.hint && <span className="text-xs text-text-muted">{c.hint}</span>}
        </Card>
      ))}
    </div>
  );
}
