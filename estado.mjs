/** Estado atual do ambiente de teste. Só lê — não altera nada. */
import { readFileSync } from "node:fs";
import pg from "pg";

for (const l of readFileSync(new URL(".env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

const PERGUNTAS = [
  ["tabelas no banco", "select count(*) n from pg_tables where schemaname='public'"],
  ["regras de acesso", "select count(*) n from pg_policies where schemaname='public'"],
  [
    "funções desprotegidas",
    `select count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.prosecdef and not exists (
       select 1 from unnest(coalesce(p.proconfig,'{}')) cfg where cfg like 'search\\_path=%')`,
  ],
  ["usuários ativos", "select count(*) n from user_organizations where revoked_at is null"],
  ["organizações", "select count(*) n from organizations"],
  ["negócios (demo)", "select count(*) n from crm_leads where source='nexo-demo'"],
  ["contatos (demo)", "select count(*) n from contacts where source='nexo-demo'"],
  ["histórico (demo)", "select count(*) n from crm_lead_activities where source_module='nexo-demo'"],
  ["pontuações", "select count(*) n from crm_lead_scores"],
  ["estados de risco", "select count(*) n from crm_lead_risk_states"],
  ["propostas pendentes", "select count(*) n from crm_lead_reactivations where status='pending'"],
  ["mensagens", "select count(*) n from messages"],
];

try {
  await c.connect();
  console.log("banco: CONECTADO\n");
  for (const [rotulo, sql] of PERGUNTAS) {
    const { rows } = await c.query(sql);
    console.log(`  ${rotulo.padEnd(24)} ${rows[0].n}`);
  }
} catch (e) {
  console.log("banco: FALHOU —", e.message);
} finally {
  await c.end().catch(() => {});
}
