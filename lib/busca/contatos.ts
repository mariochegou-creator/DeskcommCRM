/**
 * "Quais contatos casam com o que foi digitado?" — a pergunta que toda busca de
 * CONVERSA precisa responder primeiro.
 *
 * Existe porque o inbox procurava só em `conversations.last_message_preview`, e
 * o nome da pessoa não mora ali: mora em `contacts.name` / `contacts.display_name`.
 * O caminho óbvio — costurar o contato no `.or()` da própria consulta de
 * conversas — o PostgREST não faz: `or` não atravessa tabela embutida, e um
 * `!inner` no contato viraria E (só conversa com contato que casa) quando o que
 * se quer é OU (o nome OU o texto da mensagem).
 *
 * Então são dois passos, o mesmo padrão que a fila de follow-up já usava: os ids
 * primeiro, o `in.(...)` depois.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { padraoBusca, telefonesBusca } from "@/lib/busca/termo";

/**
 * Teto de contatos resolvidos por busca. A lista de ids viaja na URL da consulta
 * seguinte (~37 caracteres por uuid), e o cliente HTTP corta em 16 KB — o que
 * passar do corte sai como resultado a menos, calado. E a URL do inbox carrega
 * DUAS listas: esta e a das conversas que casaram por mensagem
 * (lib/busca/conversas.ts), então o orçamento é dividido entre as duas.
 *
 * 150 é folgado de propósito: um termo que casa com 150 contatos não é busca, é
 * listagem, e nesse caso o usuário quer o filtro de etapa ou de tag, não a caixa
 * de texto.
 */
export const TETO_DE_CONTATOS = 150;

/**
 * O `.or()` que reconhece uma pessoa: nome comercial, nome de exibição, telefone.
 *
 * `name` e `display_name` são campos DIFERENTES e os dois importam — a
 * importação do Google Maps grava a empresa em `name` ("Contraste Móveis e
 * Decorações") e o WhatsApp grava quem atende em `display_name` ("Sérgio
 * Martins"). Procurar em um só deixa metade da base invisível.
 *
 * `null` = o termo não sobrou nada; quem chama não filtra.
 */
export function filtroDeContato(termo: string): string | null {
  const padrao = padraoBusca(termo);
  if (!padrao) return null;

  const partes = [`name.imatch.${padrao}`, `display_name.imatch.${padrao}`];
  for (const digitos of telefonesBusca(termo)) {
    partes.push(`phone_number.ilike.%${digitos}%`);
  }
  return partes.join(",");
}

/**
 * Os ids dos contatos que casam com o termo, dentro de uma organização.
 *
 * `organizationId: null` é o caso do inbox de suporte (super-admin), que
 * atravessa tenants de propósito — a RLS da chave usada é quem decide o alcance.
 */
export async function contatosQueCasam(
  supabase: SupabaseClient,
  organizationId: string | null,
  termo: string,
  teto = TETO_DE_CONTATOS,
): Promise<{ ids: string[]; error: string | null }> {
  const filtro = filtroDeContato(termo);
  if (!filtro) return { ids: [], error: null };

  let query = supabase.from("contacts").select("id").or(filtro).limit(teto);
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) return { ids: [], error: error.message };

  return { ids: (data ?? []).map((c) => (c as { id: string }).id), error: null };
}
