/** Teste rápido de conexão com o banco — não altera nada. */
import { readFileSync } from "node:fs";
import pg from "pg";

const texto = readFileSync(new URL(".env.local", import.meta.url), "utf8");
const linha = texto.split(/\r?\n/).find((l) => l.startsWith("SUPABASE_DB_URL="));
const url = (linha ?? "").slice("SUPABASE_DB_URL=".length).trim();

if (!url) {
  console.log("SUPABASE_DB_URL está vazia no .env.local");
  process.exit(1);
}

console.log("tentando:", url.replace(/\/\/[^@]*@/, "//***:***@"));

const cliente = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await cliente.connect();
  const info = await cliente.query(
    "select current_database() as db, current_user as usr, count(*) as tabelas from pg_tables where schemaname = 'public'",
  );
  const r = info.rows[0];
  console.log(`\n✓ CONECTOU`);
  console.log(`  banco:            ${r.db}`);
  console.log(`  usuário:          ${r.usr}`);
  console.log(`  tabelas em public: ${r.tabelas}`);
} catch (e) {
  console.log(`\n✗ FALHOU  [${e.code ?? "sem código"}]`);
  console.log(`  ${e.message}`);
} finally {
  await cliente.end().catch(() => {});
}
