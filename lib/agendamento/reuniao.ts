/**
 * Agendamento de reunião (raio-x / R1 / R2) preso ao card do Kanban.
 *
 * Existe para atacar o NO-SHOW: a reunião marcada só vira reunião acontecida
 * quando o lead recebe (a) a confirmação no ato, (b) o lembrete da véspera e
 * (c) o toque de poucas horas antes. Os três dependem de UMA informação que o
 * CRM não tinha: o instante da reunião.
 *
 * Onde mora: `crm_leads.custom_fields.reuniao` — jsonb, sem migration. Mesma
 * escolha dos ganchos de prospecção (lib/leads/ganchos.ts): campo novo de
 * negócio entra por custom_fields até provar que merece coluna.
 *
 * Módulo PURO (sem I/O) de propósito: o dialog do board, a rota que grava e o
 * cron que varre precisam da mesma aritmética, e três cópias divergiriam na
 * primeira mudança de horário. O fuso é o mesmo de lib/plan/dates.ts —
 * America/Bahia, offset fixo −03:00 (sem horário de verão desde 2019).
 */

/** UTC = hora civil da Bahia + 3h. */
const BAHIA_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Hora civil (Bahia) em que o lembrete da véspera sai. */
export const HORA_LEMBRETE_VESPERA = 18;
/** Antecedência do último toque, em horas. */
export const HORAS_LEMBRETE_FINAL = 1;
/** Antecedência do aviso INTERNO (pro closer, não pro lead), em minutos. */
export const MINUTOS_LEMBRETE_EQUIPE = 30;

/**
 * O expediente de reuniões: de hora em hora, das 10h às 18h (decisão do Mario
 * em 17/08/2026, que substituiu os 3 slots fixos de 09/08 — 10h/14h/16h davam
 * três reuniões por dia num dia que comporta nove).
 *
 * O dialog oferece estes com um clique e ainda aceita horário livre no campo
 * de hora: a grade é a regra da operação, não uma trava do código.
 */
export const SLOTS_DA_AGENDA = [
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
] as const;

/**
 * Quanto tempo cada reunião ocupa. A call é de 20 min e o bloco reserva 30.
 *
 * Mora aqui, e não em `google-calendar.ts`, porque quem calcula colisão de
 * horário precisa dela e aquele arquivo lê `env` (não roda no cliente). Lá o
 * símbolo continua existindo, importado daqui — uma duração só, ou o slot
 * exibido como livre não seria o mesmo bloco criado na agenda.
 */
export const DURACAO_DA_REUNIAO_MIN = 30;

/** Um pedaço de tempo já comprometido. Instantes ISO UTC. */
export interface Ocupacao {
  inicio: string;
  fim: string;
  /** Id do evento no Google, quando veio de lá. Serve para ignorar o próprio. */
  gcalEventId?: string | null;
}

/**
 * Quais slots do dia colidem com algo já marcado.
 *
 * Colisão é SOBREPOSIÇÃO, não igualdade de horário: uma reunião às 10h30
 * (marcada no campo livre) derruba o slot das 10h, e um compromisso de duas
 * horas na agenda do Google derruba os dois slots que ele cobre. Comparar só
 * "mesma hora cheia" deixaria passar exatamente esses dois casos.
 *
 * Puro: o dialog desenha e a rota calcula com a mesma regra.
 */
export function slotsOcupados(data: string, ocupacoes: Ocupacao[]): string[] {
  const bloqueados: string[] = [];
  for (const slot of SLOTS_DA_AGENDA) {
    const inicio = instanteDaReuniao(data, slot).getTime();
    if (Number.isNaN(inicio)) continue;
    const fim = inicio + DURACAO_DA_REUNIAO_MIN * 60_000;
    const colide = ocupacoes.some((o) => {
      const oi = Date.parse(o.inicio);
      const of = Date.parse(o.fim);
      if (Number.isNaN(oi) || Number.isNaN(of)) return false;
      return oi < fim && of > inicio;
    });
    if (colide) bloqueados.push(slot);
  }
  return bloqueados;
}

