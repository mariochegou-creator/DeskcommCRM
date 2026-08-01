/**
 * Aplica o schema do DeskcommCRM no Supabase — NEXO IA.
 *
 * POR QUE ISTO EXISTE: o supabase/baseline.sql (360 KB) não pode ser colado no
 * SQL Editor da Supabase. O editor divide o texto em comandos por conta própria
 * e se perde com os blocos aninhados ($$, $fn$, $body$, $seed$, $mig$), quebrando
 * corpos de função no meio — daí erros como `relation "v_agent" does not exist`,
 * onde v_agent é uma variável interna. Também não preserva o
 * `SET check_function_bodies = false` da primeira linha do arquivo.
 *
 * A documentação do projeto aplica via psql. Esta máquina não tem psql, mas o
 * projeto já depende de `pg` — então mandamos o arquivo inteiro numa única query
 * e deixamos o PRÓPRIO POSTGRES fazer o parse, que é o que o psql faz.
 *
 * Bônus: query múltipla roda numa transação implícita. Se qualquer comando
 * falhar, o banco desfaz tudo — nunca fica pela metade.
 *
 * COMO USAR:
 *   1. Coloque SUPABASE_DB_URL no .env.local (ver SETUP.md, passo 3)
 *   2. node aplicar-schema-nexo.mjs
 *
 * Se o banco já tem coisa de tentativa anterior:
 *      node aplicar-schema-nexo.mjs --limpar
 *   Apaga TUDO e recria do zero. Só use em banco de teste.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const raiz = dirname(fileURLToPath(import.meta.url));

const cor = {
  reset: "\x1b[0m",
  ok: "\x1b[32m",
  erro: "\x1b[31m",
  info: "\x1b[36m",
  aviso: "\x1b[33m",
};
const log = (m) => console.log(`${cor.info}▶${cor.reset} ${m}`);
const ok = (m) => console.log(`${cor.ok}✓${cor.reset} ${m}`);
const aviso = (m) => console.log(`${cor.aviso}!${cor.reset} ${m}`);
const morrer = (m) => {
  console.error(`\n${cor.erro}✗ ${m}${cor.reset}\n`);
  process.exit(1);
};

// ── Lê SUPABASE_DB_URL do .env.local ────────────────────────────────────────
function lerEnv(chave) {
  let texto;
  try {
    texto = readFileSync(join(raiz, ".env.local"), "utf8");
  } catch {
    morrer("Não achei o arquivo .env.local. Ele deveria estar em " + raiz);
  }
  for (const linha of texto.split(/\r?\n/)) {
    const corte = linha.indexOf("=");
    if (corte === -1 || linha.trimStart().startsWith("#")) continue;
    if (linha.slice(0, corte).trim() !== chave) continue;
    return linha
      .slice(corte + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return "";
}

const urlBanco = process.env.SUPABASE_DB_URL || lerEnv("SUPABASE_DB_URL");

if (!urlBanco) {
  morrer(
    `SUPABASE_DB_URL está vazia no .env.local.

  Onde pegar:
    Supabase → botão Connect (no topo) → aba "Connection string" → URI

  Use a opção "Session pooler" (porta 5432). A "Transaction pooler"
  (porta 6543) não serve para criar tabelas.

  Troque [YOUR-PASSWORD] pela senha do banco que você guardou ao criar
  o projeto, e cole no .env.local assim:

    SUPABASE_DB_URL=postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`,
  );
}

if (urlBanco.includes("[YOUR-PASSWORD]") || urlBanco.includes("[SUA-SENHA]")) {
  morrer(
    "A SUPABASE_DB_URL ainda tem o texto [YOUR-PASSWORD].\n" +
      "  Troque pela senha real do banco (a que você guardou ao criar o projeto).",
  );
}

if (urlBanco.includes(":6543")) {
  aviso(
    "A URL usa a porta 6543 (Transaction pooler), que não suporta criar tabelas.\n" +
      "  Se falhar, troque para a URL do Session pooler (porta 5432).",
  );
}

// ── Os passos, em ordem ─────────────────────────────────────────────────────
const LIMPAR = process.argv.includes("--limpar");

const PASSO_LIMPEZA = {
  nome: "APAGANDO tudo do banco (--limpar)",
  sql: `
    -- Zera o schema public inteiro. O baseline recria dono e grants.
    drop schema if exists public cascade;
    create schema public;
    alter schema public owner to pg_database_owner;
    grant usage on schema public to postgres, anon, authenticated, service_role;

    -- As policies de storage do fim do baseline são criadas SEM
    -- "drop if exists" — sobreviveriam ao drop do schema public (moram em
    -- storage.objects) e fariam a re-aplicação falhar com "policy já existe".
    drop policy if exists "tenant_read_ai_policy"     on storage.objects;
    drop policy if exists "tenant_write_ai_policy"    on storage.objects;
    drop policy if exists "tenant_delete_ai_policy"   on storage.objects;
    drop policy if exists "tenant_read_lgpd_exports"  on storage.objects;
    drop policy if exists "skill_assets_read"         on storage.objects;
  `,
};

const PASSOS = [
  ...(LIMPAR ? [PASSO_LIMPEZA] : []),
  {
    nome: "extensões (vector, citext, pg_trgm)",
    sql: `
      do $preparo$
      declare
        ext          text;
        schema_atual text;
      begin
        foreach ext in array array['vector', 'citext', 'pg_trgm']
        loop
          select n.nspname into schema_atual
            from pg_extension e
            join pg_namespace n on n.oid = e.extnamespace
           where e.extname = ext;

          if schema_atual is null then
            execute format('create extension %I with schema public', ext);
          elsif schema_atual <> 'public' then
            execute format('alter extension %I set schema public', ext);
          end if;

          schema_atual := null;
        end loop;
      end
      $preparo$;
      create extension if not exists pgcrypto with schema extensions;
    `,
  },
  {
    nome: "schema completo (94 tabelas) — pode levar 1 a 3 minutos",
    arquivo: join(raiz, "supabase", "baseline.sql"),
  },
  {
    nome: "correções de segurança (search_path das funções privilegiadas)",
    sql: `
      do $seguranca$
      declare
        fn    record;
        total int := 0;
      begin
        for fn in
          select p.oid::regprocedure as assinatura
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.prosecdef
             and not exists (
               select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
                where cfg like 'search\\_path=%'
             )
           order by 1
        loop
          execute format(
            'alter function %s set search_path = public, extensions, pg_temp',
            fn.assinatura
          );
          total := total + 1;
        end loop;
        raise notice 'funcoes protegidas: %', total;
      end
      $seguranca$;
    `,
  },
];

// ── Execução ────────────────────────────────────────────────────────────────
const cliente = new pg.Client({
  connectionString: urlBanco,
  ssl: { rejectUnauthorized: false },
  // O baseline é grande e cria índices; sem folga o servidor corta no meio.
  statement_timeout: 0,
  query_timeout: 0,
  connectionTimeoutMillis: 30_000,
});

cliente.on("notice", (n) => {
  if (n.message) console.log(`   ${n.message}`);
});

try {
  log("conectando no banco");
  await cliente.connect();
  ok("conectado");

  for (const passo of PASSOS) {
    log(passo.nome);
    const sql = passo.arquivo ? readFileSync(passo.arquivo, "utf8") : passo.sql;
    await cliente.query(sql);
    ok(passo.nome);
  }

  // ── Conferência ───────────────────────────────────────────────────────────
  const { rows } = await cliente.query(`
    select
      (select count(*) from pg_tables where schemaname = 'public')      as tabelas,
      (select count(*) from pg_policies where schemaname = 'public')    as policies,
      (select count(*)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
             where cfg like 'search\\_path=%'
          ))                                                            as desprotegidas
  `);

  const r = rows[0];
  console.log(`
${cor.ok}╭──────────────────────────────────────────────╮
│  Banco pronto                                │
╰──────────────────────────────────────────────╯${cor.reset}

  tabelas criadas          ${r.tabelas}
  regras de acesso (RLS)   ${r.policies}
  funções desprotegidas    ${r.desprotegidas}  ${r.desprotegidas === "0" ? cor.ok + "OK" + cor.reset : cor.erro + "CORRIGIR" + cor.reset}

  Próximo passo:  pnpm dev   →   http://localhost:3000
`);

  if (r.desprotegidas !== "0") {
    morrer("Sobraram funções desprotegidas. Me chame antes de usar com dado real.");
  }
} catch (erro) {
  console.error(`\n${cor.erro}✗ falhou${cor.reset}`);
  console.error(`  ${erro.message}`);
  if (erro.position) console.error(`  posição no SQL: ${erro.position}`);
  if (erro.detail) console.error(`  detalhe: ${erro.detail}`);
  if (erro.hint) console.error(`  dica: ${erro.hint}`);
  console.error(
    `\n  Nada foi gravado — o banco desfaz tudo quando um comando falha.\n` +
      `  Corrija e rode de novo, ou me mande esta mensagem.\n`,
  );
  process.exit(1);
} finally {
  await cliente.end().catch(() => {});
}
