/**
 * O I/O do material da reunião: junta o dossiê no banco, chama o modelo uma
 * vez e devolve o roteiro. As REGRAS (o que entra no dossiê, o que é um "sim",
 * como se lê a resposta do modelo) ficam em `material.ts`, que é puro.
 *
 * UMA chamada por reunião, e só quando o closer pede. É o oposto do que a IA
 * do inbox faz (4 a 8 chamadas por mensagem): aqui o gasto é previsível e
 * autorizado por uma pessoa.
 *
 * NUNCA LANÇA. Modelo fora do ar, chave sem saldo, JSON torto — tudo cai no
 * material de reserva, montado só com o card. Uma hora antes da reunião, um
 * roteiro genérico com o gancho certo vale muito mais que um erro.
 */
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_BOT_MODEL,
  gatewayHeaders,
  isModelConfigured,
  resolveModel,
} from "@/lib/ai/gateway";
import { logger } from "@/lib/logger";

import {
  interpretarResposta,
  materialDeReserva,
  montarDossie,
  parseMaterial,
  promptDoMaterial,
  SISTEMA_DO_MATERIAL,
  type DadosDoLead,
  type RespostaDoCloser,
} from "./material";
import type { Reuniao, RoteiroDaReuniao } from "./reuniao";

/** Quantas notas e quantas mensagens entram no dossiê. */
const TETO_DE_NOTAS = 10;
const TETO_DE_MENSAGENS = 30;
/** Mensagem maior que isto entra cortada — transcrição de áudio colada inteira estoura o prompt. */
const TETO_DO_TEXTO = 400;

export interface LeadParaMaterial {
  id: string;
  organization_id: string;
  contact_id: string | null;
  title: string | null;
  description?: string | null;
  tags?: string[] | null;
  custom_fields: unknown;
}

function cortar(texto: string): string {
  const limpo = texto.trim().replace(/\s+/g, " ");
  return limpo.length > TETO_DO_TEXTO ? `${limpo.slice(0, TETO_DO_TEXTO)}…` : limpo;
}

/**
 * Tudo que o CRM sabe deste lead, na forma que o dossiê espera.
 *
 * Notas e conversa saem pelo CONTATO, não pelo lead: é assim que as duas
 * tabelas são chaveadas (`lead_notes.contact_id`, `messages.contact_id`), e é
 * também o que faz o histórico anterior ao card aparecer no material.
 *
 * As mensagens que o próprio agendamento mandou são descartadas — lembrete de
 * reunião no meio do dossiê faz o modelo achar que o assunto da conversa é a
 * própria reunião.
 */
export async function carregarDadosDoLead(
  admin: SupabaseClient,
  lead: LeadParaMaterial,
  nomeDoContato: string | null,
): Promise<DadosDoLead> {
  const dados: DadosDoLead = {
    leadId: lead.id,
    negocio: lead.title,
    contato: nomeDoContato,
    descricao: lead.description ?? null,
    tags: lead.tags ?? [],
    customFields: lead.custom_fields,
    notas: [],
    conversa: [],
  };

  if (!lead.contact_id) return dados;

  const { data: notas } = await admin
    .from("lead_notes")
    .select("headline, body, created_at")
    .eq("organization_id", lead.organization_id)
    .eq("contact_id", lead.contact_id)
    .order("created_at", { ascending: false })
    .limit(TETO_DE_NOTAS);

  dados.notas = ((notas ?? []) as Array<{ headline: string | null; body: string | null }>)
    .map((n) => cortar([n.headline, n.body].filter(Boolean).join(" — ")))
    .filter(Boolean);

  const { data: msgs } = await admin
    .from("messages")
    .select("body, direction, metadata, created_at")
    .eq("organization_id", lead.organization_id)
    .eq("contact_id", lead.contact_id)
    .eq("type", "text")
    .order("created_at", { ascending: false })
    .limit(TETO_DE_MENSAGENS * 2);

  const brutas = (msgs ?? []) as Array<{
    body: string | null;
    direction: string;
    metadata: unknown;
  }>;

  dados.conversa = brutas
    .filter((m) => {
      if (!m.body?.trim()) return false;
      const meta = m.metadata;
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        if ((meta as Record<string, unknown>).meeting_message) return false;
      }
      return true;
    })
    .slice(0, TETO_DE_MENSAGENS)
    .reverse()
    .map((m) => ({
      de: m.direction === "inbound" ? ("lead" as const) : ("nos" as const),
      texto: cortar(m.body ?? ""),
    }));

  return dados;
}

/**
 * O roteiro. Chama o modelo; cai na reserva em qualquer tropeço.
 *
 * Sem retry de formato de propósito (o live-suggest tem um): lá a chamada é de
 * segundos e o overlay espera; aqui a alternativa ao JSON torto é a reserva,
 * que já é aceitável — pagar uma segunda chamada para talvez melhorar não vale
 * o dobro do custo num caminho que roda dentro de um cron.
 */
