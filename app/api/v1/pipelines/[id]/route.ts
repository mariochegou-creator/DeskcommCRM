/**
 * DELETE /api/v1/pipelines/[id] — tira o funil do Kanban.
 * PATCH  /api/v1/pipelines/[id] — devolve ao Kanban um funil que saiu.
 *
 * ⚠️ EXCLUIR ARQUIVA, NÃO APAGA — e aqui isso é ainda menos negociável do que
 * nas etapas. `crm_leads_pipeline_id_fkey` é `ON DELETE RESTRICT`: funil com
 * negócio não pode ser apagado. E `crm_stages_pipeline_id_fkey` é
 * `ON DELETE CASCADE`: um funil vazio APAGADO levaria as colunas junto, e com
 * elas o `stage_id` para onde o mapeamento do agente aponta. Arquivar tira o
 * funil de todas as listas (todas filtram `is_archived = false`) e deixa o
 * caminho de volta aberto — por isso existe o PATCH, e por isso a tela oferece
 * "Desfazer".
 *
 * ⚠️ O FUNIL PADRÃO PODE SAIR, MAS A ORG NUNCA FICA SEM UM. `is_default` tem
 * índice único parcial por organização (`uniq_crm_pipelines_org_default`) e o
 * quadro lê esse funil para calcular a próxima ação de cada card. Arquivar o
 * padrão sem promover outro deixaria a org com zero — estado silencioso, que
 * só aparece como "a próxima ação sumiu". Por isso: libera o padrão no MESMO
 * update que arquiva, e promove o primeiro funil vivo logo depois.
 *
 * Auth: sessão por cookie, papel manager+ (mesmo nível das etapas — é
 * configuração de operação). `organization_id` sai do JWT, nunca da URL.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface FunilRow {
  id: string;
  name: string;
  is_default: boolean;
  is_archived: boolean;
  position: number;
}

const COLUNAS = "id, name, is_default, is_archived, position";

/**
 * O funil, ou `null` quando não é desta organização.
 *
 * `null` cobre os dois casos de propósito — inexistente e de outro tenant
 * respondem a MESMA coisa (404): dizer "existe, mas não é seu" já vaza a
 * existência.
 */
async function lerFunil(
  supabase: Supabase,
  orgId: string,
  pipelineId: string,
): Promise<FunilRow | null> {
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select(COLUNAS)
    .eq("id", pipelineId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FunilRow | null) ?? null;
}

/** Quantos negócios moram no funil, e quantos ainda estão abertos. */
async function contarNegocios(
  supabase: Supabase,
  orgId: string,
  pipelineId: string,
): Promise<{ total: number; abertos: number }> {
  const base = () =>
    supabase
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId);

  const { count: total, error: errTotal } = await base();
  if (errTotal) throw new Error(errTotal.message);
  const { count: abertos, error: errAbertos } = await base().eq("status", "open");
  if (errAbertos) throw new Error(errAbertos.message);

  return { total: total ?? 0, abertos: abertos ?? 0 };
}

/**
 * Formulários/integrações que jogam lead NESTE funil.
 *
 * Entra na contagem porque é o único jeito de o funil arquivado continuar
 * RECEBENDO negócio depois de sair da tela: o webhook não olha `is_archived`,
 * grava o lead e o lead nasce invisível. A tela avisa antes; bloquear seria
 * pior (o dono da operação não tem como desligar o formulário daqui).
 */
