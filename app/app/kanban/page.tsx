import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * "Kanban" no menu abre O QUADRO, não a lista de funis.
 *
 * A lista era uma tela inteira só para escolher — um clique a mais em toda
 * abertura, e quase sempre no mesmo funil. Quem precisa de outro funil troca
 * pelo seletor no topo do próprio quadro; quem precisa administrar (criar,
 * excluir) continua em /app/kanban/funis.
 */
export default async function KanbanPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data: pipelines } = await supabase
    .from("crm_pipelines")
    .select("id, is_default")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");

  const lista = pipelines ?? [];
  // O padrão é o principal; sem nenhum marcado, o primeiro da ordem é o que a
  // lista mostrava no topo — o mesmo funil que o dedo já ia clicar.
  const alvo = lista.find((p) => p.is_default) ?? lista[0];

  // Sem funil nenhum, a lista é quem sabe explicar o vazio.
  redirect(alvo ? `/app/pipelines/${alvo.id}` : "/app/kanban/funis");
}
