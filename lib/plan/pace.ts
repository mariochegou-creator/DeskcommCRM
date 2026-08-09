/**
 * Extrai do payload de fn_prospecting_metrics os DOIS números do plano de 60
 * dias: aberturas (entradas na 1ª etapa do funil) e aceites de raio-x.
 *
 * A etapa de raio-x é procurada por /raio.?x/ no slug/nome (o funil NEXO tem
 * "Raio-x marcado") e, na ausência dela, cai para a etapa r1-* — mesma regra da
 * ProspectingSection, comentário cruzado lá. Nada casou ⇒ `xrayStage: null` e o
 * consumidor mostra "—" em vez de um número adivinhado.
 *
 * Interface estrutural de propósito: a mesma função serve o hook do Painel
 * (payload da rota) e o cron do resumo (payload da RPC direto), sem importar de
 * hooks/ nem de app/.
 */

export interface PaceFunnelStage {
  slug: string | null;
  name: string;
  position: number;
  is_lost: boolean;
  entered: number;
  entered_prev: number | null;
}

export interface PlanPaceNumbers {
  openings: number;
  openingsPrev: number | null;
  xray: number;
  /** Qual etapa forneceu o número de raio-x (honestidade do hint). */
  xrayStage: "raiox" | "r1" | null;
}

const XRAY_SLUG = /raio.?x/i;
const R1_SLUG = /^r1[-_]/;
const R1_NAME = /^r1\b/i;

export function pickPlanNumbers(funnel: PaceFunnelStage[]): PlanPaceNumbers {
  const flow = [...funnel].sort((a, b) => a.position - b.position).filter((s) => !s.is_lost);

  const entry = flow[0] ?? null;

  const raiox =
    flow.find((s) => s.slug !== null && XRAY_SLUG.test(s.slug)) ??
    flow.find((s) => XRAY_SLUG.test(s.name)) ??
    null;
  const r1 =
    flow.find((s) => s.slug !== null && R1_SLUG.test(s.slug)) ??
    flow.find((s) => R1_NAME.test(s.name)) ??
    null;

  const xrayStageRow = raiox ?? r1;

  return {
    openings: entry?.entered ?? 0,
    openingsPrev: entry?.entered_prev ?? null,
    xray: xrayStageRow?.entered ?? 0,
    xrayStage: raiox ? "raiox" : r1 ? "r1" : null,
  };
}
