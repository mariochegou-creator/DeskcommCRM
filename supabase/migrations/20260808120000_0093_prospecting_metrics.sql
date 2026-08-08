-- 0093_prospecting_metrics — métricas de prospecção do Painel (seção "// prospecção").
--
-- Uma chamada única agrega, para o funil de prospecção do tenant:
--   · funnel: quantos leads ENTRARAM em cada etapa na janela (fluxo) + abertos
--     agora (estoque) — a passagem por etapa (e "chegou na R1/R2") deriva daqui;
--   · response: taxa de resposta da coorte contatada pela 1ª vez na janela;
--   · followup: enrollments vivos por dia de cadência (D2/D5/D9/D14) + "no
--     vácuo" (terminou a cadência sem responder).
--
-- Mesma estratégia de escopo da 0037 (fn_attendant_metrics): SECURITY INVOKER
-- (default) — a RLS de crm_leads/crm_lead_activities/messages/followup_enrollments
-- se aplica DENTRO da função. agent agregando ⇒ colapsa ao que pode ver; nunca
-- cross-tenant: organization_id = p_org resolvido de fonte confiável na rota.
--
-- Decisões que não são óbvias pelo código:
--   · "Entrou na etapa" = stage_changed com destino nela MAIS leads NASCIDOS
--     nela dentro da janela (lead criado direto numa etapa não tem
--     stage_changed). O payload existe em DOIS dialetos — {from_stage_id,
--     to_stage_id} das rotas HTTP e {de, para} do agent-stage-sync — e o
--     coalesce lê ambos; sem ele todo movimento feito pela IA sumiria do
--     funil. count sobre UNION de lead_id ⇒ distinct de graça, imune à
--     emissão dupla rota+sync.
--   · Taxa de resposta INCLUI outbound da IA (sent_by_user_id null): os toques
--     da cadência anti-vácuo são enviados pela IA e SÃO a prospecção — o
--     oposto deliberado do filtro humano da 0037 (§6.6). Respondeu = existe
--     inbound DEPOIS do primeiro outbound (max(inbound) > min(outbound)).
--   · "No vácuo" = o enrollment MAIS RECENTE do contato terminou 'exhausted'
--     E não há enrollment vivo — exausto que reentrou na cadência não conta.
--
-- Janela semiaberta [from,to). p_prev_* null ⇒ campos *_prev voltam null
-- (o pill de variação some em vez de mentir com base zero).
--
-- Idempotente (create index if not exists / create or replace), portável em
-- psql puro (sem BEGIN/COMMIT, sem temp tables).

-- Coorte de resposta: min/max de sent_at por (org, contato, direção). Sem este
-- índice cada contato da coorte custaria um scan inteiro de messages; o parcial
-- exclui mensagens sem contato (grupos), que a métrica nunca lê.
create index if not exists idx_messages_org_contact_dir_sent
  on public.messages (organization_id, contact_id, direction, sent_at)
  where contact_id is not null;

