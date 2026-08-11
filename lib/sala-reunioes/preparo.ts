/**
 * O preparo da PRÓXIMA reunião — o checklist que responde, de um relance,
 * "o que já foi feito e o que ainda falta" antes de entrar na sala.
 *
 * POR QUE EXISTE: a Sala de Reuniões só mostrava reunião que JÁ ACONTECEU
 * (a transcrição do copiloto). A reunião marcada vive noutro lugar —
 * `crm_leads.custom_fields.reuniao`, escrita pelo agendamento anti no-show — e
 * ninguém via as duas juntas. Quem conduz chegava na R1 sem lembrar se o
 * lembrete saiu, sem reler o gancho e sem ver a nota que o SDR deixou.
 *
 * DUAS NATUREZAS DE ITEM, e a diferença é o ponto:
 *   · **automático** — o sistema SABE (o lembrete saiu? o evento entrou na
 *     agenda?). Não é clicável: marcar à mão um fato que o banco desmente é
 *     transformar o checklist em decoração.
 *   · **manual** — só o humano sabe (li o dossiê? a APN está montada?). Fica
 *     em `reuniao.checklist` (id → ISO da marcação), sem migration, no mesmo
 *     jsonb do resto do agendamento.
 *
 * Módulo PURO (sem I/O) de propósito: a lista das próximas e o painel de
 * preparo desenham o MESMO checklist — a lista só conta quantos faltam. Duas
 * cópias divergiriam no primeiro item novo.
 */
import {
  formatarReuniao,
  HORA_LEMBRETE_VESPERA,
  HORAS_LEMBRETE_FINAL,
  instanteLembreteFinal,
  instanteLembreteVespera,
  type Reuniao,
  type TipoDeReuniao,
} from "@/lib/agendamento/reuniao";
import { ddmm, diasCivisEntre, hhmm } from "@/lib/tarefas/tarefa";

export type OrigemDoItem = "automatico" | "manual";

export interface ItemDoChecklist {
  /** Estável — é a chave gravada em `reuniao.checklist` e o `key` da lista. */
  id: string;
  rotulo: string;
  /** Linha de apoio: quando saiu, quando sai, ou por que não vai sair. */
  detalhe: string | null;
  feito: boolean;
  origem: OrigemDoItem;
}

interface ItemManual {
  id: string;
  rotulo: string;
  /** Em que tipo de reunião o item faz sentido. */
  tipos: readonly TipoDeReuniao[];
  detalhe: string | null;
}

const TODOS_OS_TIPOS = ["raio-x", "r1", "r2"] as const satisfies readonly TipoDeReuniao[];

/**
 * Os itens que só o humano sabe responder.
 *
 * A lista é curta de propósito. Checklist de vinte linhas não é lido — vira
 * uma parede que a pessoa marca toda de uma vez para tirar da frente, e aí ele
 * deixa de informar qualquer coisa. Cada item aqui é uma coisa que, faltando,
 * estraga a reunião.
 */
export const ITENS_MANUAIS: readonly ItemManual[] = [
  {
    id: "dossie",
    rotulo: "Reli o dossiê e o gancho do lead",
    tipos: TODOS_OS_TIPOS,
    detalhe: "Dores, cidade, site, o que a prospecção levantou",
  },
  {
    id: "agenda",
    rotulo: "A reunião está na minha agenda",
    tipos: TODOS_OS_TIPOS,
    detalhe: null,
  },
  {
    id: "link_meet",
    rotulo: "Link do Meet criado e enviado ao lead",
    tipos: TODOS_OS_TIPOS,
    detalhe: null,
  },
  {
    id: "copiloto",
    rotulo: "Copiloto ligado no Chrome (legendas em pt-BR)",
    tipos: TODOS_OS_TIPOS,
    detalhe: "Sem legenda ligada, a reunião não é gravada nem analisada",
  },
  {
    id: "demo",
    rotulo: "Demo ou entregável pronto para mostrar",
    tipos: ["raio-x", "r1"],
    detalhe: null,
  },
  {
    id: "apn",
    rotulo: "APN montada com as dores desta R1",
    tipos: ["r2"],
    detalhe: "A proposta sobe na ordem de prioridade que o cliente deu",
  },
  {
    id: "investimento",
    rotulo: "Tier de investimento definido (um só)",
    tipos: ["r2"],
    detalhe: null,
  },
];

