/**
 * Contato interno por (org, phone) — o destinatário de mensagem OPERACIONAL
 * (bom-dia do plano, aviso de reunião pro closer), que precisa existir em
 * `contacts` para a mensagem andar pelo trilho normal (conversa → histórico →
 * audit → redrive).
 *
 * Era função local do cron plan-morning-brief; virou módulo quando o
 * meeting-reminders passou a avisar o time também (19/08/2026) — duas cópias
 * do select-then-insert divergiriam no primeiro ajuste de corrida.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Select-then-insert com corrida tratada (23505 ⇒ o vencedor serve). */
export async function garantirContato(
  admin: SupabaseClient,
  orgId: string,
  name: string,
  phone: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", phone)
    .is("is_merged_into", null)
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      organization_id: orgId,
      name,
      display_name: name,
      phone_number: phone,
      source: "manual",
    })
    .select("id")
    .single();
  if (error || !created) {
    // 23505 = outro processo criou entre o select e o insert (unique parcial
    // org+phone). O vencedor serve.
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("phone_number", phone)
        .limit(1)
        .maybeSingle();
      if (winner) return (winner as { id: string }).id;
    }
    throw new Error(error?.message ?? "contact_insert_failed");
  }
  return (created as { id: string }).id;
}
