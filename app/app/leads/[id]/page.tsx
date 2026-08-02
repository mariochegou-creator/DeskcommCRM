import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { LeadDetailClient } from "./_components/LeadDetailClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Negócio" };

/**
 * Detalhe do negócio.
 *
 * A leitura inicial é no SERVIDOR (RLS já filtra por organização) só para
 * descobrir a que pipeline o negócio pertence; o cliente então assina o board
 * daquele pipeline e passa a ler dali. Assim esta tela e a lista compartilham
 * o mesmo cache do React Query: mudar a etapa aqui atualiza a lista atrás sem
 * nova ida de rede, e o realtime do board vale para as duas.
 */
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id")
    .eq("id", id)
    .maybeSingle();

  if (!lead) notFound();

  return <LeadDetailClient leadId={lead.id} pipelineId={lead.pipeline_id} />;
}
