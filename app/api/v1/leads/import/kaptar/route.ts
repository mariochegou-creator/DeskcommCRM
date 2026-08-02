/**
 * POST /api/v1/leads/import/kaptar — importa um lote de leads do Kaptar.
 *
 * A tela fatia a lista e chama esta rota várias vezes, mostrando progresso.
 * Cada chamada é independente e idempotente: reenviar o mesmo lote não cria
 * nada duas vezes, porque a deduplicação roda antes de qualquer insert.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { camposPersonalizados, resumoDeVenda, type KaptarLead } from "@/lib/import/kaptar";
import { importKaptarSchema, validateRequest, type LeadKaptarInput } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { createLeadHandler } from "../../_handler";

export const dynamic = "force-dynamic";

/** Marca a procedência. Também é o escopo do índice uniq_crm_leads_org_source_external. */
const SOURCE = "kaptar";

/**
 * Quantos leads são gravados ao mesmo tempo. Sequencial passaria de 20s num
 * lote de 250 e o navegador desistiria; sem limite, abriríamos 250 conexões
 * no Supabase de uma vez.
 */
const CONCORRENCIA = 6;

interface Ignorado {
  linha: number;
  nome: string;
  motivo: string;
}

interface Falha {
  linha: number;
  nome: string;
  erro: string;
}

