"use client";
/**
 * Sala de Reuniões — a tela.
 *
 * Duas colunas no desktop (lista à esquerda, dossiê à direita), empilhado no
 * mobile. Texto grande e pouco de cada vez, de propósito: o dono da sala lê
 * melhor cartão curto do que parágrafo.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonoLabel } from "@/components/ui/mono-label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateMeeting, useMeetings } from "@/hooks/sala-reunioes/useMeetings";
import { VideoCamera } from "@/lib/ui/icons";

import { MeetingDetailPanel } from "./MeetingDetailPanel";
import { MeetingMetrics } from "./MeetingMetrics";
import { MeetingsList } from "./MeetingsList";

export function SalaDeReunioesClient() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const meetingsQuery = useMeetings();
  const createMeeting = useCreateMeeting();

  const meetings = meetingsQuery.data?.data.meetings ?? null;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <MonoLabel>sala de reuniões</MonoLabel>
          <h1 className="text-xl font-bold text-text">Suas reuniões do Meet</h1>
          <p className="text-sm text-text-muted">
            O copiloto grava a conversa, sugere a próxima pergunta e traz tudo para cá.
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
                { onSuccess: (res) => setSelectedId(res.data.meeting.id) },
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
                { onSuccess: (res) => setSelectedId(res.data.meeting.id) },
              )
            }
          >
            Nova R2 (teste)
          </Button>
        </div>
      </header>

      <MeetingMetrics />

      {meetingsQuery.isLoading ? (
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
      ) : meetings.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <VideoCamera size={40} className="text-text-subtle" aria-hidden />
          <p className="text-base font-medium text-text">Nenhuma reunião ainda</p>
          <p className="max-w-md text-sm text-text-muted">
            Instale a extensão do copiloto no Chrome e clique em “Iniciar R1” dentro do
            Google Meet — a reunião aparece aqui sozinha. Ou crie uma de teste acima.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <MeetingsList
            meetings={meetings}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <MeetingDetailPanel meetingId={selectedId} />
        </div>
      )}
    </div>
  );
}
