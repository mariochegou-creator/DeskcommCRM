/**
 * A BUSCA ACHA A PESSOA PELO NOME? — contra o banco de verdade.
 *
 * O defeito relatado em 27/08/2026: com o lead salvo como "Sérgio Martins",
 * digitar "sergio" na caixa do inbox devolvia "Sem conversas por aqui", e no
 * quadro do CRM também não achava nada.
 *
 * Eram dois defeitos somados. Esta prova mede os dois, na mesma consulta que a
 * rota monta hoje (app/api/v1/conversations/_handler.ts):
 *
 *   1. CAMPO — a busca só olhava `conversations.last_message_preview`, e o nome
 *      da pessoa mora em `contacts.display_name`;
 *   2. ACENTO — `ilike` ignora maiúscula, nunca acento: `'%sergio%'` não casa
 *      com "Sérgio";
 *   3. HISTÓRICO — `last_message_preview` guarda só a ÚLTIMA linha, então uma
 *      palavra dita no meio da conversa não existia para a busca.
 *
 * Roda o ANTES e o DEPOIS lado a lado, para que o resultado prove o conserto em
 * vez de só afirmá-lo.
 *
 * Run: npx tsx --env-file=.env.local tests/prova-busca-por-nome.ts [termo]
 */
import { createClient } from "@supabase/supabase-js";

import { contatosQueCasam, filtroDeContato } from "@/lib/busca/contatos";
import { conversasComMensagem } from "@/lib/busca/conversas";
import { padraoBusca } from "@/lib/busca/termo";

const TERMO = process.argv[2] ?? "sergio";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltou NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const COLS = "id, contact_id, last_message_preview, contacts:contact_id (name, display_name, phone_number)";

type Linha = {
  id: string;
  last_message_preview: string | null;
  contacts: { name: string | null; display_name: string | null; phone_number: string | null } | null;
};

function mostrar(rotulo: string, linhas: Linha[]) {
  console.info(`\n${rotulo}: ${linhas.length} conversa(s)`);
  for (const l of linhas.slice(0, 10)) {
    const c = l.contacts;
    console.info(`  · ${c?.display_name ?? c?.name ?? "(sem contato)"} — ${c?.phone_number ?? "-"}`);
  }
}

async function main() {
  // Descobre a organização pelo próprio termo, para a prova não depender de id fixo.
  const { data: contatoAlvo } = await supabase
    .from("contacts")
    .select("organization_id")
    .or(filtroDeContato(TERMO)!)
    .limit(1)
    .maybeSingle();

  // Termo que não é nome de ninguém (uma palavra dita numa conversa, por
  // exemplo) não acha org por contato — cai na org de qualquer conversa.
  const orgId =
    (contatoAlvo as { organization_id: string } | null)?.organization_id ??
    (
      await supabase.from("conversations").select("organization_id").limit(1).maybeSingle()
    ).data?.organization_id;
  if (!orgId) {
    console.error("Nenhuma organização com conversas nesta base.");
    process.exit(1);
  }

  // ANTES: o que a rota fazia — ilike sobre a última mensagem, e só.
  const { data: antes } = await supabase
    .from("conversations")
    .select(COLS)
    .eq("organization_id", orgId)
    .ilike("last_message_preview", `%${TERMO}%`)
    .limit(50);
  mostrar(`ANTES  (ilike só na última mensagem) "${TERMO}"`, (antes ?? []) as unknown as Linha[]);

  // DEPOIS: o que a rota faz agora — mensagem OU contato, sem depender de acento.
  const padrao = padraoBusca(TERMO)!;
  const [contatos, mensagens] = await Promise.all([
    contatosQueCasam(supabase, orgId, TERMO),
    conversasComMensagem(supabase, orgId, TERMO),
  ]);
  const falha = contatos.error ?? mensagens.error;
  if (falha) throw new Error(falha);
  const alvos = [`last_message_preview.imatch.${padrao}`];
  if (contatos.ids.length > 0) alvos.push(`contact_id.in.(${contatos.ids.join(",")})`);
  if (mensagens.ids.length > 0) alvos.push(`id.in.(${mensagens.ids.join(",")})`);

  const { data: depois, error } = await supabase
    .from("conversations")
    .select(COLS)
    .eq("organization_id", orgId)
    .or(alvos.join(","))
    .limit(50);
  if (error) throw new Error(error.message);
  mostrar(`DEPOIS (contato OU histórico, sem acento) "${TERMO}"`, (depois ?? []) as unknown as Linha[]);

  const ganho = (depois?.length ?? 0) - (antes?.length ?? 0);
  console.info(
    `\nVEREDITO: ${contatos.ids.length} contato(s) e ${mensagens.ids.length} conversa(s) por histórico; a busca passou de ` +
      `${antes?.length ?? 0} para ${depois?.length ?? 0} conversa(s) (${ganho >= 0 ? "+" : ""}${ganho}).`,
  );
  process.exit((depois?.length ?? 0) > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
