/**
 * O contato de um telefone: reusa o que já existe na organização, ou cria.
 *
 * Duas portas chegam aqui com a MESMA pergunta — a importação de lista
 * (`/api/v1/leads/import`) e o formulário de novo lead do quadro
 * (`/api/v1/leads`) — e a resposta precisa ser a mesma nas duas. Se cada uma
 * decidisse por conta, o mesmo número viraria dois contatos e a conversa do
 * WhatsApp se partiria em duas: metade do histórico em cada card.
 *
 * Só linha ATIVA conta: contato mesclado (`is_merged_into`) não volta — mesmo
 * predicado do webhook de captação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";

export interface ContatoPorTelefoneInput {
  organizationId: string;
  createdByUserId: string | null;
  /** JÁ em E.164 (`telefoneE164`/`normalizePhoneBR`). Número inválido é decisão de quem chama. */
  phone: string;
  /** Usado só quando o contato NASCE aqui — contato existente nunca é renomeado. */
  name: string;
  email?: string | null;
  source: string;
  sourceMetadata?: Record<string, unknown>;
  requestId: string;
}

export interface ContatoPorTelefone {
  id: string;
  /** `true` = o telefone já tinha contato ativo; nada foi criado. */
  jaExistia: boolean;
}

export async function contatoPorTelefone(
  supabase: SupabaseClient,
  input: ContatoPorTelefoneInput,
): Promise<ContatoPorTelefone> {
  const selectAtivoPorTelefone = () =>
    supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("phone_number", input.phone)
      .is("is_merged_into", null)
      .maybeSingle();

  const { data: existente, error: selErr } = await selectAtivoPorTelefone();
  if (selErr) {
    throw new ApiError(500, "internal_error", undefined, input.requestId, selErr.message);
  }
  if (existente) return { id: existente.id as string, jaExistia: true };

  const { data: criado, error: insErr } = await supabase
    .from("contacts")
    .insert({
      organization_id: input.organizationId,
      created_by_user_id: input.createdByUserId,
      name: input.name,
      phone_number: input.phone,
      email: input.email ?? null,
      source: input.source,
      source_metadata: input.sourceMetadata ?? {},
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    if (insErr.code !== "23505") {
      throw new ApiError(500, "internal_error", undefined, input.requestId, insErr.message);
    }
    // Corrida com outro lote/aba: o índice único por telefone derrubou este
    // insert — reusa o vencedor.
    const { data: vencedor } = await selectAtivoPorTelefone();
    if (!vencedor) {
      // Único (23505) mas invisível no select: o telefone está numa linha
      // MESCLADA. Devolver "sem contato" aqui criaria um lead sem WhatsApp em
      // silêncio — que é exatamente o card inútil que este caminho existe para
      // evitar. Melhor a linha falhar e aparecer no relatório.
      throw new ApiError(
        409,
        "contact_phone_conflict",
        undefined,
        input.requestId,
        "Este telefone pertence a um contato mesclado. Abra o contato para reativá-lo.",
      );
    }
    return { id: vencedor.id as string, jaExistia: true };
  }

  if (!criado) {
    throw new ApiError(500, "internal_error", undefined, input.requestId, "Falha ao criar contato.");
  }
  return { id: criado.id as string, jaExistia: false };
}
