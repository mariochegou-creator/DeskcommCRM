/**
 * Vercel AI Gateway wrapper.
 *
 * Centralises model routing so the rest of the codebase only references model
 * strings like `"anthropic/claude-sonnet-4-6"`. Lazy initialisation: if
 * `AI_GATEWAY_API_KEY` (or `ANTHROPIC_API_KEY` as fallback) is missing we
 * deliberately do NOT throw at import time — `isAiGatewayConfigured()` lets
 * callers skip gracefully.
 *
 * Anti-pattern guard (CLAUDE.md): we never `import Anthropic from "@anthropic-ai/sdk"`.
 * Only model strings via the gateway-shaped `ai` SDK calls.
 */

import { createAnthropic } from "@ai-sdk/anthropic";

import { env } from "@/lib/env";

export type ModelId =
  | "anthropic/claude-sonnet-4-6"
  | "anthropic/claude-haiku-4-5"
  | "openai/text-embedding-3-small"
  // Allow arbitrary tenant-configured strings without losing autocomplete on the canonical ones.
  | (string & {});

export const DEFAULT_BOT_MODEL: ModelId = "anthropic/claude-sonnet-4-6";
export const DEFAULT_CLASSIFIER_MODEL: ModelId = "anthropic/claude-haiku-4-5";
export const DEFAULT_EMBEDDING_MODEL: ModelId = "openai/text-embedding-3-small";

export function isAiGatewayConfigured(): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY) || Boolean(env.ANTHROPIC_API_KEY);
}

export function isEmbeddingProviderConfigured(): boolean {
  // Embeddings go through the gateway when `AI_GATEWAY_API_KEY` is set;
  // otherwise the worker calls `openai/...` directly via OPENAI_API_KEY.
  return Boolean(env.AI_GATEWAY_API_KEY) || Boolean(env.OPENAI_API_KEY);
}

/**
 * Headers that flow with every gateway call. Tenant ID lets the gateway
 * dashboard slice usage per organization; ZDR opts the request out of provider
 * training corpora (privacy-by-default for tenant data).
 */
export function gatewayHeaders(opts: { organizationId: string }): Record<string, string> {
  return {
    "X-AI-Gateway-Tenant-Id": opts.organizationId,
    "X-AI-Gateway-Zero-Retention": "1",
  };
}

/**
 * The `ai` SDK uses `AI_GATEWAY_API_KEY` from process.env automatically when
 * passing string model ids. We surface it here so the worker can fail fast
 * with a clear skip reason, and so future explicit `createGateway()` callers
 * have the canonical place to read config.
 */
export function gatewayConfig(): { apiKey: string; baseURL?: string } | null {
  if (!env.AI_GATEWAY_API_KEY) return null;
  return {
    apiKey: env.AI_GATEWAY_API_KEY,
    baseURL: env.AI_GATEWAY_BASE_URL || undefined,
  };
}

/**
 * O modelo que o `generateText` deve receber, dado o ambiente.
 *
 * String `"anthropic/..."` só autentica quando `AI_GATEWAY_API_KEY` existe —
 * o "fallback" para `ANTHROPIC_API_KEY` que `isAiGatewayConfigured()` promete
 * não acontecia de fato: sem a chave do gateway, a chamada morria com
 * "Unauthenticated request to AI Gateway" (medido na análise de reunião, dev
 * local com só a chave da Anthropic). Aqui o fallback vira real: sem gateway,
 * o model id vira instância do provider direto da Anthropic (mesmo caminho do
 * registry do agent-engine — `createAnthropic` do AI SDK, nunca
 * `@anthropic-ai/sdk`, que é o anti-pattern nomeado no topo deste arquivo).
 */
export function resolveModel(model: ModelId) {
  if (env.AI_GATEWAY_API_KEY) return model;
  if (env.ANTHROPIC_API_KEY && model.startsWith("anthropic/")) {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return anthropic(model.slice("anthropic/".length));
  }
  return model;
}
