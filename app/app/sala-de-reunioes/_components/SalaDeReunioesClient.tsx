"use client";
/**
 * Sala de Reuniões — a tela.
 *
 * Duas colunas no desktop (lista à esquerda, painel à direita), empilhado no
 * mobile. Texto grande e pouco de cada vez, de propósito: o dono da sala lê
 * melhor cartão curto do que parágrafo.
 *
 * A coluna da esquerda tem DUAS listas e elas vêm de tabelas diferentes:
 * as PRÓXIMAS saem de `crm_leads.custom_fields.reuniao` (o agendamento que
 * combate no-show) e as que JÁ ACONTECERAM saem de `crm_meetings` (o que o
 * copiloto gravou). Clicar numa ou noutra abre painéis diferentes — preparo
 * antes, dossiê depois — porque as perguntas são opostas: "o que falta fazer?"
 * contra "como eu fui?".
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonoLabel } from "@/components/ui/mono-label";
import { Skeleton } from "@/components/ui/skeleton";
import { useProximasReunioes } from "@/hooks/sala-reunioes/usePreparo";
import { useCreateMeeting, useMeetings } from "@/hooks/sala-reunioes/useMeetings";
import { VideoCamera } from "@/lib/ui/icons";

import { MeetingDetailPanel } from "./MeetingDetailPanel";
import { MeetingMetrics } from "./MeetingMetrics";
import { MeetingsList } from "./MeetingsList";
import { PreparoPanel } from "./PreparoPanel";
import { ProximasReunioes } from "./ProximasReunioes";

/** O que está aberto à direita. Uma coisa só de cada vez, por construção. */
type Selecao =
  | { tipo: "proxima"; leadId: string }
  | { tipo: "reuniao"; id: string }
  | null;

/** De quanto em quanto tempo o relógio da tela anda ("sai hoje às 18h" → "saiu"). */
const PULSO_DO_RELOGIO_MS = 60_000;

export function SalaDeReunioesClient() {
  const [selecao, setSelecao] = useState<Selecao>(null);
  const meetingsQuery = useMeetings();
  const proximasQuery = useProximasReunioes();
  const createMeeting = useCreateMeeting();

  // UM instante para a tela inteira: sem isto, dois cartões renderizados com
  // milissegundos de diferença podem cair em lados opostos da virada do dia e
  // um diz "hoje" enquanto o outro diz "ontem".
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), PULSO_DO_RELOGIO_MS);
    return () => clearInterval(t);
  }, []);

  const meetings = meetingsQuery.data?.data.meetings ?? null;
  const proximas = proximasQuery.data?.data.proximas ?? [];
  const carregando = meetingsQuery.isLoading || proximasQuery.isLoading;
  const vazio =
    !proximasQuery.isError && (meetings?.length ?? 0) === 0 && proximas.length === 0;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <MonoLabel>sala de reuniões</MonoLabel>
          <h1 className="text-xl font-bold text-text">Suas reuniões do Meet</h1>
          <p className="text-sm text-text-muted">
            O que vem pela frente com o checklist do preparo, e o que já aconteceu com a
            análise do copiloto.
          </p>
        </div>
        {/* Reunião de teste direto da aba — serve para o Mario ver a tela viva
            antes de a extensão existir, e para depurar sem abrir o Meet. */}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={createMeeting.isPending}
            onClick={() =>
              createMeeting.mutate(
                { meeting_type: "r1" },
                { onSuccess: (res) => setSelecao({ tipo: "reuniao", id: res.data.meeting.id }) },
              )
            }
          >
            Nova R1 (teste)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={createMeeting.isPending}
            onClick={() =>
              createMeeting.mutate(
                { meeting_type: "r2" },
                { onSuccess: (res) => setSelecao({ tipo: "reuniao", id: res.data.meeting.id }) },
              )
            }
          >
            Nova R2 (teste)
          </Button>
        </div>
      </header>

      <MeetingMetrics />

      {carregando ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : meetingsQuery.isError || meetings === null ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm text-error-fg">Não foi possível carregar as reuniões.</p>
          <Button variant="secondary" size="sm" onClick={() => void meetingsQuery.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : vazio ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <VideoCamera size={40} className="text-text-subtle" aria-hidden />
          <p className="text-base font-medium text-text">Nenhuma reunião ainda</p>
          <p className="max-w-md text-sm text-text-muted">
            Marque uma reunião arrastando o card no funil — ela aparece aqui com o
            checklist do preparo. Depois, com a extensão do copiloto no Chrome, clique em
            “Iniciar R1” dentro do Google Meet e a análise volta para cá.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="flex flex-col gap-5">
            {/* Falha de leitura das próximas NÃO pode se parecer com "não há
                nenhuma": quem conta com a lista para lembrar da R1 de amanhã
                acreditaria no silêncio. */}
            {proximasQuery.isError && (
              <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
                <p className="text-sm text-error-fg">
                  Não deu para carregar as próximas reuniões.
                </p>
                <Button variant="secondary" size="sm" onClick={() => void proximasQuery.refetch()}>
                  Tentar de novo
                </Button>
              </Card>
            )}

            {proximas.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Próximas reuniões
                </h2>
                <ProximasReunioes
                  proximas={proximas}
                  selectedLeadId={selecao?.tipo === "proxima" ? selecao.leadId : null}
                  onSelect={(leadId) => setSelecao({ tipo: "proxima", leadId })}
                  agora={agora}
                />
              </section>
            )}

            {meetings.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Já aconteceram
                </h2>
                <MeetingsList
                  meetings={meetings}
                  selectedId={selecao?.tipo === "reuniao" ? selecao.id : null}
                  onSelect={(id) => setSelecao({ tipo: "reuniao", id })}
                />
              </section>
            )}
          </div>

          {selecao === null ? (
            <Card className="flex items-center justify-center p-10 text-center">
              <p className="text-sm text-text-muted">
                {proximas.length > 0
                  ? "Escolha uma reunião na lista. Nas próximas, você vê o checklist do preparo."
                  : "Escolha uma reunião na lista."}
              </p>
            </Card>
          ) : selecao.tipo === "proxima" ? (
            <PreparoPanel leadId={selecao.leadId} agora={agora} />
          ) : (
            <MeetingDetailPanel meetingId={selecao.id} />
          )}
        </div>
      )}
    </div>
  );
}
