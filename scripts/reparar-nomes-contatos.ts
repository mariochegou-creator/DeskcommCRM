/**
 * Desfaz os contatos batizados com o nome da PRÓPRIA sessão.
 *
 * Contexto: por um período, `handleOutboundFromUserPhone` repassava
 * `notifyName`/`pushName` do payload ao criar o contato. Em mensagem `fromMe`
 * esse campo é o nome de QUEM ENVIOU — nós. O inbox virou uma lista de conversas
 * com "David wilkerson Nexoia" no lugar do nome de cada negócio. O ingest já não
 * faz mais isso (passa `null`); este script conserta o que ficou para trás.
 *
 * ⚠️ Só toca em contato cujo `display_name` é EXATAMENTE o pushName de uma das
 * sessões da org — a lista de nomes proibidos sai do próprio
 * `webhook_events_log` (`me.pushName`), não de uma constante escrita à mão. Um
 * contato que legitimamente se chame assim (o Mario na sessão do David, e
 * vice-versa) é reescrito com o mesmo valor: a regra abaixo o recupera pelo
 * notifyName real e chega no nome que já estava lá.
 *
 * De onde vem o nome verdadeiro, nesta ordem:
 *   1. `notifyName` de uma mensagem que o contato NOS mandou (o nome que o
 *      aparelho dele anuncia — a fonte mais confiável que existe);
 *   2. `crm_leads`, casando pelo telefone. O `@lid` esconde o número, mas o
 *      payload traz `_data.key.remoteJidAlt` com o telefone real. A comparação é
 *      por DDD + 8 dígitos finais: o WhatsApp devolve 55+DDD+9XXXXXXXX e a lista
 *      importada traz "(73) 3633-5155" — comparar cru não casa nunca.
 *   3. nada → `display_name = null`, e a tela cai no "Sem nome". Nome errado é
 *      pior que nome nenhum: manda o operador falar com a pessoa errada.
 *
 * Simulação (padrão):
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/reparar-nomes-contatos.ts
 * Gravando:
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/reparar-nomes-contatos.ts --gravar
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { WahaEnvelope } from "@/lib/waha/ingest";

const GRAVAR = process.argv.includes("--gravar");
const PAGINA = 1000;

type Admin = ReturnType<typeof createAdminClient>;

async function lerTudo<T>(
  monta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await monta(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error(error.message);
    tudo.push(...(data ?? []));
    if (!data || data.length < PAGINA) return tudo;
  }
}

/** DDD + 8 dígitos finais — a única forma de casar 557382084846 com "(73) 8208-4846". */
export function chaveTelefone(bruto: unknown): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const semPais = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (semPais.length < 10) return null;
  return semPais.slice(0, 2) + semPais.slice(-8);
}

interface Contato {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  wa_identity: string | null;
}

async function main(): Promise<void> {
  const admin: Admin = createAdminClient();

  const eventos = await lerTudo<{ payload_parsed: WahaEnvelope }>((from, to) =>
    admin.from("webhook_events_log").select("payload_parsed").eq("provider", "waha").range(from, to),
  );

  const nomesDeSessao = new Set<string>();
  const lidParaTelefone = new Map<string, string>();
  const lidParaNome = new Map<string, string>();

  for (const ev of eventos) {
    const envelope = ev.payload_parsed;
    const pushNameDaSessao = (envelope as { me?: { pushName?: string } })?.me?.pushName;
    if (pushNameDaSessao) nomesDeSessao.add(pushNameDaSessao);

    const p = envelope?.payload;
    if (!p) continue;
    const chave = p._data?.key as { remoteJid?: string; remoteJidAlt?: string } | undefined;
    const chat = p.to ?? chave?.remoteJid ?? p.from ?? null;
    if (chat?.endsWith("@lid") && chave?.remoteJidAlt) {
      lidParaTelefone.set(chat.replace("@lid", ""), chave.remoteJidAlt.replace(/@.*$/, ""));
    }
    // Só mensagem RECEBIDA carrega o nome do contato.
    const nome = p._data?.notifyName ?? p._data?.pushName ?? null;
    if (p.fromMe !== true && nome && p.from?.endsWith("@lid")) {
      const lid = p.from.replace("@lid", "");
      if (!lidParaNome.has(lid)) lidParaNome.set(lid, nome);
    }
  }

  const contatos = await lerTudo<Contato>((from, to) =>
    admin.from("contacts").select("id, display_name, phone_number, wa_identity").range(from, to),
  );
  const porId = new Map(contatos.map((c) => [c.id, c]));

  const leads = await lerTudo<{
    title: string | null;
    contact_id: string | null;
    custom_fields: Record<string, unknown> | null;
  }>((from, to) => admin.from("crm_leads").select("title, contact_id, custom_fields").range(from, to));

  const telParaLead = new Map<string, string>();
  for (const l of leads) {
    if (!l.title) continue;
    const candidatos = [
      l.custom_fields?.telefone,
      l.custom_fields?.phone,
      l.custom_fields?.whatsapp,
      l.contact_id ? porId.get(l.contact_id)?.phone_number : null,
    ];
    for (const cand of candidatos) {
      const k = chaveTelefone(cand);
      if (k && !telParaLead.has(k)) telParaLead.set(k, l.title);
    }
  }

  const afetados = contatos.filter((c) => c.display_name && nomesDeSessao.has(c.display_name));
  const plano = afetados.map((c) => {
    const lid = c.wa_identity?.startsWith("lid:") ? c.wa_identity.slice(4) : null;
    const porNotify = lid ? (lidParaNome.get(lid) ?? null) : null;
    const telefone = lid ? (lidParaTelefone.get(lid) ?? null) : c.phone_number;
    const chave = chaveTelefone(telefone);
    const porLead = chave ? (telParaLead.get(chave) ?? null) : null;
    const novo = porNotify ?? porLead ?? null;
    return {
      c,
      novo,
      fonte: porNotify ? "notifyName" : porLead ? "crm_leads" : "nenhuma",
      telefone,
    };
  });

  console.log("─".repeat(64));
  console.log(GRAVAR ? "REPARO DE NOMES — GRAVANDO" : "REPARO DE NOMES — SIMULAÇÃO (nada é escrito)");
  console.log("─".repeat(64));
  console.log(`nomes das sessões (proibidos como nome de contato): ${[...nomesDeSessao].join(", ")}`);
  console.log(`contatos batizados com o nome da sessão ..... ${afetados.length}`);
  console.log(`  nome real via notifyName .................. ${plano.filter((p) => p.fonte === "notifyName").length}`);
  console.log(`  nome real via crm_leads ................... ${plano.filter((p) => p.fonte === "crm_leads").length}`);
  console.log(`  sem nome → display_name = null ............ ${plano.filter((p) => p.fonte === "nenhuma").length}`);
  console.log("\namostra:");
  for (const p of plano.slice(0, 15)) {
    console.log(`  ${JSON.stringify(p.c.display_name)} → ${JSON.stringify(p.novo)}  [${p.fonte}]`);
  }

  if (!GRAVAR) {
    console.log("\nNada foi gravado. Rode de novo com --gravar para aplicar.");
    return;
  }

  let ok = 0;
  let falhas = 0;
  for (const p of plano) {
    const { error } = await admin
      .from("contacts")
      .update({ display_name: p.novo })
      .eq("id", p.c.id);
    if (error) {
      falhas++;
      console.error(`  falhou ${p.c.id}: ${error.message}`);
    } else ok++;
  }
  console.log(`\ncontatos corrigidos: ${ok} | falhas: ${falhas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
