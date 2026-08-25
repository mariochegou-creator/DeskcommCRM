"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { FiltroDePublico } from "@/lib/broadcasts/audience";
import type { StatusDeCampanha, TipoDeMidia } from "@/lib/broadcasts/vocabulario";

/**
 * A tela de Disparos (0108). Uma chave para a lista, uma por campanha aberta.
 *
 * O `refetchInterval` da campanha em andamento é o coração desta tela: o worker
 * roda por fora, a cada minuto, e sem polling a barra de progresso ficaria
 * parada dando a impressão de que travou. Ele SÓ liga quando a campanha está
 * viva — uma campanha concluída não muda mais, e continuar perguntando de minuto
 * em minuto seria carga permanente por nada.
 */
const CHAVE_LISTA = ["disparos"] as const;

export interface PlacarDeCampanha {
  pending?: number;
  sending?: number;
  sent?: number;
  failed?: number;
  skipped?: number;
  cancelled?: number;
}

export interface Campanha {
  id: string;
  name: string;
  status: StatusDeCampanha;
  pause_reason: string | null;
  body_template: string | null;
  media_type: TipoDeMidia | null;
  media_storage_path: string | null;
  audience: FiltroDePublico;
  scheduled_at: string | null;
  daily_cap: number | null;
  max_recipients: number;
  send_as_user_id: string;
  channel_session_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  placar: PlacarDeCampanha;
}

export interface RelatorioDaCampanha {
  total: number;
  por_status: PlacarDeCampanha;
  por_motivo_de_pulo: Record<string, number>;
  entregues: number;
  lidos: number;
  responderam: number;
}

export interface ProblemaNoDisparo {
  nome: string | null;
  telefone: string | null;
  status: string;
  motivo: string | null;
}

export type CampanhaDetalhada = Omit<Campanha, "placar"> & {
  media_mime: string | null;
  media_size_bytes: number | null;
  relatorio: RelatorioDaCampanha;
  problemas: ProblemaNoDisparo[];
};

/** Uma campanha viva ainda muda sozinha; o resto é história. */
export function estaViva(status: StatusDeCampanha): boolean {
  return status === "running" || status === "scheduled";
}

export function useDisparos() {
  return useQuery({
    queryKey: CHAVE_LISTA,
    queryFn: async (): Promise<Campanha[]> => {
      const res = await apiClient.get<{ data: { broadcasts: Campanha[] } }>("/api/v1/broadcasts");
      return res.data.broadcasts ?? [];
    },
    // A lista mostra o placar de cada campanha; enquanto uma estiver rodando ela
    // muda a cada minuto por fora.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((c) => estaViva(c.status)) ? 20_000 : false,
  });
}

export function useDisparo(id: string | null) {
  return useQuery({
    queryKey: ["disparo", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<CampanhaDetalhada> => {
      const res = await apiClient.get<{ data: CampanhaDetalhada }>(
        `/api/v1/broadcasts/${encodeURIComponent(id ?? "")}`,
      );
      return res.data;
    },
    refetchInterval: (query) => (query.state.data && estaViva(query.state.data.status) ? 15_000 : false),
  });
}

export interface CamposDePublico {
  custom_fields: { key: string; values: string[] }[];
  client_tags: { name: string; color: string }[];
  lead_tags: string[];
}

/** As dimensões que ESTA org tem — nicho é chave de CSV, não campo do sistema. */
export function useCamposDePublico() {
  return useQuery({
    queryKey: ["disparos", "campos"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CamposDePublico> => {
      const res = await apiClient.get<{ data: CamposDePublico }>("/api/v1/broadcasts/campos");
      return res.data;
    },
  });
}

export interface ResumoDoPublico {
  total: number;
  aptos: number;
  pulados: Record<string, number>;
  amostra: { nome: string | null; telefone: string | null; motivo: string | null }[];
  duracao_estimada_segundos: number;
  variacao: {
    variantes: number;
    vai_ser_vetado: boolean;
    envio_do_veto: number | null;
    exemplos: string[];
  } | null;
}

/**
 * O dry-run. É mutation e não query de propósito: roda quando o operador pede,
 * não a cada tecla digitada no filtro — cada chamada varre o funil inteiro.
 */
export function usePreverPublico() {
  return useMutation({
    mutationFn: async (args: {
      audience: FiltroDePublico;
      max_recipients?: number;
      body_template?: string | null;
    }) => {
      const res = await apiClient.post<{ data: ResumoDoPublico }>(
        "/api/v1/broadcasts/preview",
        args,
      );
      return res.data;
    },
    onError: showApiError,
  });
}

export function useCriarDisparo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      name: string;
      body_template?: string | null;
      audience: FiltroDePublico;
      max_recipients?: number;
      daily_cap?: number | null;
      scheduled_at?: string | null;
    }) => {
      const res = await apiClient.post<{ data: Campanha }>("/api/v1/broadcasts", args);
      return res.data;
    },
    onError: showApiError,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_LISTA });
    },
  });
}

/**
 * Sobe a mídia da campanha. FormData cru (não `apiClient`, que serializa JSON) —
 * mesmo caminho do composer do inbox.
 */
export function useAnexarMidia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; file: File }) => {
      const form = new FormData();
      form.append("file", args.file);
      const res = await fetch(`/api/v1/broadcasts/${encodeURIComponent(args.id)}/media`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as { data?: unknown; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? "Falha ao anexar a mídia.");
      return body.data;
    },
    onError: showApiError,
    onSuccess: (_d, args) => {
      void qc.invalidateQueries({ queryKey: ["disparo", args.id] });
      void qc.invalidateQueries({ queryKey: CHAVE_LISTA });
    },
  });
}

/**
 * O ponto de não-retorno: materializa a fila e põe a campanha para andar.
 * `confirmed_count` é o número que a tela MOSTROU — se o público mudou desde a
 * revisão, a rota recusa em vez de disparar para gente que ninguém viu.
 */
export function useAtivarDisparo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; confirmed_count?: number }) => {
      const res = await apiClient.post<{
        data: { status: string; publico: number; aptos: number; pulados: number };
      }>(`/api/v1/broadcasts/${encodeURIComponent(args.id)}/activate`, {
        confirmed_count: args.confirmed_count,
      });
      return res.data;
    },
    onError: showApiError,
    onSuccess: (_d, args) => {
      void qc.invalidateQueries({ queryKey: CHAVE_LISTA });
      void qc.invalidateQueries({ queryKey: ["disparo", args.id] });
    },
  });
}

export function useAcaoNoDisparo(acao: "pause" | "resume" | "cancel") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ data: { status: string } }>(
        `/api/v1/broadcasts/${encodeURIComponent(id)}/${acao}`,
        {},
      );
      return res.data;
    },
    onError: showApiError,
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: CHAVE_LISTA });
      void qc.invalidateQueries({ queryKey: ["disparo", id] });
    },
  });
}
