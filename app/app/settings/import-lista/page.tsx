import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { ImportListaClient } from "./_components/ImportListaClient";

export const dynamic = "force-dynamic";

/**
 * /app/settings/import-lista — sobe a lista de prospecção enriquecida (CSV).
 * Manager+ (mesma régua do card no hub e da rota /api/v1/leads/import).
 */
export default async function ImportListaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Importar lista de prospecção</h1>
        <p className="text-sm text-muted-foreground">
          Suba o CSV que a ferramenta de prospecção gerou. Cada linha vira contato + lead no funil
          escolhido, e os ganchos de abertura ficam salvos para quem for atender.
        </p>
      </header>
      <ImportListaClient />
    </div>
  );
}
