/**
 * Zod do disparador (0108). Todo input externo passa por aqui.
 */
import { z } from "zod";

import { TIPOS_DE_MIDIA } from "@/lib/broadcasts/vocabulario";

/** Mesmo teto de `sendMessageSchema` — a legenda vira corpo da mensagem. */
export const MAX_CORPO = 4096;

export const filtroDePublicoSchema = z.object({
  pipeline_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().nullable().optional(),
  lead_status: z.enum(["open", "won", "lost", "any"]).nullable().optional(),
  lead_tag: z.string().min(1).max(60).nullable().optional(),
  contact_tag: z.string().min(1).max(60).nullable().optional(),
  custom_field: z
    .object({
      // Chave CRUA do cabeçalho do CSV — acento e maiúscula preservados de
      // propósito (a importação não normaliza; ver lib/broadcasts/audience.ts).
      key: z.string().min(1).max(120),
      value: z.string().min(1).max(200),
    })
    .nullable()
    .optional(),
});
export type FiltroDePublicoInput = z.infer<typeof filtroDePublicoSchema>;

export const criarDisparoSchema = z.object({
  name: z.string().min(1).max(120),
  body_template: z.string().max(MAX_CORPO).nullable().optional(),
  audience: filtroDePublicoSchema.default({}),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  daily_cap: z.number().int().min(1).max(10000).nullable().optional(),
  max_recipients: z.number().int().min(1).max(10000).default(1000),
  /** null = `resolverSessao` decide por contato (conversa existente vence). */
  channel_session_id: z.string().uuid().nullable().optional(),
});
export type CriarDisparoInput = z.infer<typeof criarDisparoSchema>;

/** Só rascunho é editável — depois da ativação existe fila, e mudar o texto no meio faria a campanha mandar duas mensagens diferentes. */
export const editarDisparoSchema = criarDisparoSchema.partial();

export const previewDePublicoSchema = z.object({
  audience: filtroDePublicoSchema.default({}),
  max_recipients: z.number().int().min(1).max(10000).default(1000),
  /** Opcional: quando vem, o preview também simula as variações do texto. */
  body_template: z.string().max(MAX_CORPO).nullable().optional(),
});

export const anexarMidiaSchema = z.object({
  /** Copia um áudio da gaveta (0095) em vez de subir arquivo novo. */
  saved_audio_id: z.string().uuid(),
});

export const midiaDoDisparoSchema = z.object({
  media_storage_path: z.string().min(3).max(300),
  media_mime: z.string().min(3).max(120),
  media_size_bytes: z.number().int().min(1),
  media_type: z.enum(TIPOS_DE_MIDIA),
});

export const ativarDisparoSchema = z.object({
  /**
   * Confirmação explícita para público grande. A tela manda o número que MOSTROU
   * ao operador; se o público mudou entre a revisão e o clique, a ativação para
   * e pede nova conferência — a alternativa é disparar para gente que a pessoa
   * nunca viu na tela.
   */
  confirmed_count: z.number().int().min(0).optional(),
});
