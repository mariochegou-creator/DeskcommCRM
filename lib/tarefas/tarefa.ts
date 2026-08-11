/**
 * Tarefas do time presas ao lead — o que sucede o "Lembrar" do inbox.
 *
 * O botão do relógio adiava a CONVERSA (snooze: some da fila e volta depois).
 * Isso resolve "me lembra dessa conversa" e não resolve o caso que aparece
 * toda vez que uma reunião é marcada: *ligar 5h antes*, *ligar 2h antes*,
 * *deixar uma nota pro closer ler antes de entrar*. Essas três coisas têm
 * DONO (às vezes outro), TEXTO (a informação que se passa) e PRAZO com HORA —
 * nada disso cabe em adiar uma conversa.
 *
 * Módulo PURO (sem I/O): o dialog do inbox, a aba de Tarefas, a rota que grava
 * e o Painel precisam da mesma aritmética de prazo, e quatro cópias divergiriam
 * na primeira mudança. Fuso America/Bahia com offset FIXO −03:00, pelo mesmo
 * motivo de lib/plan/dates.ts e lib/agendamento/reuniao.ts (sem horário de
 * verão desde 2019; se voltar, os três arquivos mudam juntos).
 *
 * `now` sempre entra por parâmetro: quem renderiza congela o instante, e dois
 * prazos da mesma tela nunca caem em lados opostos da virada do dia.
 */

/** UTC = hora civil da Bahia + 3h. */
const BAHIA_OFFSET_MS = 3 * 60 * 60 * 1000;
const MINUTO_MS = 60 * 1000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

/**
 * O que se faz. É a mesma pergunta do CHECK `crm_tasks_kind_check` (0101) —
 * este símbolo é o par TypeScript dele no invariante de vocabulário.
 */
export type TipoDeTarefa = "ligar" | "mensagem" | "nota" | "reuniao" | "outro";

export const TIPOS_DE_TAREFA: readonly TipoDeTarefa[] = [
  "ligar",
  "mensagem",
  "nota",
  "reuniao",
  "outro",
] as const;

export const ROTULO_DO_TIPO: Record<TipoDeTarefa, string> = {
  ligar: "Ligar",
  mensagem: "Mandar mensagem",
  nota: "Anotar / avisar",
  reuniao: "Preparar reunião",
  outro: "Outro",
};

/** Par TypeScript do CHECK `crm_tasks_status_check`. */
export type StatusDaTarefa = "pending" | "done" | "canceled";

export const ROTULO_DO_STATUS: Record<StatusDaTarefa, string> = {
  pending: "Pendente",
  done: "Feita",
  canceled: "Cancelada",
};

/** Teto do título e da nota — o mesmo do zod e do CHECK, para não divergirem. */
export const MAX_TITULO = 200;
export const MAX_NOTA = 2000;

export function ehTipoDeTarefa(v: unknown): v is TipoDeTarefa {
  return typeof v === "string" && (TIPOS_DE_TAREFA as readonly string[]).includes(v);
}

/** A data civil (Bahia) de um instante, já quebrada em partes. */
function civil(d: Date) {
  const s = new Date(d.getTime() - BAHIA_OFFSET_MS);
  return {
    y: s.getUTCFullYear(),
    m: s.getUTCMonth(),
    d: s.getUTCDate(),
    h: s.getUTCHours(),
    min: s.getUTCMinutes(),
    dow: s.getUTCDay(),
  };
}

/** Instante UTC de uma hora civil da Bahia. */
function instanteCivil(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m, d, h, min) + BAHIA_OFFSET_MS);
}

/** Mesmo dia civil da Bahia? */
export function mesmoDia(a: Date, b: Date): boolean {
  const ca = civil(a);
  const cb = civil(b);
  return ca.y === cb.y && ca.m === cb.m && ca.d === cb.d;
}

