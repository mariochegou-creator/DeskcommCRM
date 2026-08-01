"use server";

/**
 * Ações do modo demonstração da NEXO IA.
 *
 * A organização vem SEMPRE da sessão validada (requireAuth + resolveActiveOrg),
 * nunca do cliente — é a regra do client admin, que bypassa a RLS.
 *
 * Exige papel `admin`: preencher e apagar dados em lote não é operação de
 * atendente.
 */

import { revalidatePath } from "next/cache";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { limparDemo, semearDemo, type Contagem } from "@/lib/nexo-demo/seed";

export interface Resultado {
  ok: boolean;
  mensagem: string;
  contagem?: Contagem;
}

async function orgDoAdmin(): Promise<{ orgId: string; userId: string } | Resultado> {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);

  if (!org) {
    return { ok: false, mensagem: "Sua conta não está associada a nenhuma organização." };
  }
  if (org.role !== "admin" && !user.is_platform_admin) {
    return { ok: false, mensagem: "Só o admin da organização pode usar o modo demonstração." };
  }
  return { orgId: org.orgId, userId: user.id };
}

export async function acaoPreencher(): Promise<Resultado> {
  const ctx = await orgDoAdmin();
  if ("ok" in ctx) return ctx;

  try {
    const contagem = await semearDemo(ctx.orgId, ctx.userId);
    revalidatePath("/app", "layout");
    return {
      ok: true,
      mensagem: `Pronto. ${contagem.negocios} negócios no funil, ${contagem.contatos} contatos e ${contagem.atividades} registros de histórico.`,
      contagem,
    };
  } catch (e) {
    return {
      ok: false,
      mensagem: e instanceof Error ? e.message : "Falhou por um motivo que não soube identificar.",
    };
  }
}

export async function acaoLimpar(): Promise<Resultado> {
  const ctx = await orgDoAdmin();
  if ("ok" in ctx) return ctx;

  try {
    await limparDemo(ctx.orgId);
    revalidatePath("/app", "layout");
    return {
      ok: true,
      mensagem: "Dados de demonstração apagados. O que você cadastrou à mão continua lá.",
      contagem: { negocios: 0, contatos: 0, conversas: 0, atividades: 0 },
    };
  } catch (e) {
    return {
      ok: false,
      mensagem: e instanceof Error ? e.message : "Falhou por um motivo que não soube identificar.",
    };
  }
}
