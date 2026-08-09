import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * O que a migration 0094 PROMETE, cobrado no banco que o CLONE recebe.
 *
 * A migration é o CAMINHO (quem já tem banco); o baseline é o DESTINO (quem
 * clona). Este arquivo lê o banco montado do baseline — migration sem apêndice
 * no baseline.sql falha AQUI, antes de falhar em produção de self-hoster.
 *
 * ⚠️ A unique é CONSTRAINT, não índice parcial, e isso é contrato de runtime:
 * ela é o alvo do `onConflict: "organization_id,plan_key,slug"` do
 * scripts/seed-plano-60-dias.ts. Índice parcial não serve de arbiter de
 * ON CONFLICT com essa lista de colunas — quem "simplificar" quebra o seed.
 *
 * ⚠️ plan_tasks fica FORA da publicação de realtime de propósito (padrão
 * crm_lead_scores, não crm_lead_risk_states): o Painel invalida a query na
 * mutação; publicar sem consumidor é a inversão que o teste da 0078 impede.
 */
describe("0094 · plan_tasks chega ao clone", () => {
  it("a tabela existe no baseline, não só na migration", () => {
    const n = sql(
      `select count(*) from information_schema.tables
        where table_schema = 'public' and table_name = 'plan_tasks'`,
    );
    expect(n).toBe("1");
  });

  it("as quatro travas de coerência estão lá, pelo nome", () => {
    const nomes = sql(
      `select conname from pg_constraint
        where conrelid = 'public.plan_tasks'::regclass and contype = 'c'`,
    ).split("\n");
    expect(nomes).toContain("plan_tasks_status_check");
    expect(nomes).toContain("plan_tasks_owner_check");
    expect(nomes).toContain("plan_tasks_phase_check");
    expect(nomes).toContain("plan_tasks_resolucao_datada");
  });

  it("a unique de idempotência do seed é CONSTRAINT (arbiter do onConflict)", () => {
    const n = sql(
      `select count(*) from pg_constraint
        where conrelid = 'public.plan_tasks'::regclass
          and contype = 'u'
          and conname = 'plan_tasks_org_plan_slug_unique'`,
    );
    expect(n).toBe("1");
  });

  it("RLS ligada e a policy de tenant existe", () => {
    expect(sql(`select relrowsecurity from pg_class where relname = 'plan_tasks'`)).toBe("t");
    expect(
      sql(`select count(*) from pg_policies
            where tablename = 'plan_tasks'
              and policyname = 'tenant_isolation_plan_tasks_all'`),
    ).toBe("1");
  });

  it("FORA da publicação de realtime — React Query invalida, ninguém assina", () => {
    const publicadas = sql(
      `select coalesce(string_agg(tablename, ','), '') from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'plan_tasks'`,
    );
    expect(publicadas).toBe("");
  });

  it("o índice da listagem por plano existe", () => {
    expect(
      sql(`select count(*) from pg_indexes
            where tablename = 'plan_tasks'
              and indexname = 'idx_plan_tasks_org_plan_status'`),
    ).toBe("1");
  });

  it("o trigger de carimbo do banco existe", () => {
    expect(
      sql(`select count(*) from pg_trigger
            where tgrelid = 'public.plan_tasks'::regclass
              and tgname = 'trg_plan_tasks_carimbo'`),
    ).toBe("1");
  });
});
