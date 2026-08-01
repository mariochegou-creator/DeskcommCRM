/** Chama contarDemo exatamente como a página chama, pra ver o que ela devolve. */
import * as fs from "node:fs";

async function main() {
  for (const l of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }

  const { contarDemo } = await import("./lib/nexo-demo/seed");
  const { createAdminClient } = await import("./lib/supabase/admin");
  const admin = createAdminClient();

  const { data: orgs } = await admin.from("organizations").select("id, display_name");
  for (const o of orgs ?? []) {
    console.log(`\norg ${o.display_name} (${o.id})`);
    console.log("  contarDemo ->", await contarDemo(o.id as string));

    const { data: brutos, count } = await admin
      .from("crm_leads")
      .select("id, source", { count: "exact" })
      .eq("organization_id", o.id);
    console.log(`  crm_leads total: ${count}`);
    const porFonte: Record<string, number> = {};
    for (const l of brutos ?? []) porFonte[l.source as string] = (porFonte[l.source as string] ?? 0) + 1;
    console.log("  por source:", porFonte);
  }
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