/** "11/08 às 15:29" — carimbo curto, do jeito que se fala. */
function carimbo(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${ddmm(d)} às ${hhmm(d)}`;
}

/**
 * O checklist inteiro desta reunião, automáticos primeiro.
 *
 * `agora` entra por parâmetro (mesma regra de lib/tarefas/tarefa.ts): a tela
 * congela o instante e dois itens nunca caem em lados opostos da virada do dia.
 */
export function montarChecklist(reuniao: Reuniao, agora: Date): ItemDoChecklist[] {
  const quando = new Date(reuniao.em);
  const passou = quando.getTime() <= agora.getTime();
  const avisos = reuniao.avisos ?? {};
  const marcados = reuniao.checklist ?? {};

  const vesperaEm = instanteLembreteVespera(quando);
  const finalEm = instanteLembreteFinal(quando);

  /** O lembrete que nunca vai sair: nasceu com a hora vencida (mesma guarda do cron). */
  const nasceuVencido = (instante: Date) => {
    const criada = Date.parse(reuniao.criada_em);
    return !Number.isNaN(criada) && instante.getTime() < criada;
  };

  const automaticos: ItemDoChecklist[] = [
    {
      id: "convite",
      rotulo: "Convite enviado no WhatsApp",
      feito: Boolean(avisos.confirmacao),
      detalhe: avisos.confirmacao
        ? `saiu ${carimbo(avisos.confirmacao) ?? "—"}`
        : "não consta — confira a conversa antes de contar com ele",
      origem: "automatico",
    },
    {
      id: "lembrete_vespera",
      rotulo: "Lembrete da véspera",
      feito: Boolean(avisos.vespera),
      detalhe: avisos.vespera
        ? `saiu ${carimbo(avisos.vespera) ?? "—"}`
        : nasceuVencido(vesperaEm)
          ? "não sai: a reunião foi marcada depois da hora dele"
          : `sai ${ddmm(vesperaEm)} às ${HORA_LEMBRETE_VESPERA}h`,
      origem: "automatico",
    },
    {
      id: "lembrete_final",
      rotulo: `Toque ${HORAS_LEMBRETE_FINAL}h antes`,
      feito: Boolean(avisos.final),
      detalhe: avisos.final
        ? `saiu ${carimbo(avisos.final) ?? "—"}`
        : passou
          ? "a hora da reunião já passou"
          : `sai ${ddmm(finalEm)} às ${hhmm(finalEm)}`,
      origem: "automatico",
    },
  ];

  const manuais: ItemDoChecklist[] = ITENS_MANUAIS.filter((i) =>
    i.tipos.includes(reuniao.tipo),
  ).map((item) => {
    // O Google Agenda, quando está ligado, responde sozinho — e aí o item para
    // de ser clicável. Sem a integração (o caso de hoje), volta a ser uma
    // pergunta que só o Mario responde.
    const automatizado = item.id === "agenda" && Boolean(reuniao.gcal_event_id);
    const marcadoEm = marcados[item.id];
    return {
      id: item.id,
      rotulo: item.rotulo,
      feito: automatizado || Boolean(marcadoEm),
      detalhe: automatizado
        ? "evento criado no Google Agenda"
        : marcadoEm
          ? `marcado ${carimbo(marcadoEm) ?? "—"}`
          : item.detalhe,
      origem: automatizado ? "automatico" : "manual",
    };
  });

  return [...automaticos, ...manuais];
}

export interface ResumoDoChecklist {
  feitos: number;
  total: number;
  faltam: number;
}

export function resumoDoChecklist(itens: ItemDoChecklist[]): ResumoDoChecklist {
  const feitos = itens.filter((i) => i.feito).length;
  return { feitos, total: itens.length, faltam: itens.length - feitos };
}

/** Um item manual existe? Gate da rota que grava — id inventado não entra no jsonb. */
export function ehItemManual(id: string, tipo: TipoDeReuniao): boolean {
  return ITENS_MANUAIS.some((i) => i.id === id && i.tipos.includes(tipo));
}

/**
 * Quando a reunião é, em linguagem de gente: "hoje às 14h", "amanhã às 10h",
 * "quinta-feira (14/08) às 16h".
 */
export function quandoDaReuniao(reuniao: Reuniao, agora: Date): string {
  const quando = new Date(reuniao.em);
  if (Number.isNaN(quando.getTime())) return "—";
  const f = formatarReuniao(quando);
  const dias = diasCivisEntre(agora, quando);
  if (dias === 0) return `hoje às ${f.hora}`;
  if (dias === 1) return `amanhã às ${f.hora}`;
  if (dias === -1) return `ontem às ${f.hora}`;
  return `${f.diaDaSemana} (${f.diaMes}) às ${f.hora}`;
}

/**
 * Está acontecendo agora? Da hora marcada até 90 min depois.
 *
 * A janela existe porque nada carimba o FIM de uma reunião agendada: sem ela, a
 * reunião das 10h sumiria da lista às 10h01, que é justamente quando ela está
 * na tela de quem entrou atrasado.
 */
const JANELA_ACONTECENDO_MS = 90 * 60 * 1000;

export function estaAcontecendo(reuniao: Reuniao, agora: Date): boolean {
  const quando = new Date(reuniao.em).getTime();
  if (Number.isNaN(quando)) return false;
  return agora.getTime() >= quando && agora.getTime() < quando + JANELA_ACONTECENDO_MS;
}
