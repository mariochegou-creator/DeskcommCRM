import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { DisparosClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Disparos (0108) — campanha de mensagem em massa pelo WhatsApp.
 *
 * manager+, como as rotas por trás: disparo não é leitura, é a operação que pode
 * queimar o número da empresa. A página só evita levar quem seria recusado até
 * um 403 — quem recusa de verdade é `requireRole` em cada rota.
 *
 * A lista NÃO é lida aqui no servidor: uma campanha em andamento muda a cada
 * minuto por fora (o worker do cron), e a leitura do servidor nasceria velha.
 * Quem mantém a tela viva é o polling do React Query em `useDisparos`.
 */
export default async function DisparosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Disparos</h1>
        <p className="text-sm text-muted-foreground">
          Manda a mesma mensagem para um grupo de leads — por funil, etapa, tag ou nicho da
          importação. Sai pelo seu WhatsApp, com o seu nome, uma mensagem a cada 5 segundos.
        </p>
      </header>
      <DisparosClient />
    </div>
  );
}
