/**
 * Detecta o funil de PROSPECÇÃO do tenant — o alvo da seção "// prospecção" do
 * Painel, que é fixa nele mesmo quando o topo da tela mostra outro funil (o
 * padrão da conta, ex.: "Pedidos").
 *
 * Sinal forte primeiro: um funil que tem etapa `r1-*` E etapa `r2-*` (o funil
 * NEXO de prospecção tem `r1-agendada`/`r2-agendada`) é de prospecção por
 * construção — nome nenhum precisa dizer isso. Só na ausência disso vale o
 * nome/slug com "prospec". Nada casou ⇒ null, e a seção NÃO renderiza: uma
 * área de prospecção apontando para o funil errado é pior que ausente.
 */

export interface PipelineCandidate {
  id: string;
  name: string;
  slug: string | null;
  position: number;
}

export interface StageSlugRow {
  pipeline_id: string;
  slug: string | null;
}

export function detectProspectingPipeline(
  pipelines: PipelineCandidate[],
  stages: StageSlugRow[],
): { id: string; name: string } | null {
  const byPosition = [...pipelines].sort((a, b) => a.position - b.position);

  const slugsOf = (pipelineId: string): string[] =>
    stages
      .filter((s) => s.pipeline_id === pipelineId && s.slug !== null)
      .map((s) => s.slug as string);

  const withMeetings = byPosition.find((p) => {
    const slugs = slugsOf(p.id);
    return slugs.some((s) => /^r1-/.test(s)) && slugs.some((s) => /^r2-/.test(s));
  });
  if (withMeetings) return { id: withMeetings.id, name: withMeetings.name };

  const byName = byPosition.find(
    (p) => /prospec/i.test(p.name) || (p.slug !== null && /prospec/i.test(p.slug)),
  );
  if (byName) return { id: byName.id, name: byName.name };

  return null;
}