/** Dias civis de `a` até `b` (0 = mesmo dia, 1 = amanhã, −1 = ontem). */
export function diasCivisEntre(a: Date, b: Date): number {
  const ca = civil(a);
  const cb = civil(b);
  return Math.round((Date.UTC(cb.y, cb.m, cb.d) - Date.UTC(ca.y, ca.m, ca.d)) / DIA_MS);
}

const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** "14:30" (hora civil da Bahia). */
export function hhmm(d: Date): string {
  const c = civil(d);
  return `${String(c.h).padStart(2, "0")}:${String(c.min).padStart(2, "0")}`;
}

/** "12/08" (data civil da Bahia). */
export function ddmm(d: Date): string {
  const c = civil(d);
  return `${String(c.d).padStart(2, "0")}/${String(c.m + 1).padStart(2, "0")}`;
}

export type EstadoDoPrazo = "atrasada" | "agora" | "hoje" | "futura";

/**
 * Em que pé está o prazo.
 *
 * "agora" é a faixa dos 15 minutos que antecedem o vencimento: ela existe
 * porque tarefa de ligação vira ação ANTES da hora cheia — quem só é avisado
 * ao vencer já está atrasado quando o telefone toca.
 */
export function estadoDoPrazo(prazo: Date, agora: Date): EstadoDoPrazo {
  const delta = prazo.getTime() - agora.getTime();
  if (delta <= 0) return "atrasada";
  if (delta <= 15 * MINUTO_MS) return "agora";
  return mesmoDia(prazo, agora) ? "hoje" : "futura";
}

/**
 * O prazo em linguagem de gente: "atrasada · ontem 14:00", "hoje 16:30",
 * "amanhã 09:00", "qua 13/08 10:00".
 */
export function formatarPrazo(prazo: Date, agora: Date): string {
  const dias = diasCivisEntre(agora, prazo);
  const hora = hhmm(prazo);
  const quando =
    dias === 0
      ? `hoje ${hora}`
      : dias === 1
        ? `amanhã ${hora}`
        : dias === -1
          ? `ontem ${hora}`
          : `${DIA_CURTO[civil(prazo).dow]} ${ddmm(prazo)} ${hora}`;
  return prazo.getTime() <= agora.getTime() ? `atrasada · ${quando}` : quando;
}

/** Título que o dialog já deixa escrito — ninguém deve ter que digitar o óbvio. */
export function tituloSugerido(tipo: TipoDeTarefa, nome: string | null): string {
  const quem = (nome ?? "").trim();
  const alvo = quem.length > 0 ? quem : "o lead";
  switch (tipo) {
    case "ligar":
      return `Ligar para ${alvo}`;
    case "mensagem":
      return `Mandar mensagem para ${alvo}`;
    case "nota":
      return `Passar informação sobre ${alvo}`;
    case "reuniao":
      return `Preparar a reunião com ${alvo}`;
    case "outro":
      return "";
  }
}

export interface AtalhoDePrazo {
  /** Estável — serve de `key` e de valor do grupo de botões. */
  id: string;
  rotulo: string;
  /** Quando a tarefa vence. */
  em: Date;
  /** Atalhos de reunião ganham destaque próprio na tela. */
  daReuniao: boolean;
}

/**
 * Atalhos GENÉRICOS de prazo — os que valem sem reunião marcada.
 *
 * "hoje 18h" só entra enquanto for futuro: atalho que nasce no passado é a
 * armadilha silenciosa desta tela (clicar cria uma tarefa já atrasada, e a
 * pessoa não olha o horário porque acabou de escolher pelo rótulo).
 */
function atalhosGenericos(agora: Date): AtalhoDePrazo[] {
  const c = civil(agora);
  const lista: AtalhoDePrazo[] = [
    { id: "1h", rotulo: "Em 1 hora", em: new Date(agora.getTime() + HORA_MS), daReuniao: false },
    { id: "3h", rotulo: "Em 3 horas", em: new Date(agora.getTime() + 3 * HORA_MS), daReuniao: false },
  ];
  const hoje18 = instanteCivil(c.y, c.m, c.d, 18);
  if (hoje18.getTime() > agora.getTime() + 10 * MINUTO_MS) {
    lista.push({ id: "hoje18", rotulo: "Hoje 18h", em: hoje18, daReuniao: false });
  }
  lista.push({
    id: "amanha9",
    rotulo: "Amanhã 9h",
    em: instanteCivil(c.y, c.m, c.d + 1, 9),
    daReuniao: false,
  });
  return lista;
}

