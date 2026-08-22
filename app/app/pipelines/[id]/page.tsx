import { notFound, redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PipelinePageClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id, name, vocabulary")
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) notFound();

  // A lista inteira vem junto com o quadro: é ela que alimenta o seletor do
  // topo, e é o que troca de funil sem passar por uma tela intermediária.
  const { data: funis } = await supabase
    .from("crm_pipelines")
    .select("id, name, is_default")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");

  return (
    <PipelinePageClient
      pipelineId={id}
      initialName={pipeline.name}
      funis={funis ?? []}
    />
  );
}
