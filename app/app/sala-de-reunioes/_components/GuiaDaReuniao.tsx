"use client";
/**
 * O GUIA DA REUNIÃO — o painel que o vendedor deixa aberto na própria tela
 * durante a call (o cliente nunca vê).
 *
 * DUAS CAMADAS, POR CONSTRUÇÃO:
 * - A MANUAL sempre funciona: as etapas e as perguntas vêm de
 *   `lib/sala-reunioes/guia.ts` e andam no clique — sem legenda, sem crédito
 *   de IA, sem extensão, o guia continua inteiro.
 * - A DO COPILOTO é só exibição: quando existe reunião ao vivo, a fase e a
 *   última sugestão que a extensão já gravou no banco aparecem aqui em cima.
 *   Nenhuma chamada de IA nasce desta tela — ela lê o que o pipeline do Meet
 *   já pagou para gerar.
 *
 * O RASCUNHO MORA NO NAVEGADOR (localStorage): um F5 no meio da reunião não
 * pode apagar meia hora de anotação. Vira dado de verdade só no "Salvar no
 * card", que grava em `lead_notes` — de onde o preparo e o copiloto já leem.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonoLabel } from "@/components/ui/mono-label";
import {
  useMeeting,
  useSalvarGuia,
  type MeetingListItem,
} from "@/hooks/sala-reunioes/useMeetings";
import type { ProximaReuniao } from "@/hooks/sala-reunioes/usePreparo";
import {
  DESFECHOS_DO_GUIA,
  ETAPAS_DO_GUIA,
  OBJECOES_DO_GUIA,
  montarNotaDoGuia,
  type DesfechoDoGuia,
  type ObjecaoDoGuia,
} from "@/lib/sala-reunioes/guia";
import { MEETING_PHASE_LABELS } from "@/lib/sala-reunioes/vocabulary";
import { CaretLeft, Check, Lightbulb, Warning } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { SeletorDeDestino, destinoInicial, lerDestino } from "./SeletorDeDestino";

interface Props {
  aoVivo: MeetingListItem | null;
  proximas: ProximaReuniao[];
  onVoltar: () => void;
}

interface Rascunho {
  etapa: number;
  /** Perguntas já feitas, como `${etapaId}:${indice}`. */
  feitas: string[];
  anotacoes: Record<string, string>;
  nota: number | null;
  justificou: boolean;
  objecoes: ObjecaoDoGuia[];
  desfecho: DesfechoDoGuia | null;
  combinado: string;
}

const RASCUNHO_VAZIO: Rascunho = {
  etapa: 0,
  feitas: [],
  anotacoes: {},
  nota: null,
  justificou: false,
  objecoes: [],
  desfecho: null,
  combinado: "",
};

const CHAVE_DO_RASCUNHO = "sala-guia-rascunho";

function carregarRascunho(): Rascunho {
  // Componente cliente ainda renderiza no servidor no primeiro paint — lá não
  // há localStorage, e um rascunho corrompido não pode derrubar a tela.
  if (typeof window === "undefined") return RASCUNHO_VAZIO;
  try {
    const cru = window.localStorage.getItem(CHAVE_DO_RASCUNHO);
    if (!cru) return RASCUNHO_VAZIO;
    const dado = JSON.parse(cru) as Partial<Rascunho>;
    return { ...RASCUNHO_VAZIO, ...dado };
  } catch {
    return RASCUNHO_VAZIO;
  }
}