export async function gerarMaterial(
  dados: DadosDoLead,
  reuniao: Reuniao,
  organizationId: string,
  agora: Date,
): Promise<RoteiroDaReuniao> {
  if (!isModelConfigured(DEFAULT_BOT_MODEL)) {
    logger.warn("[material] sem credencial de IA — usando material de reserva", {
      leadId: dados.leadId,
    });
    return materialDeReserva(dados, agora);
  }

  try {
    const res = await generateText({
      model: resolveModel(DEFAULT_BOT_MODEL),
      system: SISTEMA_DO_MATERIAL,
      messages: [{ role: "user", content: promptDoMaterial(montarDossie(dados, reuniao), reuniao) }],
      headers: gatewayHeaders({ organizationId }),
    });
    const roteiro = parseMaterial(res.text ?? "", agora);
    if (roteiro) return roteiro;
    logger.warn("[material] modelo respondeu fora do formato — usando reserva", {
      leadId: dados.leadId,
    });
  } catch (err) {
    logger.warn("[material] chamada ao modelo falhou — usando reserva", {
      leadId: dados.leadId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return materialDeReserva(dados, agora);
}

/**
 * Grava o roteiro dentro de `custom_fields.reuniao`.
 *
 * Faz merge sobre o que está no banco AGORA, não sobre o objeto que o cron leu
 * no começo do tick: entre a leitura e esta escrita cabe um clique no checklist
 * da Sala de Reuniões, e regravar o objeto antigo apagaria a marcação em
 * silêncio — o mesmo tipo de perda que a peneira do `lerReuniao` já custou uma
 * vez.
 */
export async function gravarRoteiro(
  admin: SupabaseClient,
  lead: { id: string; organization_id: string },
  roteiro: RoteiroDaReuniao,
): Promise<boolean> {
  const { data: atual, error: lerErr } = await admin
    .from("crm_leads")
    .select("custom_fields")
    .eq("id", lead.id)
    .eq("organization_id", lead.organization_id)
    .maybeSingle();

  if (lerErr || !atual) {
    logger.warn("[material] roteiro não gravado: lead ilegível", {
      leadId: lead.id,
      detail: lerErr?.message,
    });
    return false;
  }

  const cf = (atual as { custom_fields: unknown }).custom_fields;
  const base = cf && typeof cf === "object" && !Array.isArray(cf) ? (cf as Record<string, unknown>) : {};
  const reuniaoAtual = base.reuniao;
  if (!reuniaoAtual || typeof reuniaoAtual !== "object" || Array.isArray(reuniaoAtual)) {
    return false;
  }

  const { error } = await admin
    .from("crm_leads")
    .update({
      custom_fields: {
        ...base,
        reuniao: { ...(reuniaoAtual as Record<string, unknown>), roteiro },
      },
    })
    .eq("id", lead.id)
    .eq("organization_id", lead.organization_id);

  if (error) {
    logger.warn("[material] roteiro não gravado", { leadId: lead.id, detail: error.message });
    return false;
  }
  return true;
}

/**
 * O closer respondeu à pergunta do aviso?
 *
 * Lê o que chegou DEPOIS do carimbo do aviso, nas conversas dos destinatários
 * do bom-dia. A primeira mensagem interpretável vence: se ele escreveu "opa" e
 * depois "manda sim", vale o "manda sim"; se escreveu "não precisa" e depois
 * mudou de ideia, o "não precisa" já fechou a pergunta — e mudar de ideia é o
 * que a Sala de Reuniões resolve, sem gastar outra rodada de cron.
 *
 * O teto de 20 mensagens existe porque esta é a MESMA conversa em que ele
 * recebe o bom-dia e conversa outras coisas: varrer tudo desde o carimbo, numa
 * manhã movimentada, seria varrer a caixa inteira atrás de uma palavra.
 */
export async function lerRespostaDoCloser(
  admin: SupabaseClient,
  organizationId: string,
  contactIds: string[],
  desde: string,
): Promise<RespostaDoCloser | null> {
  if (contactIds.length === 0) return null;

  const { data, error } = await admin
    .from("messages")
    .select("body, created_at")
    .eq("organization_id", organizationId)
    .in("contact_id", contactIds)
    .eq("direction", "inbound")
    .gt("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    logger.warn("[material] resposta do closer ilegível", { detail: error.message });
    return null;
  }

  for (const linha of (data ?? []) as Array<{ body: string | null }>) {
    const resposta = interpretarResposta(linha.body);
    if (resposta) return resposta;
  }
  return null;
}
