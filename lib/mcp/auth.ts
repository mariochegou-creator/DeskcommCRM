/**
 * Bearer-token auth para o MCP server.
 *
 * Reutiliza `api_tokens` (EPIC-01 / Spec 01 §api-tokens). Plain bearer
 * (`dsk_<prefix>_<secret>`) e hashado SHA256 e batido contra `token_hash`.
 * Nunca logamos plaintext (Sentry beforeSend strip ja cobre `authorization`).
 *
 * O NÚCLEO da validação (hash, lookup, revogação, expiração, scopes,
 * last_used_at) mora em `lib/auth/api-token.ts` desde a Sala de Reuniões
 * (0098) — a extensão do copiloto é o segundo consumidor de token, e duplicar
 * a checagem em dois arquivos é como as cópias divergem. Este módulo mantém o
 * invólucro do JSON-RPC: `McpAuthError` carrega o mcpCode que o protocolo
 * exige, e a tradução de `ApiTokenError` → `McpAuthError` acontece aqui.
 *
 * Atributos extras (actor_type, agent_run_id, role) ficam em `scopes`
 * como tokens convencionais, sem migration:
 *   `role:manager`     -> role override (default `agent`)
 *   `actor:ai_agent`   -> marca actor_type (default `user`)
 *   `agent_run:<uuid>` -> vincula tool_call ao run (Spec 10)
 *   `mcp:read`         -> habilita read tools desta wave
 *   `mcp:write`        -> habilita write tools (S-13.04)
 */
import {
  ApiTokenError,
  extractBearer,
  validateApiTokenHeader,
  type ApiTokenAuth,
} from "@/lib/auth/api-token";
import type { Role } from "@/lib/auth/types";
import { ROLE_RANK } from "@/lib/auth/types";

export type McpAuthResult = ApiTokenAuth;

export class McpAuthError extends Error {
  constructor(
    public readonly mcpCode: number,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "McpAuthError";
  }
}

export { extractBearer };

export async function validateBearerToken(
  authHeader: string | null,
): Promise<McpAuthResult> {
  try {
    return await validateApiTokenHeader(authHeader);
  } catch (err) {
    if (err instanceof ApiTokenError) {
      // 401 → -32001 (auth), 500 → -32603 (internal) — os mesmos códigos que
      // este módulo devolvia antes da extração do núcleo.
      const mcpCode = err.httpStatus === 401 ? -32001 : -32603;
      throw new McpAuthError(mcpCode, err.httpStatus, err.message);
    }
    throw err;
  }
}

export function ensureRole(actual: Role, minimum: Role): void {
  if (ROLE_RANK[actual] < ROLE_RANK[minimum]) {
    throw new McpAuthError(
      -32002,
      403,
      `Role '${actual}' insufficient (required: '${minimum}').`,
    );
  }
}

export function ensureScope(scopes: string[], required: string): void {
  if (!scopes.includes(required)) {
    throw new McpAuthError(-32002, 403, `Token missing required scope '${required}'.`);
  }
}
