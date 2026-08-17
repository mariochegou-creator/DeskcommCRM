/**
 * Google Agenda — o evento nasce junto com o agendamento no Kanban.
 *
 * Duas superfícies, de propósito:
 *
 *  - `criarEventoNaAgenda` só funciona com a integração ligada (4 env vars). É
 *    o caminho automático: o card entra na coluna, o evento aparece na agenda,
 *    ninguém digita nada.
 *  - `linkParaAdicionarNaAgenda` funciona SEMPRE, sem configurar nada. É o
 *    fallback de um clique que o dialog mostra quando a integração está
 *    desligada ou o Google recusou.
 *
 * O fallback existe porque a alternativa é pior: sem ele, o dia em que o
 * refresh token expira (Google revoga token de app em modo de teste a cada 7
 * dias) é o dia em que as reuniões param de entrar na agenda EM SILÊNCIO. Com
 * ele, a rota devolve o link e o humano segue trabalhando.
 *
 * Nada aqui derruba um agendamento: falha do Google vira `{ ok: false }`, a
 * reunião continua gravada e as mensagens continuam saindo.
 */
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { DURACAO_DA_REUNIAO_MIN, type Ocupacao } from "./reuniao";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars";
const TIMEOUT_MS = 8_000;

/** Duração padrão do bloco na agenda. Uma fonte só — ver `reuniao.ts`. */
export const DURACAO_PADRAO_MIN = DURACAO_DA_REUNIAO_MIN;

export interface EventoDaReuniao {
  titulo: string;
  descricao?: string;
  /** Instante de início (UTC). */
  inicio: Date;
  duracaoMin?: number;
  /** E-mails convidados — o Google manda o convite para cada um. */
  convidados?: string[];
}

export type ResultadoDoEvento =
  | { ok: true; eventId: string; htmlLink: string | null }
  | { ok: false; motivo: "nao_configurado" | "auth_falhou" | "api_falhou"; detalhe?: string };

export function agendaConfigurada(): boolean {
  return Boolean(
    env.GOOGLE_CALENDAR_CLIENT_ID &&
      env.GOOGLE_CALENDAR_CLIENT_SECRET &&
      env.GOOGLE_CALENDAR_REFRESH_TOKEN,
  );
}

function fim(evento: EventoDaReuniao): Date {
  return new Date(evento.inicio.getTime() + (evento.duracaoMin ?? DURACAO_PADRAO_MIN) * 60_000);
}

/**
 * Access token do refresh token, com cache em memória.
 *
 * O token do Google dura ~1h e cada agendamento faria uma troca inútil sem
 * este cache. A margem de 60s evita usar um token que expira no voo entre a
 * checagem e a chamada.
 */
