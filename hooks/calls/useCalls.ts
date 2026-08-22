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
  sdr_notes: string | null;
  live_state: unknown;
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


/**
 * Manda UM bloco de áudio da ligação em curso e recebe de volta o que foi
 * transcrito mais a próxima frase para o SDR falar.
 *
 * `fetch` cru pelo mesmo motivo do `uploadCallAudio`: o `apiClient` serializa o
 * corpo com `JSON.stringify` (o que destruiria o Blob). O timeout aqui é
 * PRÓPRIO e curto — 20 s. Um bloco que demora mais que isso já perdeu a
 * utilidade (a conversa andou), e deixá-lo pendurado empilharia requisição em
 * cima de requisição até o navegador engasgar no meio da ligação.
 */
export interface BlocoAoVivo {
  texto: string;
  sugestao: {
    fase: string;
    sugestao: string;
    alerta: string | null;
    cobertura: Record<string, boolean>;
  } | null;
  transcription_error?: boolean;
}

export async function enviarBlocoAoVivo(input: {
  callId: string;
  blob: Blob;
  atSeconds: number;
  signal?: AbortSignal;
}): Promise<BlocoAoVivo> {
  const form = new FormData();
  form.append("file", input.blob, "bloco.webm");
  form.append("at_seconds", String(Math.max(0, Math.round(input.atSeconds))));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  input.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(`/api/v1/calls/${input.callId}/live`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data: BlocoAoVivo };
    return body.data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A anotação do SDR, salva enquanto ele digita.
 *
 * Sem `showApiError`: isto dispara a cada pausa de digitação durante uma
 * ligação, e um toast vermelho porque a rede oscilou por um segundo é
 * exatamente o tipo de interrupção que este popup existe para não causar. O
 * erro aparece na própria caixa de anotação, discreto.
 */
export function useSaveCallNotes(callId: string | null) {
  return useMutation({
    mutationFn: async (sdr_notes: string) => {
      if (!callId) return null;
      return apiClient.patch(`/api/v1/calls/${callId}`, { sdr_notes });
    },
  });
}

/** Roda a análise de novo — o botão que substitui o SQL de reprocessamento. */
export function useReanalyzeCall(callId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => apiClient.post(`/api/v1/calls/${callId}/reanalyze`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["call", callId] });
    },
    onError: (err) => showApiError(err),
  });
}

export interface CallListItem {
  id: string;
  contact_id: string;
  lead_id: string | null;
  contact_name: string;
  phone_number: string | null;
  status: CallStatus;
  outcome: CallOutcome | null;
  score: number | null;
  duration_seconds: number | null;
  created_at: string;
}

interface CallsListResponse {
  data: { items: CallListItem[]; total: number; limit: number; offset: number };
}

/** O histórico da tela de Ligações. */
export function useCallsList(params: { limit?: number; offset?: number; outcome?: CallOutcome }) {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.offset) search.set("offset", String(params.offset));
  if (params.outcome) search.set("outcome", params.outcome);

  return useQuery({
    queryKey: ["calls", params],
    queryFn: async () => apiClient.get<CallsListResponse>(`/api/v1/calls?${search.toString()}`),
  });
}
