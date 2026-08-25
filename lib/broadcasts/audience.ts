/**
 * Quem vai receber o disparo (0108).
 *
 * Resolve o filtro da tela em CONTATOS únicos. Duas decisões moram aqui:
 *
 * 1. A consulta é em `crm_leads` com join OBRIGATÓRIO em `contacts`
 *    (`!inner`) — o público do disparador é o funil, e lead sem contato não tem
 *    para onde mandar. O mesmo `!inner` que o inbox usa para filtrar conversa
 *    por etapa (app/api/v1/conversations/_handler.ts:45).
 *
 * 2. A saída é DEDUPADA POR CONTATO, aqui e não só no banco. A unique
 *    `(broadcast_id, contact_id)` protege a gravação, mas o operador precisa ver
 *    o número certo ANTES de ativar: um público que mostra "180" e entrega 143
 *    porque 37 eram cards repetidos do mesmo dono destrói a confiança na tela na
 *    primeira campanha. Repetição de card é a regra na operação (importação
 *    rodada duas vezes, negócio reaberto), não a exceção.
 *
 * SOBRE NICHO: não existe coluna `nicho`. O que a importação grava é uma chave
 * dentro de `crm_leads.custom_fields` com o nome do CABEÇALHO DO CSV, sem
 * normalizar — `Nicho`, `nicho` e `NICHO` são chaves diferentes. Por isso o
 * filtro de campo é `{key, value}` explícito e a tela oferece as chaves que
 * existem de verdade no banco, em vez de fingir um campo fixo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { motivoParaPular, type ContatoParaDisparo } from "./guards";
import type { MotivoDePulo } from "./vocabulario";

/** O filtro, como sai da tela e como fica congelado em `broadcasts.audience`. */
export interface FiltroDePublico {
  pipeline_id?: string | null;
  stage_id?: string | null;
  /** Default 'open': disparar para negócio ganho/perdido quase nunca é o que se quer. */
  lead_status?: "open" | "won" | "lost" | "any" | null;
  /** Tag do NEGÓCIO (crm_leads.tags). */
  lead_tag?: string | null;
  /** Tag do CLIENTE (contacts.tags) — a colorida do catálogo (0105). */
  contact_tag?: string | null;
  /** Campo da importação: chave crua do CSV + valor exato. */
  custom_field?: { key: string; value: string } | null;
}

export interface CandidatoAoDisparo {
  contact_id: string;
  lead_id: string;
  /** Primeiro card que trouxe este contato — só para procedência. */
  lead_title: string | null;
  nome: string | null;
  contato: ContatoParaDisparo;
  /** null = apto a receber; caso contrário, por que será pulado. */
  motivoDePulo: MotivoDePulo | null;
}

export interface ResumoDoPublico {
  /** Contatos únicos que casaram com o filtro. */
  total: number;
  /** Quantos recebem de fato. */
  aptos: number;
  /** Quantos entram já marcados como pulados, por motivo. */
  pulados: Record<string, number>;
  /** Amostra para a tela (ordem estável). */
  amostra: { nome: string | null; telefone: string | null; motivo: MotivoDePulo | null }[];
}

const CONTATO_COLS =
  "id, name, display_name, phone_number, wa_identity, is_blocked, is_anonymized, is_merged_into, tags";

/** Lote do PostgREST. Acima de 1000 a resposta é truncada em silêncio. */
const LOTE = 1000;

interface LinhaDeLead {
  id: string;
  title: string | null;
  contact_id: string;
  contacts: {
    id: string;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
    wa_identity: string | null;
    is_blocked: boolean | null;
    is_anonymized: boolean | null;
    is_merged_into: string | null;
    tags: string[] | null;
  } | null;
}

/**
 * Resolve o filtro em candidatos únicos por contato.
 *
 * `teto` corta a leitura: é o `max_recipients` da campanha, e existe para que um
 * filtro largo demais ("todos os leads") não vire uma varredura de 50 mil linhas
 * dentro de uma request HTTP.
 */