export function GuiaDaReuniao({ aoVivo, proximas, onVoltar }: Props) {
  const [r, setR] = useState<Rascunho>(carregarRascunho);
  const [destino, setDestino] = useState("");
  const [salvoOnde, setSalvoOnde] = useState<string | null>(null);
  const salvar = useSalvarGuia();

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE_DO_RASCUNHO, JSON.stringify(r));
    } catch {
      // Sem storage (aba anônima cheia etc.): o guia segue, só sem rascunho.
    }
  }, [r]);

  // Pré-seleciona o destino óbvio assim que as listas chegam — mas nunca por
  // cima de uma escolha que a pessoa já fez.
  useEffect(() => {
    setDestino((atual) => (atual === "" ? destinoInicial(aoVivo, proximas) : atual));
  }, [aoVivo, proximas]);

  // O `!` é seguro: o índice é clampado no tamanho da lista, que nunca é vazia.
  const etapa = ETAPAS_DO_GUIA[Math.min(r.etapa, ETAPAS_DO_GUIA.length - 1)]!;
  const ultimaEtapa = r.etapa >= ETAPAS_DO_GUIA.length - 1;

  const aoSalvar = () => {
    const alvo = lerDestino(destino);
    if (!alvo) {
      setSalvoOnde("escolha");
      return;
    }
    const { headline, body } = montarNotaDoGuia(r);
    if (!body.trim()) {
      setSalvoOnde("vazio");
      return;
    }
    salvar.mutate(
      { ...alvo, headline, body },
      {
        onSuccess: (res) => {
          const d = res.data;
          setSalvoOnde(d.salvo_no_lead ? "lead" : d.salvo_na_reuniao ? "reuniao" : null);
        },
        onError: () => setSalvoOnde("erro"),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onVoltar} className="gap-1">
            <CaretLeft size={16} />
            Voltar
          </Button>
          <div className="flex flex-col">
            <MonoLabel>guia da reunião</MonoLabel>
            <p className="text-sm text-text-muted">
              Etapa {Math.min(r.etapa + 1, ETAPAS_DO_GUIA.length)} de {ETAPAS_DO_GUIA.length} —
              só você vê esta tela.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SeletorDeDestino
            aoVivo={aoVivo}
            proximas={proximas}
            value={destino}
            onChange={setDestino}
          />
          <Button onClick={aoSalvar} disabled={salvar.isPending}>
            Salvar no card
          </Button>
        </div>
      </div>

      {salvoOnde === "lead" && (
        <p className="text-sm font-medium text-success-fg">
          Salvo no card do lead — o preparo da próxima reunião já enxerga.
        </p>
      )}
      {salvoOnde === "reuniao" && (
        <p className="text-sm font-medium text-success-fg">
          Salvo nas notas da reunião. (Este negócio ainda não tem contato, então não foi
          para o card.)
        </p>
      )}
      {salvoOnde === "escolha" && (
        <p className="text-sm text-warning-fg">Escolha onde salvar, ali em cima.</p>
      )}
      {salvoOnde === "vazio" && (
        <p className="text-sm text-warning-fg">
          O guia ainda está em branco — marque a nota ou escreva uma anotação antes.
        </p>
      )}
      {salvoOnde === "erro" && (
        <p className="text-sm text-error-fg">Não deu para salvar. Tente de novo.</p>
      )}

      {aoVivo && <CopilotoAoVivo meetingId={aoVivo.id} />}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* As etapas: no desktop, uma coluna fixa; no celular, uma fileira que
            rola — reunião também acontece com o notebook fechado. */}
        <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {ETAPAS_DO_GUIA.map((e, i) => {
            const passada = i < r.etapa;
            const atual = i === r.etapa;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setR((v) => ({ ...v, etapa: i }))}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-control border px-3 py-2 text-left text-sm transition-colors",
                  atual
                    ? "border-accent bg-accent-soft font-semibold text-text"
                    : passada
                      ? "border-border bg-surface text-text-muted"
                      : "border-border bg-surface-elevated text-text",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs",
                    passada ? "bg-success-fg text-white" : "bg-surface-elevated text-text-muted",
                  )}
                >
                  {passada ? <Check size={12} weight="bold" /> : i + 1}
                </span>
                {e.titulo}
              </button>
            );
          })}
        </div>

        <Card className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-text">{etapa.titulo}</h2>
            <p className="text-sm text-text-muted">{etapa.objetivo}</p>
          </div>

          <ul className="flex flex-col gap-2">
            {etapa.perguntas.map((pergunta, i) => {
              const chave = `${etapa.id}:${i}`;
              const feita = r.feitas.includes(chave);
              return (
                <li key={chave}>
                  <button
                    type="button"
                    aria-pressed={feita}
                    onClick={() =>
                      setR((v) => ({
                        ...v,
                        feitas: feita
                          ? v.feitas.filter((f) => f !== chave)
                          : [...v.feitas, chave],
                      }))
                    }
                    className={cn(
                      "flex w-full items-start gap-3 rounded-control border px-4 py-3 text-left transition-colors",
                      "hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
                      feita ? "border-border bg-surface" : "border-border bg-surface-elevated",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                        feita
                          ? "border-success-fg bg-success-fg text-white"
                          : "border-border bg-surface",
                      )}
                    >
                      {feita && <Check size={14} weight="bold" />}
                    </span>
                    <span
                      className={cn(
                        "text-base leading-relaxed",
                        feita ? "text-text-muted line-through" : "text-text",
                      )}
                    >
                      {pergunta}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="flex items-start gap-2 rounded-control bg-warning-bg p-3 text-sm leading-relaxed text-warning-fg">
            <Lightbulb size={18} className="mt-0.5 shrink-0" aria-hidden />
            {etapa.dica}
          </p>

          {etapa.id === "laudo" && (
            <NotaZeroADez
              nota={r.nota}
              justificou={r.justificou}
              onNota={(nota) => setR((v) => ({ ...v, nota }))}
              onJustificou={(justificou) => setR((v) => ({ ...v, justificou }))}
            />
          )}

          {etapa.id === "objecoes" && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-text">O que apareceu na conversa:</p>
              <div className="flex flex-wrap gap-2">
                {OBJECOES_DO_GUIA.map((o) => {
                  const marcada = r.objecoes.includes(o.chave);
                  return (
                    <button
                      key={o.chave}
                      type="button"
                      aria-pressed={marcada}
                      onClick={() =>
                        setR((v) => ({
                          ...v,
                          objecoes: marcada
                            ? v.objecoes.filter((c) => c !== o.chave)
                            : [...v.objecoes, o.chave],
                        }))
                      }
                      className={cn(
                        "rounded-pill border px-3 py-1.5 text-sm transition-colors",
                        marcada
                          ? "border-accent bg-accent-soft font-medium text-text"
                          : "border-border bg-surface-elevated text-text-muted",
                      )}
                    >
                      {o.rotulo}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {etapa.id === "fechamento" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-text">Como terminou:</p>
              <div className="flex flex-wrap gap-2">
                {DESFECHOS_DO_GUIA.map((d) => (
                  <button
                    key={d.chave}
                    type="button"
                    aria-pressed={r.desfecho === d.chave}
                    onClick={() =>
                      setR((v) => ({
                        ...v,
                        desfecho: v.desfecho === d.chave ? null : d.chave,
                      }))
                    }
                    className={cn(
                      "rounded-control border px-4 py-2 text-sm transition-colors",
                      r.desfecho === d.chave
                        ? "border-accent bg-accent-soft font-semibold text-text"
                        : "border-border bg-surface-elevated text-text",
                    )}
                  >
                    {d.rotulo}
                  </button>
                ))}
              </div>
              {r.desfecho === "combinado" && (
                <textarea
                  value={r.combinado}
                  onChange={(e) => setR((v) => ({ ...v, combinado: e.target.value }))}
                  placeholder="O combinado, com dia e hora: “te ligo quinta às 10h — ele vai falar com o sócio até lá”"
                  rows={2}
                  className="w-full rounded-control border border-border bg-surface p-3 text-sm text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                />
              )}
            </div>
          )}

          <textarea
            value={r.anotacoes[etapa.id] ?? ""}
            onChange={(e) =>
              setR((v) => ({ ...v, anotacoes: { ...v.anotacoes, [etapa.id]: e.target.value } }))
            }
            placeholder="O que ele disse — nas palavras dele"
            rows={3}
            className="w-full rounded-control border border-border bg-surface p-3 text-sm text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="secondary"
              disabled={r.etapa === 0}
              onClick={() => setR((v) => ({ ...v, etapa: Math.max(0, v.etapa - 1) }))}
            >
              Etapa anterior
            </Button>
            <div className="flex items-center gap-3">
              {etapa.id === "laudo" && r.nota !== null && r.nota < 10 && (
                <p className="flex items-center gap-1.5 text-sm font-medium text-warning-fg">
                  <Warning size={16} aria-hidden />
                  {r.nota}/10 — pergunte o que falta antes de avançar
                </p>
              )}
              {!ultimaEtapa && (
                <Button
                  size="lg"
                  onClick={() =>
                    setR((v) => ({
                      ...v,
                      etapa: Math.min(ETAPAS_DO_GUIA.length - 1, v.etapa + 1),
                    }))
                  }
                >
                  Próxima etapa
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setR(RASCUNHO_VAZIO);
            setSalvoOnde(null);
            try {
              window.localStorage.removeItem(CHAVE_DO_RASCUNHO);
            } catch {
              // sem storage, nada a apagar
            }
          }}
        >
          Recomeçar o guia
        </Button>
      </div>
    </div>
  );
}

/**
 * A nota que o CLIENTE deu — e se ele justificou com a própria voz. Botões, e
 * não input: no meio da call ninguém digita número, toca.
 */
function NotaZeroADez({
  nota,
  justificou,
  onNota,
  onJustificou,
}: {
  nota: number | null;
  justificou: boolean;
  onNota: (n: number | null) => void;
  onJustificou: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-text">A nota que ELE deu:</p>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            aria-pressed={nota === n}
            onClick={() => onNota(nota === n ? null : n)}
            className={cn(
              "h-11 w-11 rounded-control border text-base font-bold transition-colors",
              nota === n
                ? n >= 10
                  ? "border-success-fg bg-success-fg text-white"
                  : "border-warning-fg bg-warning-bg text-warning-fg"
                : "border-border bg-surface-elevated text-text hover:border-border-strong",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={justificou}
        onClick={() => onJustificou(!justificou)}
        className={cn(
          "flex w-fit items-center gap-2 rounded-control border px-3 py-2 text-sm transition-colors",
          justificou
            ? "border-success-fg bg-surface font-medium text-success-fg"
            : "border-border bg-surface-elevated text-text-muted",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full border",
            justificou ? "border-success-fg bg-success-fg text-white" : "border-border bg-surface",
          )}
        >
          {justificou && <Check size={13} weight="bold" />}
        </span>
        Ele justificou o porquê da nota (“por que não menos?”)
      </button>
    </div>
  );
}

/**
 * A fase e a última sugestão que o copiloto do Meet já gravou no banco. Só
 * leitura: o poll de 5s vem do `useMeeting` enquanto a reunião está ao vivo.
 */
function CopilotoAoVivo({ meetingId }: { meetingId: string }) {
  const query = useMeeting(meetingId);
  const sugestoes = query.data?.data.suggestions ?? [];
  const ultima = sugestoes.length > 0 ? sugestoes[sugestoes.length - 1] : null;

  return (
    <Card className="flex flex-col gap-2 border-accent/40 bg-accent-soft p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Copiloto ao vivo</h3>
        {ultima && (
          <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
            fase: {MEETING_PHASE_LABELS[ultima.phase_detected] ?? ultima.phase_detected}
          </span>
        )}
      </div>
      {ultima ? (
        <>
          <p className="text-lg font-medium leading-relaxed text-text">{ultima.suggestion}</p>
          {ultima.alert && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-warning-fg">
              <Warning size={16} aria-hidden />
              {ultima.alert}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-text-muted">
          Reunião ao vivo conectada — a sugestão aparece aqui assim que a conversa andar.
        </p>
      )}
    </Card>
  );
}