/**
 * A página pública de agendamento do Google (Appointment Schedules) da NEXO.
 *
 * Serve só de ATALHO no dialog ("ver minha agenda", em outra aba) — quem marca
 * a reunião é o CRM, não ela. Tentou-se o contrário em 17/08/2026, com esta
 * página embutida num iframe: dá para marcar, mas o Google **não devolve** ao
 * CRM o dia, a hora nem o e-mail digitados (outro domínio, sem canal de volta),
 * e sem a hora aqui dentro não há confirmação no WhatsApp nem os lembretes que
 * derrubam o no-show. O caminho ficou sendo CRM → Google
 * (`google-calendar.ts`), nunca Google → CRM.
 *
 * Para trocar o link: cole aqui a URL LONGA (a curta calendar.app.google
 * redireciona). Abra a curta no navegador e copie o endereço final.
 */
export const AGENDA_PUBLICA_URL =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ31z5vYZqwgmpn1ok6ovC6N6kQ91FLzhB3Lb1kTdGdfsWwcuzx8jodeAANubignlU2iKN0Kl4B7";

export type TipoDeReuniao = "raio-x" | "r1" | "r2";

export const ROTULO_DO_TIPO: Record<TipoDeReuniao, string> = {
  "raio-x": "raio-x",
  r1: "R1",
  r2: "R2",
};

/** Quais lembretes já saíram. Carimbo ISO do envio; ausente = ainda não saiu. */
export interface AvisosDaReuniao {
  /**
   * A confirmação que sai NO ATO de marcar (a rota `POST .../meeting`), não o
   * cron. Carimbada só quando o WhatsApp aceitou: é o que deixa o preparo da
   * Sala de Reuniões dizer "o convite saiu" sem adivinhar. Reunião marcada
   * antes de 11/08/2026 não tem este carimbo — ausência ali significa "não
   * consta", não "não saiu".
   */
  confirmacao?: string;
  vespera?: string;
  final?: string;
  /**
   * O aviso de 30 min antes que vai pro TIME (Mario/David), não pro lead —
   * pedido do Mario em 19/08/2026. Mesmo objeto `avisos` de propósito: um
   * carimbo por reunião, apagado junto quando a reunião é remarcada.
   */
  equipe?: string;
}

/** O que fica gravado em `custom_fields.reuniao`. */
export interface Reuniao {
  tipo: TipoDeReuniao;
  /** Instante da reunião em ISO UTC (`toISOString`) — sempre com Z. */
  em: string;
  /** Data civil escolhida (YYYY-MM-DD, Bahia) — o que o humano viu na tela. */
  data: string;
  /** Hora civil escolhida (HH:MM, Bahia). */
  hora: string;
  /** Quando o agendamento foi criado (ISO UTC). */
  criada_em: string;
  criada_por?: string | null;
  avisos?: AvisosDaReuniao;
  /** Evento criado no Google Agenda, quando a integração está ligada. */
  gcal_event_id?: string | null;
  gcal_link?: string | null;
  /**
   * Os itens do preparo marcados à mão na Sala de Reuniões — `id → ISO de
   * quando foi marcado`. Quem define os ids é `lib/sala-reunioes/preparo.ts`;
   * aqui é só armazenamento, para o cron não precisar conhecer a lista.
   */
  checklist?: Record<string, string>;
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function dataValida(data: string): boolean {
  return DATA_RE.test(data);
}

export function horaValida(hora: string): boolean {
  return HORA_RE.test(hora);
}

/**
 * O instante UTC de uma data+hora civis da Bahia.
 * `instanteDaReuniao("2026-08-12", "14:00")` → 2026-08-12T17:00:00.000Z.
 */
export function instanteDaReuniao(data: string, hora: string): Date {
  const [y, m, d] = data.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hora.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh, mm) + BAHIA_OFFSET_MS);
}

/**
 * 18h (Bahia) do dia civil ANTERIOR ao da reunião.
 *
 * É o dia anterior CIVIL, não "reunião menos 24h": reunião às 10h com regra de
 * −24h cairia às 10h da véspera, longe do fim do expediente em que o dono do
 * negócio olha o WhatsApp e organiza o dia seguinte.
 */
export function instanteLembreteVespera(reuniao: Date): Date {
  const civil = new Date(reuniao.getTime() - BAHIA_OFFSET_MS);
  return new Date(
    Date.UTC(
      civil.getUTCFullYear(),
      civil.getUTCMonth(),
      civil.getUTCDate(),
      HORA_LEMBRETE_VESPERA,
    ) +
      BAHIA_OFFSET_MS -
      DAY_MS,
  );
}

