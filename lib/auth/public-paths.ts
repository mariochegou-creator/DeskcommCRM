/**
 * Paths that bypass auth check in middleware.
 * Match precedence: array order. First match wins.
 */
export const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/login(\/.*)?$/,
  /^\/signup$/,
  /^\/auth\/confirm$/,
  /^\/403$/,
  /^\/admin\/forbidden$/,
  /^\/404$/,
  /^\/500$/,
  /^\/503$/,
  /^\/api\/v1\/health$/,
  /^\/api\/v1\/webhooks\//,
  /^\/api\/v1\/cron\//,
  /^\/api\/internal\//,
  /^\/api\/mcp(\/.*)?$/,
  // Sala de Reuniões (0098): a extensão do copiloto autentica por Bearer
  // (api_tokens), não por cookie — o proxy não pode exigir sessão aqui. O gate
  // é DENTRO da rota (lib/sala-reunioes/authz.ts, cookie OU token), mesmo
  // contrato do /api/mcp acima.
  /^\/api\/v1\/meetings(\/.*)?$/,
  /^\/_next\//,
  /^\/favicon\.ico$/,
  /^\/team\/accept-invite\/.+$/,
  /^\/account-suspended$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}
