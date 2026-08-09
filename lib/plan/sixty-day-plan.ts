/**
 * O plano de 60 dias da NEXO IA (10/08 → 09/10/2026) como CONSTANTE.
 *
 * Só as tarefas PONTUAIS moram no banco (`plan_tasks`, migration 0094). Rotina
 * diária, metas e checkpoints ficam aqui de propósito:
 *  - recorrente não vira checkbox — "fiz as 40 aberturas" é a métrica do funil
 *    quem responde (fn_prospecting_metrics), não uma linha marcável;
 *  - checkpoint é REGRA sobre métrica com data, não tarefa: o go/no-go se lê
 *    nos números, e duplicar a meta no banco criaria duas fontes pro mesmo
 *    número;
 *  - são meia dúzia de valores que só mudam com decisão de negócio — mudança
 *    dessas passa por commit, não por UPDATE.
 *
 * Consumidores: seção "// plano 60 dias" do Painel, o cron plan-morning-brief
 * (resumo de WhatsApp das 8h30) e o seed scripts/seed-plano-60-dias.ts.
 */

export interface PlanPhase {
  n: 0 | 1 | 2 | 3;
  name: string;
  /** Datas CIVIS (America/Bahia), inclusivas, formato YYYY-MM-DD. */
  from: string;
  to: string;
}

export interface PlanCheckpoint {
  slug: string;
  /** Data civil (America/Bahia) YYYY-MM-DD. */
  date: string;
  title: string;
  /** Cabe num hint de StatCard. */
  ruleShort: string;
  /** A regra por extenso, como vai no resumo de WhatsApp e na agenda. */
  rule: string;
  /** Métrica que o painel consegue medir sozinho (null = decisão humana). */
  metric: "xray_accepted" | "contracts" | null;
  target: number | null;
}

export const PLAN_OWNERS = ["mario", "david", "dupla", "claude"] as const;
export type PlanOwner = (typeof PLAN_OWNERS)[number];

export const OWNER_LABEL: Record<PlanOwner, string> = {
  mario: "Mario",
  david: "David",
  dupla: "Dupla",
  claude: "Claude",
};

export const SIXTY_DAY_PLAN = {
  /** Chave do plano em plan_tasks.plan_key — o seed é idempotente por ela. */
  key: "plano-60d-2026",
  label: "Plano 60 dias",
  /** Segunda 10/08/2026. Dias antes disso são a Fase 0 (fim de semana). */
  startDate: "2026-08-10",
  endDate: "2026-10-09",
  phases: [
    { n: 0, name: "Ligar a máquina", from: "2026-08-08", to: "2026-08-09" },
    { n: 1, name: "Teste de nicho", from: "2026-08-10", to: "2026-08-23" },
    { n: 2, name: "Dobrar no vencedor", from: "2026-08-24", to: "2026-09-06" },
    { n: 3, name: "Fechar e virar case", from: "2026-09-07", to: "2026-10-09" },
  ] as PlanPhase[],
  dailyTargets: {
    /** Aberturas novas de WhatsApp por dia útil, na dupla (20 por chip). */
    openings: 40,
    openingsPerChip: 20,
    /** Piso de ligações do David por dia útil (o recorde dele é 90). */
    callsFloorDavid: 40,
  },
  weekTargetOpenings: 200,
  totals: { touches: 800, contractsMin: 2, contractsMax: 3 },
  routine: [
    { window: "9h–12h", what: "Abertura: 40 mensagens novas na dupla (20 por chip) + responder quem chegou" },
    { window: "14h–18h", what: "Ligações (piso 40, David) + raios-x do dia" },
  ],
  checkpoints: [
    {
      slug: "cp-2026-08-21",
      date: "2026-08-21",
      title: "Decisão de nicho",
      ruleShort: "15+ raios-x aceitos ou ajusta abordagem",
      rule: "Fechar o teste POR ESCRITO no metricas.md: nicho continua se aceite de raio-x ≥ o dos antigos ou 3+ aceites no nicho; para se 0–1 aceite e resposta < metade dos antigos.",
      metric: "xray_accepted",
      target: 15,
    },
    {
      slug: "cp-2026-09-04",
      date: "2026-09-04",
      title: "Proposta andando",
      ruleShort: "zero R2 → ajusta gancho/oferta",
      rule: "Nenhuma R2 até aqui? O problema é o gancho ou a oferta — ajustar com o Claude. O nicho NÃO muda fora de checkpoint.",
      metric: null,
      target: null,
    },
    {
      slug: "cp-2026-09-18",
      date: "2026-09-18",
      title: "Primeiro sim",
      ruleShort: "zero contrato → oferta de entrada",
      rule: "Sem contrato fechado, ativar a oferta de entrada (ticket menor, só implantação) pra destravar o primeiro fechamento.",
      metric: null,
      target: null,
    },
    {
      slug: "cp-2026-10-09",
      date: "2026-10-09",
      title: "Revisão final",
      ruleShort: "2–3 contratos · dobrar no nicho",
      rule: "Números na mesa: fechou 1+ vira case e dobra no nicho antes de abrir um terceiro. Definir a meta do próximo ciclo.",
      metric: "contracts",
      target: 2,
    },
  ] as PlanCheckpoint[],
} as const;

export type SixtyDayPlan = typeof SIXTY_DAY_PLAN;
