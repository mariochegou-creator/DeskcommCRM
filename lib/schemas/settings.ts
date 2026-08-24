/**
 * Zod schemas for /app/settings/* server actions and routes (EPIC-10).
 *
 * - profileSchema: persisted to auth.users.raw_user_meta_data
 * - tenantSchema: persisted to organizations row + organizations.settings jsonb
 * - notificationPrefsSchema: STUB (notification_prefs table not yet migrated)
 * - pipelineConfigPatchSchema: pipeline vocabulary + settings.fields + settings.lost_reasons
 */
import { z } from "zod";

import { conversationTagSchema } from "./messaging";

const LOCALES = ["pt-BR", "en-US"] as const;

/**
 * G6-02: organizations.settings.ai_dispatch_mode (edge-contract do Vendaval).
 * 'native' (default) = o dispatcher de IA deste repo processa os eventos
 * ai_agent.dispatch_requested. 'external' = o tenant delega o dispatch ao
 * runtime externo (Vendaval); o dispatcher nativo PULA o evento sem tocá-lo.
 * `.catch("native")` normaliza chave ausente/null/inválida para o default seguro.
 */
export const AI_DISPATCH_MODES = ["native", "external"] as const;
export type AiDispatchMode = (typeof AI_DISPATCH_MODES)[number];
export const aiDispatchModeSchema = z.enum(AI_DISPATCH_MODES).catch("native");

/**
 * G3-05: vocabulário canônico de tags de conversa, persistido em
 * organizations.settings.canonical_conversation_tags (spec 13 §3.3 — org-scoped,
 * não pipeline-scoped). Schema declarativo; usado para validar o que o inbox lê
 * como sugestões.
 */
export const canonicalConversationTagsSchema = z
  .array(conversationTagSchema)
  .max(50)
  .transform((tags) => Array.from(new Set(tags)))
  .catch([]);
export type CanonicalConversationTags = z.infer<typeof canonicalConversationTagsSchema>;

/**
 * organizations.settings.sixty_day_brief — o resumo bom-dia do plano de 60
 * dias (cron plan-morning-brief, 8h30 America/Bahia, seg–sex).
 *
 * Config de TENANT, não env: destinatário é dado da org (trocar telefone não
 * pode exigir restart), e o cron descobre org + destinos numa varredura só.
 * `.catch` em cada campo: chave ausente/mal formada degrada para "desligado"
 * sem derrubar o tick — o padrão dos outros schemas de settings.
 */
export const sixtyDayBriefSchema = z
  .object({
    enabled: z.boolean().catch(false),
    /** Sessão WAHA preferida (waha_session_name); null ⇒ 1ª WORKING da org. */
    session_name: z.string().min(1).max(120).nullable().catch(null),
    recipients: z
      .array(
        z.object({
          name: z.string().min(1).max(40),
          phone: z.string().regex(/^\+\d{8,15}$/),
        }),
      )
      .max(5)
      .catch([]),
  })
  .catch({ enabled: false, session_name: null, recipients: [] });
export type SixtyDayBriefConfig = z.infer<typeof sixtyDayBriefSchema>;

/**
 * organizations.settings.grupo_da_reuniao — QUEM fala no grupo da reunião.
 *
 * Sem isto o grupo nasce pela conexão que já conversa com o lead (o número do
 * Mario), e aí o dono da conexão NÃO entra como participante: ele vira a voz da
 * assistente e perde a voz própria dentro do grupo. Apontando aqui uma conexão
 * dedicada ("Nexo IA"), o grupo nasce por ela e o time inteiro entra como gente.
 *
 * `session_name` é o `channel_sessions.waha_session_name` — a MESMA chave que
 * `sixty_day_brief.session_name` usa. null (ou sessão fora do ar) ⇒ volta ao
 * comportamento antigo, que funciona; degradar para o número do lead é
 * infinitamente melhor do que não criar o grupo.
 */
