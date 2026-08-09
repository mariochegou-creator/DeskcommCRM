/**
 * Aplica UMA migration no Supabase do CRM.
 *
 * POR QUE ISTO EXISTE: o `aplicar-schema-nexo.mjs` da raiz aplica o baseline
 * inteiro (360 KB, banco novo). Para uma migration solta o caminho até hoje era
 * colar no SQL Editor na mão — funciona, mas não deixa rastro de que rodou e é
 * fácil colar duas vezes. Aqui a migration roda numa transação (falhou, desfaz
 * tudo) e é registrada em supabase_migrations.schema_migrations, então rodar de
 * novo por engano só imprime "já aplicada" e sai.
 *
 * COMO USAR (PowerShell, na pasta do projeto):
 *   node scripts/aplicar-migration.mjs supabase/migrations/<arquivo>.sql
 *
 * Precisa de SUPABASE_DB_URL no .env.local (Session pooler, porta 5432) — a
 * mesma variável que o aplicar-schema-nexo.mjs usa.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve } from "node:path";

import pg from "pg";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const cor = { reset: "\x1b[0m", ok: "\x1b[32m", erro: "\x1b[31m", info: "\x1b[36m", aviso: "\x1b[33m" };
const log = (m) => console.log(`${cor.info}▶${cor.reset} ${m}`);
const ok = (m) => console.log(`${cor.ok}✓${cor.reset} ${m}`);
const aviso = (m) => console.log(`${cor.aviso}!${cor.reset} ${m}`);
const morrer = (m) => {
  console.error(`\n${cor.erro}✗ ${m}${cor.reset}\n`);
  process.exit(1);
};

function lerEnv(chave) {
  let texto;
  try {
    texto = readFileSync(join(raiz, ".env.local"), "utf8");
  } catch {
    return "";
  }
  for (const linha of texto.split(/\r?\n/)) {
    const corte = linha.indexOf("=");
    if (corte === -1 || linha.trimStart().startsWith("#")) continue;
    if (linha.slice(0, corte).trim() !== chave) continue;
    return linha.slice(corte + 1).trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

const arquivo = process.argv[2];
if (!arquivo) {
  morrer("Falta o caminho da migration.\n\n  node scripts/aplicar-migration.mjs supabase/migrations/<arquivo>.sql");
}

const caminho = resolve(raiz, arquivo);
let sql;
try {
  sql = readFileSync(caminho, "utf8");
} catch {
  morrer(`Não achei o arquivo: ${caminho}`);
}

// Nome do arquivo = <versao>_<resto>.sql — a versão é o que vai pro registro.
const nome = basename(caminho, ".sql");
const versao = nome.split("_")[0];
if (!/^\d+$/.test(versao)) {
  morrer(`O nome do arquivo precisa começar com a versão numérica. Recebi: ${nome}`);
}

const urlBanco = process.env.SUPABASE_DB_URL || lerEnv("SUPABASE_DB_URL");
if (!urlBanco) {
  morrer(
    "SUPABASE_DB_URL não está no .env.local.\n\n" +
      "  Supabase → Connect → Connection string → URI (Session pooler, porta 5432)",
  );
}

const cliente = new pg.Client({ connectionString: urlBanco, ssl: { rejectUnauthorized: false } });

try {
  log(`Conectando ao banco…`);
  await cliente.connect();

  // O registro do Supabase CLI pode não existir: este banco foi montado pelo
  // baseline direto (aplicar-schema-nexo.mjs), não por `supabase db push`.
  // Criar aqui é o mesmo DDL que o CLI usa — se um dia o CLI entrar, encaixa.
  await cliente.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);

  const jaFoi = await cliente.query(
    "select 1 from supabase_migrations.schema_migrations where version = $1",
    [versao],
  );
  if (jaFoi.rowCount > 0) {
    aviso(`A migration ${versao} já está aplicada neste banco. Nada a fazer.`);
    process.exit(0);
  }

  log(`Aplicando ${nome}…`);
  // Transação explícita: a migration e o registro entram juntos ou nenhum entra.
  await cliente.query("begin");
  await cliente.query(sql);
  await cliente.query(
    "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
    [versao, nome.slice(versao.length + 1)],
  );
  await cliente.query("commit");

  ok(`Migration ${versao} aplicada.`);
} catch (err) {
  try {
    await cliente.query("rollback");
  } catch {
    // conexão já caiu — o banco desfez sozinho
  }
  morrer(`Falhou (nada foi gravado): ${err.message}`);
} finally {
  await cliente.end().catch(() => {});
}