create or replace function public.fn_prospecting_metrics(
  p_org uuid,
  p_pipeline uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz default null,
  p_prev_to timestamptz default null
) returns jsonb
language sql stable
set search_path = public
as $$
  with
  sts as (
    select id, name, slug, position, is_won, is_lost
    from public.crm_stages
    where organization_id = p_org
      and pipeline_id = p_pipeline
      and is_archived = false
  ),
  pl as (
    select id, contact_id, stage_id, status, created_at
    from public.crm_leads
    where organization_id = p_org
      and pipeline_id = p_pipeline
  ),
  -- Histórico de etapa nos DOIS dialetos de payload (ids comparados como texto).
  moves as (
    select
      a.lead_id,
      a.performed_at,
      coalesce(a.payload->>'to_stage_id',   a.payload->>'para') as to_stage,
      coalesce(a.payload->>'from_stage_id', a.payload->>'de')   as from_stage
    from public.crm_lead_activities a
    join pl on pl.id = a.lead_id
    where a.organization_id = p_org
      and a.type = 'stage_changed'
  ),
  -- Etapa de NASCIMENTO: from_stage do movimento mais antigo; lead que nunca se
  -- moveu nasceu na etapa atual.
  births as (
    select pl.id as lead_id, pl.created_at,
           coalesce(fm.from_stage, pl.stage_id::text) as birth_stage
    from pl
    left join lateral (
      select m.from_stage
      from moves m
      where m.lead_id = pl.id and m.from_stage is not null
      order by m.performed_at asc
      limit 1
    ) fm on true
  ),
  -- Coorte da taxa de resposta: por CONTATO (um contato com dois leads conta
  -- uma vez), restrita a quem tem lead neste funil.
  cohort as (
    select distinct contact_id from pl where contact_id is not null
  ),
  resp as (
    select ct.contact_id, f.first_out, f.last_in
    from cohort ct
    cross join lateral (
      select
        min(m.sent_at) filter (where m.direction = 'outbound') as first_out,
        max(m.sent_at) filter (where m.direction = 'inbound')  as last_in
      from public.messages m
      where m.organization_id = p_org
        and m.contact_id = ct.contact_id
    ) f
    where f.first_out is not null
  ),
  fu as (
    select e.contact_id, e.status, e.outcome, e.current_node_id, e.started_at
    from public.followup_enrollments e
    join cohort ct on ct.contact_id = e.contact_id
    where e.organization_id = p_org
  ),
  -- Dia da cadência extraído do nó (envia_d2/espera_d2 → D2); nó sem dia cai
  -- em 'outros' — bucket visível é mais honesto que linha sumida.
  fu_live as (
    select coalesce(upper(substring(current_node_id from 'd[0-9]+')), 'outros') as day,
           count(*) as cnt
    from fu
    where status in ('active','waiting_reply','paused_handoff')
    group by 1
  ),
  fu_latest as (
    select distinct on (contact_id) contact_id, status, outcome
    from fu
    order by contact_id, started_at desc
  )
  select jsonb_build_object(
    'funnel', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'stage_id', s.id,
          'name', s.name,
          'slug', s.slug,
          'position', s.position,
          'is_won', s.is_won,
          'is_lost', s.is_lost,
          'entered', (
            select count(*) from (
              select m.lead_id from moves m
              where m.to_stage = s.id::text
                and m.performed_at >= p_from and m.performed_at < p_to
              union
              select b.lead_id from births b
              where b.birth_stage = s.id::text
                and b.created_at >= p_from and b.created_at < p_to
            ) e
          ),
          'entered_prev', case
            when p_prev_from is null or p_prev_to is null then null
            else (
              select count(*) from (
                select m.lead_id from moves m
                where m.to_stage = s.id::text
                  and m.performed_at >= p_prev_from and m.performed_at < p_prev_to
                union
                select b.lead_id from births b
                where b.birth_stage = s.id::text
                  and b.created_at >= p_prev_from and b.created_at < p_prev_to
              ) ep
            )
          end,
          'open_now', (
            select count(*) from pl
            where pl.stage_id = s.id and pl.status = 'open'
          )
        ) order by s.position, s.name
      )
      from sts s
    ), '[]'::jsonb),
    'response', jsonb_build_object(
      'contacted', (
        select count(*) from resp
        where first_out >= p_from and first_out < p_to
      ),
      'replied', (
        select count(*) from resp
        where first_out >= p_from and first_out < p_to
          and last_in > first_out
      ),
      'prev_contacted', case
        when p_prev_from is null or p_prev_to is null then null
        else (
          select count(*) from resp
          where first_out >= p_prev_from and first_out < p_prev_to
        )
      end,
      'prev_replied', case
        when p_prev_from is null or p_prev_to is null then null
        else (
          select count(*) from resp
          where first_out >= p_prev_from and first_out < p_prev_to
            and last_in > first_out
        )
      end
    ),
    'followup', jsonb_build_object(
      'live_total', coalesce((select sum(cnt) from fu_live), 0),
      'by_day', coalesce((
        select jsonb_agg(
          jsonb_build_object('day', day, 'count', cnt)
          order by case when day = 'outros' then 2147483647
                   else (substring(day from '[0-9]+'))::int end
        )
        from fu_live
      ), '[]'::jsonb),
      'vacuo', (
        select count(*) from fu_latest fl
        where fl.outcome = 'exhausted'
          and not exists (
            select 1 from fu l
            where l.contact_id = fl.contact_id
              and l.status in ('active','waiting_reply','paused_handoff')
          )
      )
    )
  );
$$;

revoke all on function public.fn_prospecting_metrics(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public;
revoke execute on function public.fn_prospecting_metrics(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz) from anon;
grant execute on function public.fn_prospecting_metrics(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;