async function contarFormularios(
  supabase: Supabase,
  orgId: string,
  pipelineId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("webhook_sources")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("default_pipeline_id", pipelineId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const { id: pipelineId } = await ctx.params;
  const confirmado = req.nextUrl.searchParams.get("confirmar") === "1";

  const supabase = await createClient();

  let funil: FunilRow | null;
  try {
    funil = await lerFunil(supabase, orgId, pipelineId);
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
  if (!funil) return fail("not_found", "Funil não encontrado.", 404, { requestId });

  // Aba aberta antes de outra pessoa arquivar o mesmo funil. Sem isto, o
  // segundo clique "dá certo" e promove um novo padrão sem motivo.
  if (funil.is_archived) {
    return fail(
      "state_conflict",
      `O funil «${funil.name}» já foi excluído. Recarregue a página.`,
      409,
      { requestId },
    );
  }

  // ⚠️ O ÚLTIMO FUNIL NÃO SAI. Sem funil não há etapa, e sem etapa o agente não
  // tem para onde levar card nenhum — a tela de Funis já descreve esse estado
  // como o de uma instalação pela metade, e criar funil não existe em nenhuma
  // tela deste produto. Deixar excluir seria uma porta só de ida.
  const { count: vivos, error: errVivos } = await supabase
    .from("crm_pipelines")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("is_archived", false);
  if (errVivos) return fail("internal_error", errVivos.message, 500, { requestId });
  if ((vivos ?? 0) <= 1) {
    return fail(
      "unprocessable_entity",
      `«${funil.name}» é o seu único funil. Se ele sair, o Kanban fica sem nenhuma etapa e o assistente não tem para onde levar os negócios — crie outro funil antes de excluir este.`,
      422,
      { requestId, details: { unico: true } },
    );
  }

  let negocios: { total: number; abertos: number };
  let formularios: number;
  try {
    negocios = await contarNegocios(supabase, orgId, pipelineId);
    formularios = await contarFormularios(supabase, orgId, pipelineId);
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }

  // ⚠️ A CONTAGEM VAI EM `details`, NÃO SÓ DENTRO DA FRASE. A tela pergunta "os
  // N negócios saem da tela junto, tem certeza?" e precisa do NÚMERO; tirá-lo
  // da mensagem com regex seria uma segunda régua que quebra na primeira vez
  // que alguém melhorar o texto. Funil vazio e sem formulário não tem o que
  // perguntar — sai direto, como a etapa vazia.
  const temEmJogo = negocios.total > 0 || formularios > 0;
  if (temEmJogo && !confirmado) {
    return fail(
      "unprocessable_entity",
      `«${funil.name}» não está vazio. Confirme para excluir mesmo assim.`,
      422,
      {
        requestId,
        details: {
          precisa_confirmar: true,
          negocios: negocios.total,
          abertos: negocios.abertos,
          formularios,
        },
      },
    );
  }

  // Libera o padrão no MESMO update que arquiva: dois updates deixariam uma
  // janela com o índice único ocupado por um funil fora do quadro.
  const { error } = await supabase
    .from("crm_pipelines")
    .update({ is_archived: true, is_default: false })
    .eq("id", pipelineId)
    .eq("organization_id", orgId);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  // O sucessor é o primeiro funil vivo na ordem do quadro — a mesma ordem que a
  // tela mostra, para que "qual virou o padrão?" tenha resposta olhando a lista.
  let novoPadrao: { id: string; name: string } | null = null;
  if (funil.is_default) {
    const { data: candidato } = await supabase
      .from("crm_pipelines")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_archived", false)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (candidato) {
      const { error: errPromo } = await supabase
        .from("crm_pipelines")
        .update({ is_default: true })
        .eq("id", (candidato as { id: string }).id)
        .eq("organization_id", orgId);
      // Falha BAIXO: o funil já saiu e a org fica sem padrão. É um estado que o
      // quadro tolera (a próxima ação some, nada quebra) e que se conserta
      // desfazendo a exclusão — mentir dizendo que deu tudo certo seria pior.
      if (!errPromo) novoPadrao = candidato as { id: string; name: string };
    }
  }

  void audit({
    action: "pipeline.archived",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: {
      name: funil.name,
      era_padrao: funil.is_default,
      negocios: negocios.total,
      abertos: negocios.abertos,
      formularios,
      novo_padrao_id: novoPadrao?.id ?? null,
    },
  });

  return ok(
    {
      id: pipelineId,
      name: funil.name,
      arquivado: true,
      negocios: negocios.total,
      formularios,
      novo_padrao: novoPadrao,
    },
    { requestId },
  );
}

/**
 * O caminho de volta. Aceita SÓ `arquivado: false` — desfazer é a única edição
 * de funil que existe neste produto, e um PATCH genérico aqui viraria a porta
 * dos fundos para renomear/reordenar sem as regras que ainda não foram escritas.
 */
const patchSchema = z.object({ arquivado: z.literal(false) }).strict();

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const { id: pipelineId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return fail("unprocessable_entity", "Não entendi o que mudar neste funil.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();

  let funil: FunilRow | null;
  try {
    funil = await lerFunil(supabase, orgId, pipelineId);
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
  if (!funil) return fail("not_found", "Funil não encontrado.", 404, { requestId });
  if (!funil.is_archived) {
    return ok({ id: pipelineId, name: funil.name, arquivado: false }, { requestId });
  }

  // NÃO devolve o `is_default`: enquanto este funil esteve fora, outro assumiu o
  // posto, e reivindicá-lo aqui bateria no índice único e transformaria um
  // "Desfazer" em erro. Quem volta, volta como funil comum.
  const { error } = await supabase
    .from("crm_pipelines")
    .update({ is_archived: false })
    .eq("id", pipelineId)
    .eq("organization_id", orgId);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  void audit({
    action: "pipeline.restored",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: { name: funil.name },
  });

  return ok({ id: pipelineId, name: funil.name, arquivado: false }, { requestId });
}