async function emLotes<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    for (;;) {
      const i = proximo++;
      const item = itens[i];
      if (i >= itens.length || item === undefined) return;
      saida[i] = await fn(item);
    }
  });
  await Promise.all(trabalhadores);
  return saida;
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  // Mesma régua do POST /api/v1/leads: escrever no funil é agent+.
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(importKaptarSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const supabase = await createClient();
  const orgId = activeOrg.orgId;
  const { leads, pipeline_id, stage_id } = input;

  // A etapa tem que ser do funil escolhido. Sem esta checagem um stage_id de
  // outro funil entraria e o cartão sumiria do quadro sem erro nenhum.
  const { data: etapa, error: etapaErr } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("id", stage_id)
    .eq("pipeline_id", pipeline_id)
    .maybeSingle();
  if (etapaErr) return fail("internal_error", etapaErr.message, 500, { requestId });
  if (!etapa) {
    return fail("invalid_request", "A etapa escolhida não pertence a este funil.", 422, { requestId });
  }

  // ---------------------------------------------------------------------
  // Deduplicação — três consultas em lote, não uma por lead.
  // ---------------------------------------------------------------------
  const placeIds = leads.map((l) => l.placeId).filter((p): p is string => p !== null);
  const telefones = [...new Set(leads.map((l) => l.telefone))];

  // (1) Já veio do Kaptar antes: bate por place_id, o identificador estável.
  const jaImportados = new Set<string>();
  if (placeIds.length > 0) {
    const { data, error } = await supabase
      .from("crm_leads")
      .select("external_id")
      .eq("organization_id", orgId)
      .eq("source", SOURCE)
      .in("external_id", placeIds);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    for (const row of data ?? []) if (row.external_id) jaImportados.add(row.external_id as string);
  }

  // (2) Contatos que já existem, por telefone.
  const contatoPorTelefone = new Map<string, string>();
  {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, phone_number")
      .eq("organization_id", orgId)
      .is("is_merged_into", null)
      .in("phone_number", telefones);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    for (const row of data ?? []) {
      if (row.phone_number) contatoPorTelefone.set(row.phone_number as string, row.id as string);
    }
  }

  // (3) Desses contatos, quais já têm negócio ABERTO.
  //
  // É esta consulta que cobre as levas que você subiu à mão: aqueles leads
  // entraram sem place_id, então (1) não os enxerga. O telefone é o único
  // fio que liga os dois mundos. Fechado/perdido não conta — reprospectar
  // quem você já perdeu é legítimo.
  const contatosComNegocioAberto = new Set<string>();
  const idsDeContato = [...contatoPorTelefone.values()];
  if (idsDeContato.length > 0) {
    const { data, error } = await supabase
      .from("crm_leads")
      .select("contact_id")
      .eq("organization_id", orgId)
      .eq("status", "open")
      .in("contact_id", idsDeContato);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    for (const row of data ?? []) if (row.contact_id) contatosComNegocioAberto.add(row.contact_id as string);
  }

  // ---------------------------------------------------------------------
  // Triagem antes de escrever
  // ---------------------------------------------------------------------
  const ignorados: Ignorado[] = [];
  const paraImportar: LeadKaptarInput[] = [];

  for (const lead of leads) {
    if (lead.placeId && jaImportados.has(lead.placeId)) {
      ignorados.push({ linha: lead.linha, nome: lead.nome, motivo: "Já importado do Kaptar antes." });
      continue;
    }
    const contatoExistente = contatoPorTelefone.get(lead.telefone);
    if (contatoExistente && contatosComNegocioAberto.has(contatoExistente)) {
      ignorados.push({
        linha: lead.linha,
        nome: lead.nome,
        motivo: "Já existe negócio aberto para este telefone.",
      });
      continue;
    }
    paraImportar.push(lead);
  }

  // ---------------------------------------------------------------------
  // Gravação
  // ---------------------------------------------------------------------
  const falhas: Falha[] = [];
  let criados = 0;

  const garantirContato = async (lead: LeadKaptarInput): Promise<string | undefined> => {
    const existente = contatoPorTelefone.get(lead.telefone);
    if (existente) return existente;

    const { data: criado, error } = await supabase
      .from("contacts")
      .insert({
        organization_id: orgId,
        name: lead.nome.slice(0, 200),
        phone_number: lead.telefone,
        // email null, nunca "": o CHECK contacts_email_format recusa string vazia.
        email: lead.email,
        source: SOURCE,
        source_metadata: {
          place_id: lead.placeId,
          categoria: lead.categoria,
          cidade: lead.cidade,
          estado: lead.estado,
        },
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505: outro lead do MESMO lote, rodando em paralelo, criou este
      // telefone entre o select em lote e agora. Reaproveita o vencedor.
      if (error.code === "23505") {
        const { data: vencedor } = await supabase
          .from("contacts")
          .select("id")
          .eq("organization_id", orgId)
          .eq("phone_number", lead.telefone)
          .is("is_merged_into", null)
          .maybeSingle();
        const id = vencedor?.id as string | undefined;
        if (id) contatoPorTelefone.set(lead.telefone, id);
        return id;
      }
      throw new Error(error.message);
    }

    const id = criado?.id as string | undefined;
    if (id) contatoPorTelefone.set(lead.telefone, id);
    return id;
  };

  await emLotes(paraImportar, CONCORRENCIA, async (lead) => {
    try {
      const contactId = await garantirContato(lead);

      await createLeadHandler(
        supabase,
        { organization_id: orgId, actor: { type: "user", id: authUser.id }, requestId },
        {
          pipeline_id,
          stage_id,
          // createLeadSchema limita o título a 200 caracteres.
          title: lead.nome.slice(0, 200),
          description: resumoDeVenda(lead as KaptarLead),
          contact_id: contactId,
          currency: "BRL",
          tags: [SOURCE],
          source: SOURCE,
          custom_fields: camposPersonalizados(lead as KaptarLead),
          source_metadata: { importado_em: new Date().toISOString(), linha_do_arquivo: lead.linha },
          ...(lead.placeId ? { external_id: lead.placeId } : {}),
        },
      );
      criados++;
    } catch (err) {
      const msg = err instanceof ApiError ? (err.message ?? "erro") : (err as Error).message;
      // Corrida entre dois lotes simultâneos com o mesmo place_id: o índice
      // único derrubou o segundo. Isso é duplicata, não falha.
      if (lead.placeId && msg.includes("uniq_crm_leads_org_source_external")) {
        ignorados.push({ linha: lead.linha, nome: lead.nome, motivo: "Já importado do Kaptar antes." });
        return;
      }
      falhas.push({ linha: lead.linha, nome: lead.nome, erro: msg });
    }
  });

  return ok({ criados, ignorados, falhas, recebidos: leads.length }, { requestId });
}
