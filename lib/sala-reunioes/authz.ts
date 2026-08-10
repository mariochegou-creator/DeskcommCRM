/**
 * Autorização DUAL das rotas /api/v1/meetings/* — cookie OU Bearer.
 *
 * Duas portas para o mesmo recurso porque há dois chamadores legítimos:
 *   · A aba do CRM (navegador logado) — cookie de sessão, via `requireRole`.
 *   · A extensão do copiloto no Meet — `Authorization: Bearer dsk_...`
 *     (api_tokens com escopo `meetings:write`), porque o cookie é
 *     sameSite=strict e não atravessa origem.
 *
 * A rota fica em `PUBLIC_PATHS` (o proxy não exige cookie), então TODA rota de
 * reuniões DEVE passar por aqui antes de tocar o banco — igual ao contrato do
 * /api/mcp.
 *
 * Service-role caveat (CLAUDE.md §multi-tenancy): o caminho Bearer usa o admin
 * client (não há sessão para a RLS escopar), então toda query das rotas filtra
 * `organization_id` com o `orgId` daqui — que vem da linha do token ou do
 * `requireRole`, nunca do body.
 */
import type { NextRequest, NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { ApiTokenError, hasScope, validateApiTokenHeader } from "@/lib/auth/api-token";
import { requireRole } from "@/lib/auth/require-role";

/** Escopo que o token da extensão precisa carregar (UI de API Tokens). */
export const MEETINGS_SCOPE = "meetings:write";

export type MeetingsAuthz =
  | {
      ok: true;
      orgId: string;
      /** null quando a chamada veio por token (a extensão não é um usuário). */
      userId: string | null;
      viaToken: boolean;
    }
  | { ok: false; response: NextResponse<ApiError> };

export async function authorizeMeetings(
  req: NextRequest,
  opts: { requestId: string },
): Promise<MeetingsAuthz> {
  const { requestId } = opts;
  const authHeader = req.headers.get("authorization");

  if (authHeader) {
    try {
      const token = await validateApiTokenHeader(authHeader);
      if (!hasScope(token.scopes, MEETINGS_SCOPE)) {
        return {
          ok: false,
          response: fail(
            "forbidden_scope",
            `Token sem o escopo '${MEETINGS_SCOPE}'. Gere um token com esse escopo em Configurações → API Tokens.`,
            403,
            { requestId },
          ),
        };
      }
      return { ok: true, orgId: token.organizationId, userId: null, viaToken: true };
    } catch (err) {
      if (err instanceof ApiTokenError) {
        return {
          ok: false,
          response: fail(err.code, err.message, err.httpStatus, { requestId }),
        };
      }
      throw err;
    }
  }

  // Sem header Authorization: é a aba do CRM — cookie + role, o caminho padrão.
  const authz = await requireRole("agent", { requestId, resource: "crm_meetings" });
  if (!authz.ok) return { ok: false, response: authz.response };
  return { ok: true, orgId: authz.org.orgId, userId: authz.user.id, viaToken: false };
}
