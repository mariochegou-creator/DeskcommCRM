/**
 * Testa a semeadura da demonstração contra o banco de verdade.
 *
 * Roda: preencher → conferir → limpar → conferir → preencher de novo. Se
 * alguma trava do banco recusar um dado, aparece aqui e não na cara do usuário.
 */
import * as fs from "node:fs";

async function main() {
  for (const linha of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }

  const { semearDemo, limparDemo, contarDemo } = await import("./lib/nexo-demo/seed");
  const { createAdminClient } = await import("./lib/supabase/admin");

  const ORG = process.env.DEMO_ORG_ID!;
  const USER = process.env.DEMO_USER_ID!;
  const admin = createAdminClient();

  console.log("antes:  ", await contarDemo(ORG));

  console.log("\n> preenchendo...");
  const depois = await semearDemo(ORG, USER);
  console.log("depois: ", depois);
  if (depois.negocios === 0) throw new Error("nenhum negócio foi criado");

  const tabelas = [
    ["scores com justificativa", "crm_lead_scores"],
    ["estados de risco", "crm_lead_risk_states"],
    ["propostas de reativação", "crm_lead_reactivations"],
    ["mensagens", "messages"],
    ["etapas do funil", "crm_stages"],
  ] as const;

  for (const [rotulo, tabela] of tabelas) {
    const { count } = await admin
      .from(tabela)
      .select("*", { count: "exact", head: true })
      .eq("organization_id", ORG);
    console.log(`  ${rotulo}: ${count}`);
    if (!count) throw new Error(`${tabela} ficou vazia`);
  }

  const { data: amostra } = await admin
    .from("crm_lead_scores")
    .select("ai_probability, ai_probability_band, ai_probability_reason, ai_probability_evidence")
    .order("ai_probability", { ascending: false })
    .limit(1)
    .single();
  console.log("\namostra de score:\n" + JSON.stringify(amostra, null, 2));

  const { data: donosIA } = await admin
    .from("crm_leads")
    .select("title", { count: "exact" })
    .eq("organization_id", ORG)
    .eq("owner_kind", "ai");
  console.log(`\ncards com dono IA: ${donosIA?.length ?? 0}`);

  console.log("\n> limpando...");
  await limparDemo(ORG);
  const limpo = await contarDemo(ORG);
  console.log("depois da limpeza:", limpo);
  if (limpo.negocios !== 0) throw new Error("a limpeza não removeu tudo");

  console.log("\n> preenchendo de novo (idempotência)...");
  console.log("final: ", await semearDemo(ORG, USER));

  console.log("\nOK — tudo passou");
}

main().catch((e) => {
  console.error("\nFALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
