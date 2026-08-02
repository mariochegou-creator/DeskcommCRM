import { createClient } from "@/lib/supabase/server";
import { LeadsClient } from "./_components/LeadsClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Negócios" };

/**
 * Negócios — a visão de TABELA do mesmo funil que o Kanban mostra em colunas.
 *
 * As duas telas leem o mesmo board e escrevem pela mesma rota de mover card, de
 * propósito: são dois recortes do mesmo dado, não dois dados. Quem trabalha por
 * arraste fica no Kanban; quem trabalha por lista, filtro e ordenação fica aqui.
 */
export default async function LeadsPage() {
  const supabase = await createClient();

  const { data: pipelines } = await supabase
    .from("crm_pipelines")
    .select("id, name, is_default")
    .eq("is_archived", false)
    .order("position");

  const list = pipelines ?? [];
  const active = list.find((p) => p.is_default) ?? list[0] ?? null;

  return (
    <LeadsClient
      pipelineId={active?.id ?? null}
      pipelines={list.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}
