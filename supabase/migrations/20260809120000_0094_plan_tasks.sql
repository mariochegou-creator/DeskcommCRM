-- 0094 — plan_tasks: as tarefas PONTUAIS do plano de vendas de 60 dias
--
-- A NEXO roda um plano comercial com data de início e fim (10/08 → 09/10/2026,
-- constantes em lib/plan/sixty-day-plan.ts). O Painel ganha a seção "// plano
-- 60 dias" e um cron manda o resumo bom-dia às 8h30 por WhatsApp. Esta tabela
-- guarda SÓ o que é marcável: tarefa pontual com dono e (às vezes) prazo.
--
-- ⚠️ O QUE FICOU FORA, DE PROPÓSITO:
--   · Rotina diária ("40 aberturas") não vira linha — se cumpriu, quem responde
--     é fn_prospecting_metrics; checkbox de rotina é autoengano com UI.
--   · Checkpoints e metas não viram linha — checkpoint é regra sobre métrica
--     com data; duplicar a meta aqui criaria duas fontes pro mesmo número.
--   · Recorrência não existe: tarefa que "volta" é rotina, ver acima.
--
-- ⚠️ NUMERAÇÃO: 0094 segue a sequência do fork nexo-ia (0093 local já colide
-- de propósito com o 0093 do upstream origin/main, que vai até 0138). Merge
-- futuro do upstream renumera — decisão consciente, mesmo racional da 0093.
--
-- A unique (organization_id, plan_key, slug) é CONSTRAINT, não índice parcial:
-- ela é o alvo do upsert onConflict do seed (scripts/seed-plano-60-dias.ts) —
-- re-rodar o seed atualiza título/dono/prazo sem duplicar nem resetar status.
--
-- Fora da publicação realtime: o Painel lê via React Query com invalidate na
-- mutação; publicar sem consumidor é a inversão que o teste da 0078 impede.

create table if not exists public.plan_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_key text not null,
  slug text not null,
  title text not null,
  description text,
  phase int not null default 0,
  owner text not null,
  -- Dia CIVIL (America/Bahia) do prazo. `date` e não timestamptz de propósito:
  -- "até sexta" é uma data no calendário do Mario, não um instante — timestamptz
  -- aqui produziria tarefa vencendo às 21h de quinta por causa do fuso.
  due_date date,
  position int not null default 0,
  status text not null default 'pending',
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.plan_tasks is
  'Tarefas PONTUAIS do plano comercial de 60 dias (lib/plan/sixty-day-plan.ts). Rotina diária e metas são constantes de código — recorrente não vira linha marcável, a métrica já mede. Seed idempotente por (organization_id, plan_key, slug).';
comment on column public.plan_tasks.due_date is
  'Dia civil America/Bahia, sem hora: prazo é data de calendário, não instante.';

alter table public.plan_tasks drop constraint if exists plan_tasks_status_check;
alter table public.plan_tasks add constraint plan_tasks_status_check
  check (status = any (array['pending', 'done', 'skipped']::text[]));

alter table public.plan_tasks drop constraint if exists plan_tasks_owner_check;
alter table public.plan_tasks add constraint plan_tasks_owner_check
  check (owner = any (array['mario', 'david', 'dupla', 'claude']::text[]));

alter table public.plan_tasks drop constraint if exists plan_tasks_phase_check;
alter table public.plan_tasks add constraint plan_tasks_phase_check
  check (phase between 0 and 3);

-- Mesma regra da "decisão datada" da 0082: sair de pending exige carimbo,
-- voltar a pending limpa — status resolvido sem data não sabe contar quando.
alter table public.plan_tasks drop constraint if exists plan_tasks_resolucao_datada;
alter table public.plan_tasks add constraint plan_tasks_resolucao_datada check (
  (status = 'pending' and resolved_at is null)
  or (status <> 'pending' and resolved_at is not null)
);

alter table public.plan_tasks drop constraint if exists plan_tasks_org_plan_slug_unique;
alter table public.plan_tasks add constraint plan_tasks_org_plan_slug_unique
  unique (organization_id, plan_key, slug);

-- A seção lista por plano na ordem do quadro; o cron filtra pendentes com prazo.
create index if not exists idx_plan_tasks_org_plan_status
  on public.plan_tasks (organization_id, plan_key, status, due_date);

alter table public.plan_tasks enable row level security;

drop policy if exists tenant_isolation_plan_tasks_all on public.plan_tasks;
create policy tenant_isolation_plan_tasks_all on public.plan_tasks
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

-- Carimbos do BANCO, nunca do processo (lição da 0081: dois relógios derivam).
create or replace function public.fn_carimba_plan_task()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end$function$;

drop trigger if exists trg_plan_tasks_carimbo on public.plan_tasks;
create trigger trg_plan_tasks_carimbo
  before insert or update on public.plan_tasks
  for each row
  execute function public.fn_carimba_plan_task();