let tokenEmCache: { valor: string; expiraEm: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (tokenEmCache && Date.now() < tokenEmCache.expiraEm - 60_000) {
    return tokenEmCache.valor;
  }
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
        client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
        refresh_token: env.GOOGLE_CALENDAR_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      tokenEmCache = null;
      logger.warn("[google-calendar] refresh token recusado", { status: res.status });
      return null;
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    tokenEmCache = {
      valor: body.access_token,
      expiraEm: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  } catch (err) {
    tokenEmCache = null;
    logger.warn("[google-calendar] falha ao trocar refresh token", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Cria o evento na agenda configurada. Nunca lança — o chamador degrada. */
export async function criarEventoNaAgenda(evento: EventoDaReuniao): Promise<ResultadoDoEvento> {
  if (!agendaConfigurada()) return { ok: false, motivo: "nao_configurado" };

  const token = await accessToken();
  if (!token) return { ok: false, motivo: "auth_falhou" };

  const calendarId = env.GOOGLE_CALENDAR_ID || "primary";
  const url =
    `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events` +
    // Convidado só recebe e-mail com sendUpdates=all — sem isso o evento
    // aparece na agenda de quem organiza e ninguém mais fica sabendo.
    `?sendUpdates=${(evento.convidados ?? []).length > 0 ? "all" : "none"}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: evento.titulo,
        description: evento.descricao ?? "",
        start: { dateTime: evento.inicio.toISOString(), timeZone: "America/Bahia" },
        end: { dateTime: fim(evento).toISOString(), timeZone: "America/Bahia" },
        ...(evento.convidados?.length
          ? { attendees: evento.convidados.map((email) => ({ email })) }
          : {}),
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 60 },
            { method: "popup", minutes: 10 },
          ],
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detalhe = (await res.text()).slice(0, 300);
      logger.warn("[google-calendar] criação recusada", { status: res.status, detalhe });
      return { ok: false, motivo: "api_falhou", detalhe: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { id?: string; htmlLink?: string };
    if (!body.id) return { ok: false, motivo: "api_falhou", detalhe: "resposta sem id" };
    return { ok: true, eventId: body.id, htmlLink: body.htmlLink ?? null };
  } catch (err) {
    return {
      ok: false,
      motivo: "api_falhou",
      detalhe: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * O que já está ocupado na agenda entre dois instantes.
 *
 * Serve para o dialog não oferecer um horário que já tem dono. Lê os EVENTOS
 * (não o free/busy) por dois motivos: o escopo autorizado é
 * `calendar.events`, e o id do evento vem junto — é ele que deixa a
 * remarcação de um lead ignorar o próprio compromisso em vez de se declarar
 * ocupada.
 *
 * `singleEvents=true` expande as recorrências: sem isso, uma reunião semanal
 * apareceria uma vez só, na data em que foi criada, e todas as outras semanas
 * pareceriam livres.
 *
 * Devolve `null` quando não dá para saber (integração desligada, token
 * recusado, Google fora do ar) — que é diferente de `[]`. Quem chama precisa
 * distinguir "nada ocupado" de "não consegui perguntar": tratar falha como
 * agenda vazia ofereceria justamente os horários já tomados.
 */
export async function ocupacoesDaAgenda(de: Date, ate: Date): Promise<Ocupacao[] | null> {
  if (!agendaConfigurada()) return null;

  const token = await accessToken();
  if (!token) return null;

  const calendarId = env.GOOGLE_CALENDAR_ID || "primary";
  const params = new URLSearchParams({
    timeMin: de.toISOString(),
    timeMax: ate.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  try {
    const res = await fetch(
      `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) {
      logger.warn("[google-calendar] listagem recusada", { status: res.status });
      return null;
    }
    const body = (await res.json()) as {
      items?: Array<{
        id?: string;
        status?: string;
        transparency?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
    };

    const ocupacoes: Ocupacao[] = [];
    for (const item of body.items ?? []) {
      // Cancelado não ocupa. "transparent" é o evento marcado como "Disponível"
      // no Google — quem o criou disse explicitamente que ele não bloqueia.
      if (item.status === "cancelled") continue;
      if (item.transparency === "transparent") continue;
      // Evento de dia inteiro vem com `date` em vez de `dateTime`. Ignorado de
      // propósito: aniversário e feriado tomariam o dia todo da grade.
      const inicio = item.start?.dateTime;
      const fim = item.end?.dateTime;
      if (!inicio || !fim) continue;
      ocupacoes.push({ inicio, fim, gcalEventId: item.id ?? null });
    }
    return ocupacoes;
  } catch (err) {
    logger.warn("[google-calendar] falha ao listar eventos", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** "20260812T170000Z" — o formato compacto que o link do Google exige. */
function compacto(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Link "adicionar na minha agenda". Puro, sem rede — serve tanto de fallback
 * quanto de atalho para quem quer o evento numa agenda pessoal diferente da
 * que a integração usa.
 */
export function linkParaAdicionarNaAgenda(evento: EventoDaReuniao): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: evento.titulo,
    dates: `${compacto(evento.inicio)}/${compacto(fim(evento))}`,
    ctz: "America/Bahia",
  });
  if (evento.descricao) params.set("details", evento.descricao);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
