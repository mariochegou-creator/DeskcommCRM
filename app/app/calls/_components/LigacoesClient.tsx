"use client";
/**
 * A lista de ligações.
 *
 * RASA POR FORA, DETALHE POR DENTRO: cada linha diz só o que serve para
 * escolher qual ligação abrir (quem, quando, quanto durou, o que deu, a nota).
 * O card completo — critérios, acertos, frase para treinar, áudio, transcrição
 * — é o MESMO componente que a timeline do contato usa, aberto aqui embaixo da
 * linha. Duplicar a renderização da análise numa segunda tela faria as duas
 * divergirem no dia em que a rubrica ganhasse um critério.
 *
 * O RESUMO DO TOPO É DA PÁGINA CARREGADA, e o rótulo diz isso. Um "média 6,8"
 * sem dizer de quantas ligações é o tipo de número que vira meta sem ninguém
 * decidir que virou.
 */
import Link from "next/link";
import { useState } from "react";

import { CallAnalysisCard } from "@/components/calls/CallAnalysisCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCallsList, type CallListItem } from "@/hooks/calls/useCalls";
import { OUTCOME_LABELS, STATUS_LABELS, type CallOutcome } from "@/lib/calls/analysis-schema";
import { CaretDown, CaretUp, CircleNotch, Phone } from "@/lib/ui/icons";

const PAGINA = 30;

/** Mesma escala do card da timeline — "não agendou" é neutro, não erro. */
const OUTCOME_VARIANT: Record<CallOutcome, "success" | "neutral" | "info"> = {
  agendou: "success",
  nao_agendou: "neutral",
  follow_up_marcado: "info",
  nao_atendeu_ou_invalida: "neutral",
};

export function LigacoesClient() {
  const [offset, setOffset] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const q = useCallsList({ limit: PAGINA, offset });

  const dados = q.data?.data;
  const itens = dados?.items ?? [];
  const total = dados?.total ?? 0;

  const comNota = itens.filter((i) => i.score != null);
  const media =
    comNota.length > 0
      ? comNota.reduce((soma, i) => soma + (i.score ?? 0), 0) / comNota.length
      : null;
  const agendou = itens.filter((i) => i.outcome === "agendou").length;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Phone size={24} weight="duotone" aria-hidden />
            Ligações
          </h1>
          <p className="text-sm text-muted-foreground">
            As ligações gravadas pelo CRM, com a análise de cada uma.
          </p>
        </div>
        {total > 0 && (
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "ligação" : "ligações"}
          </p>
        )}
      </header>

      {itens.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Resumo rotulo="Nesta página" valor={String(itens.length)} />
          <Resumo rotulo="Agendaram reunião" valor={String(agendou)} />
          <Resumo
            rotulo="Nota média (desta página)"
            valor={media != null ? formatNota(media) : "—"}
          />
        </div>
      )}

      {q.isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleNotch size={16} className="animate-spin" aria-hidden />
          Carregando…
        </p>
      )}

      {q.isError && (
        <p className="text-sm text-muted-foreground">Não foi possível carregar as ligações.</p>
      )}

      {!q.isLoading && itens.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium">Nenhuma ligação gravada ainda.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Abra um contato ou um negócio e use o botão <strong>Ligar</strong>: o CRM acompanha a
            conversa e devolve a análise aqui.
          </p>
        </Card>
      )}

      <ul className="space-y-2">
        {itens.map((item) => (
          <li key={item.id}>
            <Card className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/app/contacts/${item.contact_id}`}
                    className="font-medium hover:underline"
                  >
                    {item.contact_name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatQuando(item.created_at)}
                    {item.duration_seconds != null && ` · ${formatDuracao(item.duration_seconds)}`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {item.outcome ? (
                    <Badge variant={OUTCOME_VARIANT[item.outcome]}>
                      {OUTCOME_LABELS[item.outcome]}
                    </Badge>
                  ) : (
                    <Badge variant="neutral">{STATUS_LABELS[item.status]}</Badge>
                  )}
                  {item.score != null && (
                    <span className="text-lg font-semibold tabular-nums">
                      {formatNota(item.score)}
                      <span className="ml-0.5 text-xs font-normal text-muted-foreground">/10</span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={aberta === item.id}
                    onClick={() => setAberta((a) => (a === item.id ? null : item.id))}
                  >
                    {aberta === item.id ? (
                      <CaretUp size={14} weight="bold" aria-hidden />
                    ) : (
                      <CaretDown size={14} weight="bold" aria-hidden />
                    )}
                    <span>{aberta === item.id ? "Fechar" : "Ver análise"}</span>
                  </Button>
                </div>
              </div>

              {/* Montado só quando aberto: o card faz sua própria consulta (e
                  assina uma URL de áudio). Trinta deles montados de uma vez
                  seriam trinta requisições para ler uma. */}
              {aberta === item.id && <CallAnalysisCard callId={item.id} />}
            </Card>
          </li>
        ))}
      </ul>

      {total > offset + itens.length && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setOffset((o) => o + PAGINA)}>
            Carregar mais
          </Button>
        </div>
      )}
      {offset > 0 && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={() => setOffset(0)}>
            Voltar ao começo
          </Button>
        </div>
      )}
    </div>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
    </Card>
  );
}

function formatNota(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace(".", ",");
}

function formatDuracao(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return m > 0 ? `${m} min ${s}s` : `${s}s`;
}

function formatQuando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type { CallListItem };
