/**
 * Classificação de erro PERMANENTE de LLM — saldo esgotado, chave revogada,
 * modelo inexistente/não habilitado, org sem configuração. Retry não resolve
 * nenhum deles: re-tentar só queima as 5 tentativas da fila num loop de poll
 * de 250 ms e abre um alerta crítico POR JOB (o episódio de 10/08/2026: 38
 * leads → 9.225 alertas). O worker usa isto para dead-letter imediato
 * (`deadLetterJob`) em vez de `failJob`.
 *
 * A mesma taxonomia já existia em lib/ai/provider-validators.ts, mas só na
 * validação manual de credencial — aqui ela passa a valer no caminho quente.
 */
import { APICallError, RetryError } from 'ai';

import { LlmNotConfiguredError } from './credentials';
import {
  LlmBudgetExceededError,
  LlmModelNotEnabledError,
  LlmProviderUnknownError,
} from './run-model-call';

/**
 * Razão curta (para last_error/alerta) se o erro é permanente; `null` = erro
 * transitório, segue o retry normal da fila.
 */
export function permanentLlmErrorReason(err: unknown): string | null {
  // O AI SDK re-tenta internamente e embrulha em RetryError — o veredito está
  // no último erro real, não no envelope.
  const cause = RetryError.isInstance(err) ? (err.lastError ?? err) : err;

  if (cause instanceof LlmNotConfiguredError) return 'credencial LLM não configurada para a org';
  if (cause instanceof LlmBudgetExceededError) return 'orçamento mensal de LLM esgotado';
  if (cause instanceof LlmModelNotEnabledError) return 'modelo LLM não habilitado para a org';
  if (cause instanceof LlmProviderUnknownError) return 'provider LLM desconhecido';
  // run-model-call.ts lança Error cru neste caso (sem classe própria).
  if (cause instanceof Error && cause.message.startsWith('modelo LLM não definido')) {
    return 'modelo LLM não definido (agente sem versão publicada e org sem default_model)';
  }
  // isRetryable=false cobre 400 (saldo "credit balance is too low" vem como
  // invalid_request), 401/403 (chave) e 404 (modelo) — 429/5xx seguem retryable.
  if (APICallError.isInstance(cause) && cause.isRetryable === false) {
    const firstLine = cause.message.split('\n', 1)[0] ?? '';
    return `erro permanente do provider (HTTP ${cause.statusCode ?? '?'}): ${firstLine}`.slice(0, 200);
  }
  return null;
}
