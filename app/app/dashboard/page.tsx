import { loadAuthUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "./_components/DashboardClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Painel" };

/**
 * Painel — a tela inicial do CRM.
 *
 * O pipeline é resolvido NO SERVIDOR (o padrão, ou o primeiro por posição) para
 * o cliente já montar com o id em mãos: buscar a lista de pipelines no cliente
 * só para descobrir qual pedir custaria duas idas de rede em série antes de a
 * primeira métrica aparecer.
 */
export default async function DashboardPage() {
  const user = await loadAuthUser();
  const supabase = await createClient();

  const { data: pipelines } = await supabase
    .from("crm_pipelines")
    .select("id, name, is_default")
    .eq("is_archived", false)
    .order("position");

  const list = pipelines ?? [];
  const active = list.find((p) => p.is_default) ?? list[0] ?? null;

  // Só o primeiro nome: "Olá, Mario" é saudação; "Olá, Mario Silva Chegou" é
  // um formulário te chamando pelo nome completo.
  const firstName = user?.full_name?.trim().split(/\s+/)[0] ?? null;

  return (
    <DashboardClient
      pipelineId={active?.id ?? null}
      pipelineName={active?.name ?? null}
      firstName={firstName}
    />
  );
}