/** As antecedências oferecidas quando o lead TEM reunião marcada. */
const ANTES_DA_REUNIAO: Array<{ id: string; rotulo: string; ms: number }> = [
  { id: "r-1d", rotulo: "1 dia antes", ms: DIA_MS },
  { id: "r-5h", rotulo: "5h antes", ms: 5 * HORA_MS },
  { id: "r-2h", rotulo: "2h antes", ms: 2 * HORA_MS },
  { id: "r-30m", rotulo: "30 min antes", ms: 30 * MINUTO_MS },
];

/**
 * Os atalhos que a tela oferece.
 *
 * Com reunião marcada, as antecedências vêm PRIMEIRO e são o motivo desta
 * tela existir: "acabei de marcar a R1 — quero ligar 5h antes e 2h antes".
 * Antecedência que já passou não é oferecida (mesma regra do "hoje 18h"), e a
 * reunião que já aconteceu não gera atalho nenhum.
 */
export function atalhosDePrazo(agora: Date, reuniaoEm?: Date | null): AtalhoDePrazo[] {
  const genericos = atalhosGenericos(agora);
  if (!reuniaoEm || Number.isNaN(reuniaoEm.getTime())) return genericos;
  if (reuniaoEm.getTime() <= agora.getTime()) return genericos;

  const daReuniao = ANTES_DA_REUNIAO.map((a) => ({
    id: a.id,
    rotulo: `${a.rotulo} (${ddmm(new Date(reuniaoEm.getTime() - a.ms))} ${hhmm(new Date(reuniaoEm.getTime() - a.ms))})`,
    em: new Date(reuniaoEm.getTime() - a.ms),
    daReuniao: true,
  })).filter((a) => a.em.getTime() > agora.getTime() + MINUTO_MS);

  return [...daReuniao, ...genericos];
}

/**
 * Ponte com o `<input type="datetime-local">`, que fala hora LOCAL DO NAVEGADOR
 * e nós falamos hora civil da Bahia.
 *
 * Tratar o valor do input como hora da Bahia (e não como hora do navegador) é
 * decisão, não descuido: o time inteiro opera no fuso da Bahia, e um closer
 * viajando com o notebook noutro fuso marcaria "14:00" querendo dizer 14h DA
 * OPERAÇÃO. O resto do CRM (lembretes de reunião, bom-dia) já pensa assim.
 */
export function inputLocalParaInstante(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m as unknown as [string, string, string, string, string, string];
  const dt = instanteCivil(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** O inverso: instante → "2026-08-12T14:00" na hora civil da Bahia. */
export function instanteParaInputLocal(d: Date): string {
  const c = civil(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${c.y}-${p(c.m + 1)}-${p(c.d)}T${p(c.h)}:${p(c.min)}`;
}

export interface TarefaOrdenavel {
  status: StatusDaTarefa;
  due_at: string;
}

/**
 * A ordem da lista: o que está pendente e vencendo primeiro, resolvido por
 * último. Dentro de cada grupo, prazo crescente — a próxima coisa a fazer fica
 * no topo, que é a única pergunta que uma lista de tarefas precisa responder.
 */
export function compararTarefas(a: TarefaOrdenavel, b: TarefaOrdenavel): number {
  const posto = (t: TarefaOrdenavel) => (t.status === "pending" ? 0 : 1);
  if (posto(a) !== posto(b)) return posto(a) - posto(b);
  const ta = Date.parse(a.due_at);
  const tb = Date.parse(b.due_at);
  return posto(a) === 0 ? ta - tb : tb - ta;
}