export const grupoDaReuniaoSchema = z
  .object({
    session_name: z.string().min(1).max(120).nullable().catch(null),
    /**
     * A conexão da assistente entra no CRM SÓ pelos grupos: mensagem 1:1 dela é
     * descartada antes de virar conversa — e antes de o corpo ser registrado.
     *
     * Existe porque a primeira conexão apontada aqui pode ser um WhatsApp
     * pessoal emprestado: sem isto, conversa de família viraria ficha de lead no
     * inbox. Vem ligado por padrão; desligar só faz sentido num chip dedicado,
     * onde um lead pode responder no privado e a mensagem precisa entrar.
     */
    so_grupo: z.boolean().catch(true),
    /**
     * QUEM entra no grupo, em E.164 — quando vazio, cai na lista do bom-dia
     * (`sixty_day_brief.recipients`). Divergir das duas listas era proibido de
     * propósito, e deixou de ser a pedido do Mario (21/08/2026): o bom-dia vai
     * no pessoal dele (DDD 11), mas pessoal dele em grupo com cliente não —
     * no grupo entra o número de atendimento. São duas perguntas diferentes:
     * "onde o Mario lê" e "que número o cliente vê".
     */
    participantes: z.array(z.string().min(8).max(20)).max(5).catch([]),
    /**
     * Path (no bucket `whatsapp-media`, fora de qualquer conversa — ex.:
     * `{org}/library/grupo/abertura-claudio.mp3`) do áudio de abertura do
     * Claudio, gravado UMA vez e reusado em todo grupo novo. Presente ⇒ a
     * abertura sai em três atos (texto curto → áudio → pergunta escrita);
     * null ⇒ abertura de texto único, como sempre foi. O envio copia o objeto
     * para dentro da conversa antes de mandar (mesma razão da gaveta de áudios:
     * `isMediaPathOwnedBy` não aceita path de fora, e afrouxá-la seria o
     * caminho curto e errado).
     */
    audio_abertura: z.string().min(3).max(300).nullable().catch(null),
    /**
     * Path (no bucket `whatsapp-media`, ex.: `{org}/library/grupo/capa.jpg`)
     * da imagem que vira a CAPA de todo grupo novo — escolha do Mario
     * (22/08/2026, "opção 2"): capa fixa, independente da foto do chip.
     * null ⇒ cai na foto de perfil da conexão que cria, como antes.
     */
    capa: z.string().min(3).max(300).nullable().catch(null),
  })
  .catch({
    session_name: null,
    so_grupo: true,
    participantes: [],
    audio_abertura: null,
    capa: null,
  });
export type GrupoDaReuniaoConfig = z.infer<typeof grupoDaReuniaoSchema>;

export type Locale = (typeof LOCALES)[number];

export const profileSchema = z.object({
  full_name: z.string().min(1).max(120).nullable().optional(),
  locale: z.enum(LOCALES),
  timezone: z.string().min(1).max(64),
  avatar_url: z
    .string()
    .url()
    .max(2048)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  /**
   * "Meu número de WhatsApp" (channel_sessions.id) na org ativa. `null` limpa o
   * vínculo; ausente não mexe nele — quem manda só nome/fuso não perde o número.
   */
  meu_numero_channel_id: z.string().uuid().nullable().optional(),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const tenantSchema = z.object({
  display_name: z.string().min(1).max(120),
  legal_name: z.string().min(1).max(200),
  cnpj: z
    .string()
    .max(20)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  timezone: z.string().min(1).max(64),
  locale: z.enum(LOCALES),
  media_retention_days: z.coerce.number().int().min(30).max(3650),
  dpo_email: z
    .string()
    .email()
    .max(200)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  privacy_policy_url: z
    .string()
    .url()
    .max(2048)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  lost_reasons_extra: z.array(z.string().min(1).max(80)).max(50).default([]),
  /**
   * organizations.settings.cola_do_mercado — o que o vendedor sabe sobre o
   * mercado do cliente, em texto livre, e que a estrela do inbox cola no
   * prompt do rascunho.
   *
   * Mora no settings jsonb (molde do `lost_reasons_extra` acima) porque é
   * conteúdo de operação, não de código: muda quando o nicho de foco muda, e
   * quem muda é quem vende — sem deploy, sem migration.
   *
   * O teto de 12k caracteres é o do prompt: a cola vai INTEIRA para o modelo
   * (ver draft-reply.ts, que explica por que inteira e não por busca), e
   * ~12k caracteres é o ponto em que ela deixa de caber junto do histórico da
   * conversa sem empurrar o começo dele para fora da janela.
   */
  cola_do_mercado: z.string().max(12000).default(""),
});
export type TenantInput = z.infer<typeof tenantSchema>;

export const NOTIFICATION_CATEGORIES = [
  "lead_assigned",
  "lead_won",
  "lead_lost",
  "mention",
] as const;
export const NOTIFICATION_CHANNELS = ["email", "in_app", "push"] as const;

export const notificationPrefsSchema = z.object({
  prefs: z.array(
    z.object({
      category: z.enum(NOTIFICATION_CATEGORIES),
      channel: z.enum(NOTIFICATION_CHANNELS),
      enabled: z.boolean(),
    }),
  ),
});
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

const customFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/i, "Use letras, números e underscore"),
  label: z.string().min(1).max(80),
  type: z.enum([
    "text",
    "textarea",
    "number",
    "date",
    "select",
    "multiselect",
    "boolean",
    "email",
    "phone",
    "url",
  ]),
  required: z.boolean().optional(),
  options: z
    .array(z.object({ value: z.string().min(1), label: z.string().min(1) }))
    .optional(),
});

export const pipelineConfigPatchSchema = z.object({
  vocabulary: z
    .object({
      lead: z.string().min(1).max(40).optional(),
      deal: z.string().min(1).max(40).optional(),
      won: z.string().min(1).max(40).optional(),
      lost: z.string().min(1).max(40).optional(),
    })
    .optional(),
  fields: z.array(customFieldSchema).max(50).optional(),
  lost_reasons: z.array(z.string().min(1).max(80)).max(50).optional(),
});
export type PipelineConfigPatch = z.infer<typeof pipelineConfigPatchSchema>;
