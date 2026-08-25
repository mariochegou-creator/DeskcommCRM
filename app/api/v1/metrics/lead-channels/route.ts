/**
 * GET /api/v1/metrics/lead-channels — de qual NÚMERO de WhatsApp é cada negócio
 * de um funil, para o seletor "Todos os números" do Painel.
 *
 * Não existe coluna `channel_session_id` em `crm_leads`: o vínculo é
 * lead → contato → conversa → conexão. Um mesmo contato pode ter conversa em
 * mais de uma linha (o lead entrou pelo número do SDR e depois foi puxado pelo
 * closer), então o mapa devolve uma LISTA por negócio, não um id só — atribuir
 * o lead a um número apenas contaria dois times pela metade.
 *
 * A lista de números é derivada do próprio mapa, e não de `channel_sessions`
 * inteira, de propósito: a tabela guarda conexões mortas, repetidas e sem nome
 * (ver "Conexões"), e um seletor com sete linhas onde três estão vazias faz o
 * usuário duvidar do número que está lendo.
 *
 * Escopo igual ao de /metrics/prospecting: piso `agent`, org da org ativa
 * (cookie validado), `pipeline_id` re-validado sob RLS. Read-only ⇒ sem audit.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { emLotes } from "@/lib/leads/enriquecimento";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({ pipeline_id: z.string().uuid() });

export interface NumeroDoPainel {
  /** id da `channel_sessions`. */
  id: string;
  /** Rótulo já pronto para a tela. */
  nome: string;
  /** Negócios deste funil que passaram por esta linha. */
  leads: number;
}

export interface LeadChannelsPayload {
  numeros: NumeroDoPainel[];
  /** lead_id → ids das conexões que falaram com ele. Sem entrada ⇒ sem conversa. */
  byLead: Record<string, string[]>;
  /** Negócios do funil que ainda não têm conversa em lugar nenhum. */
  semConversa: number;
}

/**
 * Rótulo do número na tela.
 *
 * `display_name` é o nome interno do canal e às vezes vem cru (o próprio
 * telefone, ou nulo, quando a conexão caiu antes de nomear). A ordem
 * nome → telefone formatado → "Conexão sem nome" garante que toda linha do
 * seletor diga alguma coisa.
 */
function rotulo(nome: string | null, telefone: string | null): string {
  const limpo = nome?.trim();
  if (limpo && !/^\d+$/.test(limpo)) return limpo;
  if (telefone) return formatarTelefone(telefone);
  if (limpo) return formatarTelefone(limpo);
  return "Conexão sem nome";
}

/** 557799325325 → (77) 9932-5325. Qualquer outro formato volta como veio. */
function formatarTelefone(bruto: string): string {
  const so = bruto.replace(/\D/g, "");
  const sem55 = so.startsWith("55") ? so.slice(2) : so;
  if (sem55.length < 10 || sem55.length > 11) return bruto;
  const ddd = sem55.slice(0, 2);
  const resto = sem55.slice(2);
  const meio = resto.slice(0, resto.length - 4);
  return `(${ddd}) ${meio}-${resto.slice(-4)}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    pipeline_id: url.searchParams.get("pipeline_id") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const supabase = await createClient();

  // Sob RLS: funil de outra org (ou inexistente) volta null ⇒ 404, e não um
  // mapa vazio que na tela pareceria "nenhum número falou com ninguém".
  const { data: pipeline, error: pipeErr } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("id", parsed.data.pipeline_id)
    .maybeSingle();
  if (pipeErr) return fail("internal_error", pipeErr.message, 500, { requestId });
  if (!pipeline) return fail("not_found", "Funil não encontrado.", 404, { requestId });

  // `neq archived` é o MESMO recorte do quadro (/pipelines/[id]/board): as
  // contagens do seletor são lidas ao lado dos KPIs, e universo diferente ali
  // faria as fatias não fecharem com o total sem nada explicando a diferença.
  const { data: leads, error: leadsErr } = await supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("pipeline_id", pipeline.id)
    .neq("status", "archived");
  if (leadsErr) return fail("internal_error", leadsErr.message, 500, { requestId });

  const linhas = (leads ?? []) as Array<{ id: string; contact_id: string | null }>;
  const contactIds = [
    ...new Set(linhas.map((l) => l.contact_id).filter((c): c is string => !!c)),
  ];

  const vazio: LeadChannelsPayload = {
    numeros: [],
    byLead: {},
    semConversa: linhas.length,
  };
  if (contactIds.length === 0) return ok(vazio, { requestId });

  // Em lotes pelo mesmo motivo do quadro: a lista de ids viaja na URL.
  const { data: conversas, error: convErr } = await emLotes(contactIds, (lote) =>
    supabase
      .from("conversations")
      .select("contact_id, channel_session_id")
      .eq("organization_id", activeOrg.orgId)
      .in("contact_id", lote)
      .not("channel_session_id", "is", null),
  );
  if (convErr) return fail("internal_error", convErr, 500, { requestId });

  // contato → conexões que falaram com ele.
  const porContato = new Map<string, Set<string>>();
  for (const c of conversas as Array<{
    contact_id: string | null;
    channel_session_id: string | null;
  }>) {
    if (!c.contact_id || !c.channel_session_id) continue;
    const atual = porContato.get(c.contact_id) ?? new Set<string>();
    atual.add(c.channel_session_id);
    porContato.set(c.contact_id, atual);
  }

  const byLead: Record<string, string[]> = {};
  const contagem = new Map<string, number>();
  let semConversa = 0;
  for (const lead of linhas) {
    const sessoes = lead.contact_id ? porContato.get(lead.contact_id) : undefined;
    if (!sessoes || sessoes.size === 0) {
      semConversa += 1;
      continue;
    }
    byLead[lead.id] = [...sessoes];
    for (const s of sessoes) contagem.set(s, (contagem.get(s) ?? 0) + 1);
  }

  const usadas = [...contagem.keys()];
  if (usadas.length === 0) {
    return ok({ numeros: [], byLead, semConversa }, { requestId });
  }

  const { data: sessoes, error: sessErr } = await emLotes(usadas, (lote) =>
    supabase
      .from("channel_sessions")
      .select("id, display_name, phone_number")
      .eq("organization_id", activeOrg.orgId)
      .in("id", lote),
  );
  if (sessErr) return fail("internal_error", sessErr, 500, { requestId });

  const numeros: NumeroDoPainel[] = (
    sessoes as Array<{ id: string; display_name: string | null; phone_number: string | null }>
  )
    .map((s) => ({
      id: s.id,
      nome: rotulo(s.display_name, s.phone_number),
      leads: contagem.get(s.id) ?? 0,
    }))
    // Mais negócios primeiro: a linha que trabalha aparece antes da que só
    // trocou uma mensagem, sem o usuário ter que procurar.
    .sort((a, b) => b.leads - a.leads || a.nome.localeCompare(b.nome, "pt-BR"));

  return ok({ numeros, byLead, semConversa }, { requestId });
}
