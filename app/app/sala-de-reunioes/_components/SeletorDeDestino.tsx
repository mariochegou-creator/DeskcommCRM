"use client";
/**
 * Onde a nota do Guia / Quadro Branco vai parar — a reunião ao vivo ou um
 * negócio com reunião marcada.
 *
 * O valor é uma string prefixada ("m:<id>" | "l:<leadId>" | "") de propósito:
 * um <select> nativo só carrega string, e o prefixo evita duas props e dois
 * estados para dizer uma coisa só. Quem desmonta é `lerDestino`.
 */
import type { MeetingListItem } from "@/hooks/sala-reunioes/useMeetings";
import type { ProximaReuniao } from "@/hooks/sala-reunioes/usePreparo";

interface Props {
  aoVivo: MeetingListItem | null;
  proximas: ProximaReuniao[];
  value: string;
  onChange: (v: string) => void;
}

/** "m:<id>" | "l:<leadId>" → o corpo que a rota /meetings/guia espera. */
export function lerDestino(value: string): { meeting_id?: string; lead_id?: string } | null {
  if (value.startsWith("m:")) return { meeting_id: value.slice(2) };
  if (value.startsWith("l:")) return { lead_id: value.slice(2) };
  return null;
}

/** O destino óbvio quando a tela abre: call ao vivo ganha de reunião marcada. */
export function destinoInicial(
  aoVivo: MeetingListItem | null,
  proximas: ProximaReuniao[],
): string {
  if (aoVivo) return `m:${aoVivo.id}`;
  if (proximas.length > 0) return `l:${proximas[0]!.lead_id}`;
  return "";
}

export function SeletorDeDestino({ aoVivo, proximas, value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-muted">
      Salvar no card de
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 max-w-56 rounded-control border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <option value="">— escolher —</option>
        {aoVivo && <option value={`m:${aoVivo.id}`}>Reunião ao vivo agora</option>}
        {proximas.map((p) => (
          <option key={p.lead_id} value={`l:${p.lead_id}`}>
            {p.lead_title ?? "Negócio sem nome"}
          </option>
        ))}
      </select>
    </label>
  );
}
