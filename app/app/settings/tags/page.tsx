import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { TagsDoClienteClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Tags do cliente (0105) — o catálogo que o Kanban e o inbox usam.
 *
 * manager+, como a página de Funis: mudar o vocabulário de uma organização
 * inteira é configuração de operação. A rota (`/api/v1/client-tags`) recusa o
 * resto no servidor; a página só evita levar quem seria recusado até um 403.
 *
 * A lista NÃO é lida aqui no servidor de propósito, ao contrário da de funis: a
 * mesma query já é a `["client-tags"]` do React Query, montada pela lista do
 * inbox e pelo card do Kanban. Semear a tela por outro caminho criaria duas
 * leituras do mesmo catálogo, e a do servidor ficaria velha assim que alguém
 * criasse uma tag sem recarregar a página.
 */
export default async function TagsSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tags do cliente</h1>
        <p className="text-sm text-muted-foreground">
          A lista que aparece no card do Kanban e na conversa do inbox. A cor escolhida
          aqui é a cor do chip nas duas telas.
        </p>
      </header>
      <TagsDoClienteClient />
    </div>
  );
}
