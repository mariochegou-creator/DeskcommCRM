import { redirect } from "next/navigation";

import { Kanban } from "@/lib/ui/icons";
import { EmptyPipeline } from "@/components/empty";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { FunisClient, type FunilDaLista } from "./_client";

export const dynamic = "force-dynamic";

export default async function KanbanPickerPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  // Excluir funil é manager+, o mesmo nível das etapas — é configuração de
  // operação. Quem não tem o papel vê a lista sem a lixeira: esconder o que a
  // rota recusaria é honestidade, não permissão nova.
  const podeExcluir =
    user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const supabase = await createClient();
  const { data: pipelines } = await supabase
    .from("crm_pipelines")
    .select("id, name, slug, is_default, description")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");

  const list = (pipelines ?? []) as FunilDaLista[];

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center gap-3">
        <Kanban size={28} className="text-muted-foreground" weight="duotone" />
        <h1 className="text-2xl font-semibold tracking-tight">Funis</h1>
      </header>

      {list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyPipeline
            primary={{ label: "Ir para Configurações", href: "/app/settings" }}
          />
        </div>
      ) : (
        <FunisClient funis={list} podeExcluir={podeExcluir} />
      )}
    </div>
  );
}