export async function resolverPublico(
  admin: SupabaseClient,
  organizationId: string,
  filtro: FiltroDePublico,
  teto: number,
): Promise<CandidatoAoDisparo[]> {
  const porContato = new Map<string, CandidatoAoDisparo>();

  for (let inicio = 0; inicio < teto + LOTE; inicio += LOTE) {
    let q = admin
      .from("crm_leads")
      .select(`id, title, contact_id, contacts:contact_id!inner (${CONTATO_COLS})`)
      .eq("organization_id", organizationId)
      // Ordem estável: o mesmo filtro devolve o mesmo público, e a paginação
      // não pula nem repete linha entre lotes.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(inicio, inicio + LOTE - 1);

    const status = filtro.lead_status ?? "open";
    if (status !== "any") q = q.eq("status", status);
    if (filtro.pipeline_id) q = q.eq("pipeline_id", filtro.pipeline_id);
    if (filtro.stage_id) q = q.eq("stage_id", filtro.stage_id);
    if (filtro.lead_tag) q = q.contains("tags", [filtro.lead_tag]);
    if (filtro.contact_tag) q = q.contains("contacts.tags", [filtro.contact_tag]);
    if (filtro.custom_field?.key) {
      // `@>` (contains) é o único operador que usa o índice GIN jsonb_path_ops
      // de custom_fields. `->>' ilike` faria varredura sequencial.
      q = q.contains("custom_fields", { [filtro.custom_field.key]: filtro.custom_field.value });
    }

    const { data, error } = await q;
    if (error) throw new Error(`publico_falhou: ${error.message}`);

    const linhas = (data ?? []) as unknown as LinhaDeLead[];
    for (const linha of linhas) {
      const c = linha.contacts;
      if (!c) continue;
      // Primeiro card vence: dedup por contato, e a procedência aponta para o
      // negócio mais antigo que trouxe esta pessoa.
      if (porContato.has(c.id)) continue;

      const contato: ContatoParaDisparo = {
        id: c.id,
        phone_number: c.phone_number,
        wa_identity: c.wa_identity,
        is_blocked: c.is_blocked,
        is_anonymized: c.is_anonymized,
        is_merged_into: c.is_merged_into,
      };
      porContato.set(c.id, {
        contact_id: c.id,
        lead_id: linha.id,
        lead_title: linha.title,
        nome: c.display_name ?? c.name ?? null,
        contato,
        motivoDePulo: motivoParaPular(contato),
      });
      if (porContato.size >= teto) break;
    }

    if (linhas.length < LOTE || porContato.size >= teto) break;
  }

  return [...porContato.values()];
}

/** O que a tela mostra no passo de revisão. */
export function resumirPublico(
  candidatos: CandidatoAoDisparo[],
  tamanhoDaAmostra = 20,
): ResumoDoPublico {
  const pulados: Record<string, number> = {};
  let aptos = 0;
  for (const c of candidatos) {
    if (c.motivoDePulo) {
      pulados[c.motivoDePulo] = (pulados[c.motivoDePulo] ?? 0) + 1;
    } else {
      aptos += 1;
    }
  }
  return {
    total: candidatos.length,
    aptos,
    pulados,
    amostra: candidatos.slice(0, tamanhoDaAmostra).map((c) => ({
      nome: c.nome,
      telefone: c.contato.phone_number,
      motivo: c.motivoDePulo,
    })),
  };
}

/**
 * As chaves de `custom_fields` que existem de verdade nesta org, com os valores
 * mais comuns de cada uma — o que alimenta o seletor de nicho na tela.
 *
 * Amostragem (não varredura): lê as N linhas mais recentes e conta. Um censo
 * exato exigiria `jsonb_each` sobre a tabela inteira a cada abertura de tela, e
 * o que o operador precisa é reconhecer a chave que ele mesmo importou, não uma
 * estatística.
 */
export async function chavesDeCustomFields(
  admin: SupabaseClient,
  organizationId: string,
  amostra = 500,
): Promise<{ key: string; valores: string[] }[]> {
  const { data } = await admin
    .from("crm_leads")
    .select("custom_fields")
    .eq("organization_id", organizationId)
    .not("custom_fields", "eq", "{}")
    .order("created_at", { ascending: false })
    .limit(amostra);

  const contagem = new Map<string, Map<string, number>>();
  for (const linha of (data ?? []) as { custom_fields: unknown }[]) {
    const cf = linha.custom_fields;
    if (!cf || typeof cf !== "object" || Array.isArray(cf)) continue;
    for (const [chave, valor] of Object.entries(cf as Record<string, unknown>)) {
      if (typeof valor !== "string" && typeof valor !== "number") continue;
      const texto = String(valor).trim();
      // Gancho é texto longo e único por lead — não é dimensão de público.
      if (!texto || texto.length > 60) continue;
      if (!contagem.has(chave)) contagem.set(chave, new Map());
      const valores = contagem.get(chave)!;
      valores.set(texto, (valores.get(texto) ?? 0) + 1);
    }
  }

  return [...contagem.entries()]
    .map(([key, valores]) => ({
      key,
      valores: [...valores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([v]) => v),
    }))
    // Chave com um valor só não separa ninguém de ninguém.
    .filter((c) => c.valores.length > 1)
    .sort((a, b) => a.key.localeCompare(b.key, "pt-BR"));
}