/** Uma hora antes da reunião. */
export function instanteLembreteFinal(reuniao: Date): Date {
  return new Date(reuniao.getTime() - HORAS_LEMBRETE_FINAL * HOUR_MS);
}

/** Meia hora antes da reunião — o aviso interno pro closer. */
export function instanteLembreteEquipe(reuniao: Date): Date {
  return new Date(reuniao.getTime() - MINUTOS_LEMBRETE_EQUIPE * 60_000);
}

const DIAS_DA_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

export interface ReuniaoFormatada {
  /** "quarta-feira" */
  diaDaSemana: string;
  /** "12/08" */
  diaMes: string;
  /** "14h" ou "14h30" — como se fala, não como se digita. */
  hora: string;
}

/** Como a reunião aparece no texto que o lead recebe. */
export function formatarReuniao(reuniao: Date): ReuniaoFormatada {
  const civil = new Date(reuniao.getTime() - BAHIA_OFFSET_MS);
  const dd = String(civil.getUTCDate()).padStart(2, "0");
  const mm = String(civil.getUTCMonth() + 1).padStart(2, "0");
  const h = civil.getUTCHours();
  const min = civil.getUTCMinutes();
  return {
    diaDaSemana: DIAS_DA_SEMANA[civil.getUTCDay()]!,
    diaMes: `${dd}/${mm}`,
    hora: min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, "0")}`,
  };
}

/** Mesmo dia civil (Bahia)? Usado para o "hoje" do lembrete final. */
export function mesmoDiaCivil(a: Date, b: Date): boolean {
  const ca = new Date(a.getTime() - BAHIA_OFFSET_MS);
  const cb = new Date(b.getTime() - BAHIA_OFFSET_MS);
  return (
    ca.getUTCFullYear() === cb.getUTCFullYear() &&
    ca.getUTCMonth() === cb.getUTCMonth() &&
    ca.getUTCDate() === cb.getUTCDate()
  );
}

/**
 * Lê `custom_fields.reuniao` sem confiar no formato (jsonb → unknown).
 *
 * ⚠️ ESTA FUNÇÃO É A PENEIRA DE QUEM REGRAVA. O cron de lembretes lê com ela e
 * regrava `{ ...reuniao, avisos }` — então campo que ela NÃO copia é campo que
 * o próximo lembrete APAGA em silêncio. Foi por isso que `checklist` entrou
 * aqui junto com o resto: sem esta linha, marcar um item do preparo duraria até
 * as 18h da véspera.
 */
export function lerReuniao(customFields: unknown): Reuniao | null {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return null;
  }
  const raw = (customFields as Record<string, unknown>)["reuniao"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const em = typeof obj.em === "string" ? obj.em : null;
  if (!em || Number.isNaN(Date.parse(em))) return null;
  const tipo = obj.tipo === "r1" || obj.tipo === "r2" || obj.tipo === "raio-x" ? obj.tipo : "r1";
  const avisosRaw = obj.avisos;
  const avisos: AvisosDaReuniao = {};
  if (avisosRaw && typeof avisosRaw === "object" && !Array.isArray(avisosRaw)) {
    const a = avisosRaw as Record<string, unknown>;
    if (typeof a.confirmacao === "string") avisos.confirmacao = a.confirmacao;
    if (typeof a.vespera === "string") avisos.vespera = a.vespera;
    if (typeof a.final === "string") avisos.final = a.final;
    if (typeof a.equipe === "string") avisos.equipe = a.equipe;
  }
  const checklistRaw = obj.checklist;
  const checklist: Record<string, string> = {};
  if (checklistRaw && typeof checklistRaw === "object" && !Array.isArray(checklistRaw)) {
    for (const [chave, valor] of Object.entries(checklistRaw as Record<string, unknown>)) {
      if (typeof valor === "string") checklist[chave] = valor;
    }
  }
  return {
    tipo,
    em,
    data: typeof obj.data === "string" ? obj.data : "",
    hora: typeof obj.hora === "string" ? obj.hora : "",
    criada_em: typeof obj.criada_em === "string" ? obj.criada_em : em,
    criada_por: typeof obj.criada_por === "string" ? obj.criada_por : null,
    avisos,
    gcal_event_id: typeof obj.gcal_event_id === "string" ? obj.gcal_event_id : null,
    gcal_link: typeof obj.gcal_link === "string" ? obj.gcal_link : null,
    checklist,
  };
}

export type Lembrete = "vespera" | "final";

/**
 * Quais lembretes devem sair AGORA para esta reunião.
 *
 * Três guardas, cada uma paga por um jeito diferente de errar:
 *
 * 1. **Nada depois da hora da reunião.** Cron que ficou fora do ar não manda
 *    "te chamo daqui a pouco" para uma conversa que já aconteceu.
 * 2. **Nada antes de existir.** Marcar às 20h uma reunião de amanhã 10h deixa
 *    a véspera (18h de hoje) no passado — mandá-la seria repetir, no mesmo
 *    minuto, a confirmação que acabou de sair.
 * 3. **Atraso máximo.** O lembrete tem hora certa; entregue muito depois vira
 *    ruído (e a véspera atrasada chegaria junto do toque final).
 */
export function lembretesDevidos(
  reuniao: Reuniao,
  now: Date,
  atrasoMaximoMs: number = 3 * HOUR_MS,
): Lembrete[] {
  const quando = new Date(reuniao.em);
  if (Number.isNaN(quando.getTime())) return [];
  if (now.getTime() >= quando.getTime()) return [];

  const criada = Date.parse(reuniao.criada_em);
  const nasceuEm = Number.isNaN(criada) ? 0 : criada;
  const devidos: Lembrete[] = [];

  const candidatos: Array<[Lembrete, Date]> = [
    ["vespera", instanteLembreteVespera(quando)],
    ["final", instanteLembreteFinal(quando)],
  ];

  for (const [nome, instante] of candidatos) {
    if (reuniao.avisos?.[nome]) continue; // já saiu
    if (instante.getTime() < nasceuEm) continue; // nasceu com a hora já vencida
    if (now.getTime() < instante.getTime()) continue; // ainda não é hora
    if (now.getTime() - instante.getTime() > atrasoMaximoMs) continue; // tarde demais
    devidos.push(nome);
  }
  return devidos;
}

/**
 * O aviso interno de 30 min deve sair AGORA? Mesmas guardas de
 * `lembretesDevidos` — inclusive a de nascimento: reunião marcada em cima da
 * hora (faltando menos de 30 min) não gera aviso, quem acabou de marcar sabe.
 * Guarda separada do lead de propósito: este aviso NÃO passa pelo interruptor
 * `ai_dispatch_mode` — desligar a automação cala o que vai pro LEAD, não o
 * cutucão interno.
 */
export function lembreteEquipeDevido(
  reuniao: Reuniao,
  now: Date,
  atrasoMaximoMs: number = 3 * HOUR_MS,
): boolean {
  const quando = new Date(reuniao.em);
  if (Number.isNaN(quando.getTime())) return false;
  if (now.getTime() >= quando.getTime()) return false;

  const criada = Date.parse(reuniao.criada_em);
  const nasceuEm = Number.isNaN(criada) ? 0 : criada;
  const instante = instanteLembreteEquipe(quando);

  if (reuniao.avisos?.equipe) return false;
  if (instante.getTime() < nasceuEm) return false;
  if (now.getTime() < instante.getTime()) return false;
  if (now.getTime() - instante.getTime() > atrasoMaximoMs) return false;
  return true;
}

/**
 * A data civil da Bahia (YYYY-MM-DD) de hoje, ou de N dias à frente.
 *
 * O dialog roda no browser de quem marca, que pode estar em qualquer fuso —
 * `new Date().toISOString().slice(0, 10)` faria o padrão "amanhã" virar "hoje"
 * (ou depois de amanhã) dependendo da hora e da máquina.
 */
export function dataCivilBahia(now: Date, somaDias = 0): string {
  const civil = new Date(now.getTime() - BAHIA_OFFSET_MS + somaDias * DAY_MS);
  const y = civil.getUTCFullYear();
  const m = String(civil.getUTCMonth() + 1).padStart(2, "0");
  const d = String(civil.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Janela de varredura do cron: reuniões que ainda podem gerar lembrete. */
export function janelaDeVarredura(now: Date): { de: string; ate: string } {
  return {
    de: new Date(now.getTime() - HOUR_MS).toISOString(),
    ate: new Date(now.getTime() + 2 * DAY_MS).toISOString(),
  };
}
