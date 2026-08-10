/**
 * CORS das rotas expostas à extensão do copiloto (`/api/v1/meetings/*`).
 *
 * Este arquivo era requisito documentado (lib/api/README.md: "allowlist por
 * tenant; nunca `*`") e não existia. Ele nasce agora com escopo DELIBERADAMENTE
 * estreito: só as rotas de reuniões o aplicam — o resto da API continua
 * same-origin, sem nenhum header de CORS, que é o estado mais seguro.
 *
 * Por que refletir `chrome-extension://<id>` por PADRÃO não é o `*` proibido:
 *
 *   1. A credencial destas rotas é o Bearer token (`api_tokens`, escopo
 *      `meetings:write`) — CORS aqui não protege credencial nenhuma, só decide
 *      de quais origens o NAVEGADOR deixa ler a resposta.
 *   2. O cookie de sessão é sameSite=strict + httpOnly: uma página de outra
 *      origem não consegue mandá-lo, então refletir a origem não abre CSRF de
 *      cookie.
 *   3. O id de extensão muda quando o Mario carrega "sem compactação" em outra
 *      máquina — cravar UM id no env é como a extensão para de funcionar na
 *      troca de notebook, silenciosamente. O padrão aceita o FORMATO de id de
 *      extensão (32 letras a-p, o alfabeto real dos ids do Chrome), nunca `*`.
 *
 * Origens extras (ex.: um front separado no futuro) entram por env
 * `EXTENSION_ALLOWED_ORIGINS` (lista separada por vírgula), explícitas.
 */
import type { NextResponse } from "next/server";

import { env } from "@/lib/env";

/** O formato de origem de extensão do Chrome: 32 letras entre a e p. */
const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

function extraAllowedOrigins(): string[] {
  return (env.EXTENSION_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedExtensionOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  if (CHROME_EXTENSION_ORIGIN.test(origin)) return true;
  return extraAllowedOrigins().includes(origin);
}

const ALLOWED_METHODS = "GET, POST, PATCH, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, X-Request-Id, Idempotency-Key";

/**
 * Aplica os headers de CORS numa resposta já montada por `ok()`/`fail()`.
 * Origem não permitida ⇒ nenhum header — o navegador bloqueia a leitura,
 * que é o comportamento correto (a resposta não vaza).
 */
export function withCorsHeaders<T extends NextResponse>(res: T, req: Request): T {
  const origin = req.headers.get("origin");
  if (isAllowedExtensionOrigin(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

/**
 * Resposta ao preflight (`OPTIONS`). Exportar como handler:
 * `export const OPTIONS = corsPreflight;`
 */
export function corsPreflight(req: Request): Response {
  const origin = req.headers.get("origin");
  if (!isAllowedExtensionOrigin(origin)) {
    // 204 sem headers de allow: preflight falha no navegador, sem vazar nada.
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
