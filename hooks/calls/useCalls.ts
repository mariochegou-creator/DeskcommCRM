"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { isTerminalCallStatus, type CallOutcome, type CallStatus } from "@/lib/calls/analysis-schema";

export interface CallRecord {
  id: string;
  contact_id: string;
  lead_id: string | null;
  activity_id: string | null;
  status: CallStatus;
  outcome: CallOutcome | null;
  score: number | null;
  transcript: string | null;
  analysis: unknown;
  error_detail: string | null;
  duration_seconds: number | null;
  mime_type: string | null;
  audio_url: string | null;
  audio_url_expires_in: number | null;
  created_at: string;
  updated_at: string;
}

interface StartCallResponse {
  data: {
    call_id: string;
    status: CallStatus;
    lead_id: string | null;
    activity_id: string | null;
    phone_e164: string;
    lead_routing: string;
  };
}

interface CallResponse {
  data: CallRecord;
}

/** Registra a tentativa de ligação e devolve o id da gravação a preencher. */
export function useStartCall(contactId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (origin: "contact" | "deal") =>
      apiClient.post<StartCallResponse>(`/api/v1/contacts/${contactId}/calls`, { origin }),
    onSuccess: () => {
      // A tentativa já é uma linha na timeline — ela tem de aparecer mesmo que o
      // SDR feche o popup sem gravar nada.
      void qc.invalidateQueries({ queryKey: ["timeline", contactId] });
    },
    onError: (err) => showApiError(err),
  });
}

/**
 * O estado da ligação, com poll enquanto o pipeline está em voo.
 *
 * O intervalo PARA sozinho em status terminal (`refetchInterval` devolve
 * `false`): sem isso, um popup esquecido aberto numa aba de fundo bateria na
 * rota a cada três segundos para sempre. E o poll existe justamente porque esta
 * tabela fica fora do realtime — ver o cabeçalho da migration 0100.
 */
export function useCall(callId: string | null, opts: { poll?: boolean } = {}) {
  const poll = opts.poll ?? true;
  return useQuery({
    queryKey: ["call", callId],
    enabled: Boolean(callId),
    queryFn: async () => {
      try {
        return await apiClient.get<CallResponse>(`/api/v1/calls/${callId}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    refetchInterval: (query) => {
      if (!poll) return false;
      const status = query.state.data?.data.status;
      if (!status) return 3000;
      return isTerminalCallStatus(status) ? false : 3000;
    },
  });
}

export interface UploadCallAudioInput {
  callId: string;
  blob: Blob;
  filename: string;
  durationSeconds?: number | null;
}

/**
 * Sobe o áudio.
 *
 * `fetch` cru em vez do `apiClient` por duas razões concretas, não por gosto:
 * ele serializa o corpo com `JSON.stringify` (o que destruiria o Blob) e usa
 * timeout de 10 s — um áudio de cinco minutos numa conexão de interior da Bahia
 * passa disso com folga, e o retry automático em cima de um upload já aceito
 * criaria gravação duplicada.
 */
export async function uploadCallAudio(input: UploadCallAudioInput): Promise<void> {
  const form = new FormData();
  form.append("file", input.blob, input.filename);
  if (input.durationSeconds != null) {
    form.append("duration_seconds", String(Math.max(0, Math.round(input.durationSeconds))));
  }

  const res = await fetch(`/api/v1/calls/${input.callId}/audio`, {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* corpo não-JSON: fica o status */
    }
    throw new Error(message);
  }
}
