/**
 * Validação de Bearer token (`api_tokens`) — o núcleo compartilhado.
 *
 * Extraído de `lib/mcp/auth.ts` porque nasceu um segundo consumidor: as rotas
 * `/api/v1/meetings/*`, chamadas pela extensão do copiloto de reunião (que não
 * tem cookie de sessão — sameSite strict não atravessa origem). Duplicar o
 * hash/lookup/expiração em dois arquivos é como as duas cópias divergem: uma
 * ganharia a checagem de revogação nova e a outra não.
 *
 * O MCP continua com o próprio invólucro (`McpAuthError` carrega mcpCode do
 * JSON-RPC); aqui o erro é HTTP puro. A SEMÂNTICA — formato `dsk_`, SHA256
 * contra `token_hash`, revogação, expiração, scopes em `api_tokens.scopes`,
 * carimbo fire-and-forget de `last_used_at` — mora só neste arquivo.
 */
import { createHash } from "node:crypto";

import type { Actor } from "@/lib/api/handlers/types";
import type { Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ApiTokenAuth {
  organizationId: string;
  role: Role;
  actor: Actor;
  apiTokenId: string;
  scopes: string[];
}

export class ApiTokenError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiTokenError";
  }
}

const VALID_ROLES = new Set<Role>(["viewer", "agent", "manager", "admin"]);

function parseScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string");
}

/** `role:manager` no scopes vira role efetivo; default `agent` (contrato do MCP). */
export function scopesRole(scopes: string[]): Role {
  for (const s of scopes) {
    if (s.startsWith("role:")) {
      const r = s.slice("role:".length) as Role;
      if (VALID_ROLES.has(r)) return r;
    }
  }
  return "agent";
}

function deriveActor(scopes: string[], tokenId: string): Actor {
  const isAiAgent = scopes.includes("actor:ai_agent");
  const role = scopesRole(scopes);
  if (isAiAgent) {
    const runScope = scopes.find((s) => s.startsWith("agent_run:"));
    const runId = runScope ? runScope.slice("agent_run:".length) : tokenId;
    return { type: "ai_agent", id: runId, role, api_token_id: tokenId };
  }
  return { type: "user", id: tokenId, role };
}

export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return null;
  return m[1]!.trim();
}

/**
 * Valida o header `Authorization: Bearer dsk_...` contra `api_tokens`.
 * Lança `ApiTokenError` com o status HTTP certo; nunca loga o plaintext.
 */
export async function validateApiTokenHeader(authHeader: string | null): Promise<ApiTokenAuth> {
  const plaintext = extractBearer(authHeader);
  if (!plaintext) {
    throw new ApiTokenError(401, "unauthenticated", "Missing or malformed Authorization header.");
  }
  if (!plaintext.startsWith("dsk_")) {
    throw new ApiTokenError(401, "unauthenticated", "Invalid token format.");
  }

  const tokenHash = createHash("sha256").update(plaintext).digest();
  const hashLiteral = `\\x${tokenHash.toString("hex")}`;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, organization_id, scopes, revoked_at, expires_at")
    .eq("token_hash", hashLiteral)
    .maybeSingle();

  if (error) {
    throw new ApiTokenError(500, "internal_error", `Token lookup failed: ${error.message}`);
  }
  if (!data) {
    throw new ApiTokenError(401, "unauthenticated", "Token not recognized.");
  }
  if (data.revoked_at) {
    throw new ApiTokenError(401, "unauthenticated", "Token revoked.");
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new ApiTokenError(401, "unauthenticated", "Token expired.");
  }

  const scopes = parseScopes(data.scopes);
  const role = scopesRole(scopes);
  const actor = deriveActor(scopes, data.id);

  // Fire-and-forget: telemetria de uso não pode atrasar nem derrubar a request.
  supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(({ error: updErr }) => {
      if (updErr) console.error("[api-token] last_used_at update failed", updErr.message);
    });

  return {
    organizationId: data.organization_id,
    role,
    actor,
    apiTokenId: data.id,
    scopes,
  };
}

export function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes(required);
}
