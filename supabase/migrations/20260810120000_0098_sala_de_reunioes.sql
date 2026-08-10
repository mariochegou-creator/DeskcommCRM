-- 0098 — Sala de Reuniões: o copiloto do Meet e o lastro dele no CRM
--
-- O Mario conduz as reuniões de venda (R1 = diagnóstico SPIN, R2 = proposta)
-- pelo Google Meet. Uma extensão do Chrome raspa as legendas nativas do Meet,
-- mostra num overlay a fase da conversa e a próxima pergunta, e manda os turnos
-- para o CRM. Esta migration cria o LASTRO: a reunião com transcrição e análise,
-- e o registro do que o copiloto sugeriu ao vivo.
--
-- DUAS tabelas, e a segunda existe de propósito:
--
--   · `crm_meetings` é o artefato com ciclo de vida (ao_vivo → encerrada →
--     analisando → concluida/falhou/concluida_sem_formato) — mesmo racional da
--     linhagem de ligações (fork feat/ligacoes-sdr): estado que evolui não mora em
--     `crm_lead_activities`, senão a timeline vira tabela de estado.
--
--   · `crm_meeting_suggestions` guarda O QUE o copiloto sugeriu e QUANDO. Sem
--     isso, a pergunta central do coaching — "ele seguiu o roteiro?" — não tem
--     resposta: a análise pós-reunião compara cada sugestão com o que o Mario
--     falou em seguida e carimba `was_followed`. Dentro do jsonb da reunião
--     seria impossível de consultar e agregar (% de sugestões seguidas é
--     métrica do Painel da sala).
--
-- AS DUAS FICAM FORA do `supabase_realtime` (razão 2 da linhagem de ligações: o pulso que
-- mente). A aba lê por React Query; a timeline do negócio pulsa UMA vez, quando
-- a análise conclui e vira atividade `reuniao_analisada`.
--
-- CHECKS entram em tudo que é vocabulário novo (status, meeting_type, outcome,
-- phase_detected): tabela nova não tem linha legada em clone nenhum — vocabulário
-- que dá pra fechar, fecha desde a primeira linha. Consequência assumida:
-- `lib/meetings/live-schema.ts` e `analysis-schema.ts` vivem sob o teste de
-- invariante de vocabulário banco×TypeScript.
--
-- ⚠️ NUMERAÇÃO: 0098 segue a sequência do fork nexo-ia (0093+ colide de
-- propósito com o upstream, que vai até 0138). Merge futuro renumera — mesma
-- decisão consciente registrada na 0093 e na 0094.
--
-- ⚠️ O QUE FICOU FORA, DE PROPÓSITO:
--   · Áudio. O copiloto transcreve pelas legendas do Meet — não existe binário,
--     logo não existe bucket. Se um dia a gravação entrar, ela ganha coluna e
--     fila de redação própria (lição do array separado da linhagem de ligações).
--   · R1/R2 como etapa de funil. `meeting_type` é atributo da reunião; o funil
--     do tenant continua sendo dele (`crm_stages`), sem semântica inventada.

-- ---------------------------------------------------------------------------
-- crm_meetings — a reunião: transcrição, resumo, notas e análise
-- ---------------------------------------------------------------------------

create table if not exists public.crm_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- `on delete set null` nos dois: perder o negócio (ou o contato) não pode
  -- apagar a reunião — a transcrição é registro do que foi conversado; o card é
  -- organização de funil. Cascade aqui seria o "cascade fantasma" da linhagem de ligações.
  -- Os dois são OPCIONAIS: o Mario pode iniciar a reunião sem escolher o
  -- negócio e vincular depois (PATCH) — obrigar o vínculo no início é como a
  -- reunião não seria registrada nenhuma vez.
  lead_id uuid references public.crm_leads(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  meeting_type text not null,
  status text not null default 'ao_vivo',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Código da sala (abc-defg-hij) — deduplica "iniciar" repetido na mesma sala
  -- e permite achar a reunião viva quando a extensão recarrega no meio.
  meet_code text,
  -- Turnos [{ speaker, is_self, text, t }] — `t` em segundos desde started_at.
  -- Jsonb e não tabela de turnos: o turno não tem ciclo de vida próprio, nunca
  -- é editado individualmente, e a leitura é sempre a transcrição inteira.
  transcript jsonb not null default '[]'::jsonb,
  -- Promovido do jsonb porque a LISTA da aba mostra "quantos turnos" sem
  -- carregar a transcrição inteira (que passa fácil de 100KB numa hora de call).
  turn_count int not null default 0,
  summary text,
  notes text,
  outcome text,
  -- Nota geral 0-10 promovida de spin_scores pela mesma razão do score da linhagem de ligações:
  -- é o que a lista ordena e a métrica agrega. numeric(3,1) aceita 10.0.
  score numeric(3, 1),
  spin_scores jsonb,
  coaching jsonb,
  -- Memória do copiloto ENTRE chamadas ao vivo (fase atual estimada, checklist
  -- de cobertura). Efêmero por natureza — zerado no encerramento e na LGPD.
  live_state jsonb not null default '{}'::jsonb,
  analysis_error text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_meetings is
  'Reuniao de venda conduzida no Google Meet com o copiloto SPIN (extensao Chrome). Tabela propria e FORA do realtime de proposito - mesmo racional da tabela de ligacoes do fork feat/ligacoes-sdr: a atividade na timeline e o acontecimento, esta linha e o artefato com ciclo de vida. Transcricao vem das legendas do Meet, nao ha audio.';

comment on column public.crm_meetings.status is
  'Onde o pipeline esta. ao_vivo = extensao mandando turnos; encerrada = acabou sem nada para analisar (transcricao vazia); analisando = worker de analise a caminho; concluida_sem_formato = o modelo nao devolveu JSON valido nem no retry - o texto cru fica em coaching->>raw e a pessoa le mesmo assim.';

comment on column public.crm_meetings.transcript is
  'Turnos da conversa [{speaker, is_self, text, t}]. PII DENSA: e a conversa do lead palavra por palavra. Zerada pela cascata LGPD (fn_lgpd_cascade_redact_contact) junto com summary, notes, spin_scores, coaching e live_state.';

comment on column public.crm_meetings.outcome is
  'O que a reuniao produziu, na taxonomia de Rackham (skill r2): pedido, avanco, continuacao, nao_venda. Espelha lib/meetings/analysis-schema.ts - o CHECK e o TypeScript tem de concordar (invariante de vocabulario).';

comment on column public.crm_meetings.live_state is
  'Memoria do copiloto entre chamadas de live-suggest (fase estimada + cobertura do checklist). Evita reenviar a transcricao inteira a cada sugestao. Efemero: zerado ao encerrar.';

alter table public.crm_meetings drop constraint if exists crm_meetings_type_check;
alter table public.crm_meetings add constraint crm_meetings_type_check
  check (meeting_type = any (array['r1', 'r2']::text[]));

alter table public.crm_meetings drop constraint if exists crm_meetings_status_check;
alter table public.crm_meetings add constraint crm_meetings_status_check
  check (status = any (array[
    'ao_vivo', 'encerrada', 'analisando',
    'concluida', 'concluida_sem_formato', 'falhou'
  ]::text[]));

alter table public.crm_meetings drop constraint if exists crm_meetings_outcome_check;
alter table public.crm_meetings add constraint crm_meetings_outcome_check
  check (
    outcome is null
    or outcome = any (array['pedido', 'avanco', 'continuacao', 'nao_venda']::text[])
  );

alter table public.crm_meetings drop constraint if exists crm_meetings_score_range;
alter table public.crm_meetings add constraint crm_meetings_score_range
  check (score is null or (score >= 0 and score <= 10));

-- Encerramento datado (mesma regra da "decisão datada" da 0082/0094): só a
-- reunião ao vivo pode não ter fim; qualquer estado depois do encerramento
-- carrega `ended_at`, senão a duração — insumo das métricas — não existe.
alter table public.crm_meetings drop constraint if exists crm_meetings_encerramento_datado;
alter table public.crm_meetings add constraint crm_meetings_encerramento_datado
  check (status = 'ao_vivo' or ended_at is not null);

-- ---- tenancy ----
alter table public.crm_meetings enable row level security;

drop policy if exists tenant_isolation_crm_meetings_all on public.crm_meetings;
create policy tenant_isolation_crm_meetings_all on public.crm_meetings
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

-- A lista da aba ordena por início, mais recente primeiro.
create index if not exists idx_crm_meetings_org_started
  on public.crm_meetings (organization_id, started_at desc);

create index if not exists idx_crm_meetings_org_lead
  on public.crm_meetings (organization_id, lead_id);

-- Parcial: "existe reunião viva nesta sala?" é a pergunta da extensão ao
-- reconectar, e reuniões vivas são pouquíssimas por definição.
create index if not exists idx_crm_meetings_ao_vivo
  on public.crm_meetings (organization_id, meet_code)
  where status = 'ao_vivo';

-- Carimbos do BANCO, nunca do processo (lição da 0081: dois relógios derivam).
create or replace function public.fn_carimba_meeting()
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

drop trigger if exists trg_crm_meetings_carimbo on public.crm_meetings;
create trigger trg_crm_meetings_carimbo
  before insert or update on public.crm_meetings
  for each row
  execute function public.fn_carimba_meeting();

-- FORA da publicação de realtime — remover é defensivo, corrige clone que a
-- tenha publicado por engano (mesmo bloco da linhagem de ligações).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'crm_meetings'
  ) then
    execute 'alter publication supabase_realtime drop table public.crm_meetings';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- crm_meeting_suggestions — o que o copiloto disse ao Mario, e quando
-- ---------------------------------------------------------------------------

create table if not exists public.crm_meeting_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Cascade DE PROPÓSITO (ao contrário dos FKs da reunião): a sugestão só faz
  -- sentido dentro da reunião que a gerou — sugestão órfã não é prova de nada.
  meeting_id uuid not null references public.crm_meetings(id) on delete cascade,
  -- Segundos desde started_at — mesmo relógio do `t` dos turnos, para a análise
  -- alinhar "sugeri isto" com "ele falou aquilo logo depois".
  at_seconds numeric not null,
  phase_detected text not null,
  suggestion text not null,
  alert text,
  -- null = análise ainda não rodou. Preenchido pelo worker pós-reunião, que
  -- compara a sugestão com os turnos is_self seguintes.
  was_followed boolean,
  created_at timestamptz not null default now()
);

comment on table public.crm_meeting_suggestions is
  'Cada sugestao que o copiloto exibiu ao vivo no overlay do Meet. Existe para o coaching medir "seguiu o roteiro?" - a analise pos-reuniao carimba was_followed comparando a sugestao com os turnos seguintes do proprio Mario. Fora do realtime, mesma razao da tabela mae.';

comment on column public.crm_meeting_suggestions.phase_detected is
  'Fase que o classificador enxergou no momento da sugestao. Vocabulario fechado espelhando lib/meetings/live-schema.ts (invariante banco x TypeScript): fases SPIN da R1 + fases de Pits da R2.';

alter table public.crm_meeting_suggestions drop constraint if exists crm_meeting_suggestions_phase_check;
alter table public.crm_meeting_suggestions add constraint crm_meeting_suggestions_phase_check
  check (phase_detected = any (array[
    'abertura',
    'situacao', 'problema', 'implicacao', 'necessidade',
    'diagnostico', 'objecoes', 'pit1', 'extracao', 'pit2',
    'fechamento'
  ]::text[]));

alter table public.crm_meeting_suggestions drop constraint if exists crm_meeting_suggestions_at_seconds_nao_negativo;
alter table public.crm_meeting_suggestions add constraint crm_meeting_suggestions_at_seconds_nao_negativo
  check (at_seconds >= 0);

-- ---- tenancy ----
alter table public.crm_meeting_suggestions enable row level security;

drop policy if exists tenant_isolation_crm_meeting_suggestions_all on public.crm_meeting_suggestions;
create policy tenant_isolation_crm_meeting_suggestions_all on public.crm_meeting_suggestions
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

-- A análise lê as sugestões na ordem em que apareceram.
create index if not exists idx_crm_meeting_suggestions_meeting
  on public.crm_meeting_suggestions (meeting_id, at_seconds);

do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'crm_meeting_suggestions'
  ) then
    execute 'alter publication supabase_realtime drop table public.crm_meeting_suggestions';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- LGPD — as tabelas novas entram no cascade de anonimização NO MESMO ARQUIVO
-- que as cria (regra da 0071, reafirmada na linhagem de ligações: separar é como a regra de
-- apagamento nunca acontece). `transcript` não é campo que "pode conter" dado
-- pessoal — é a conversa inteira do titular, palavra por palavra.
--
-- Corpo IDÊNTICO ao vigente (extraído do baseline deste repo, não redigitado —
-- este fork NÃO tem crm_call_recordings, então o bloco 4b daqui é o de
-- reuniões) + os blocos 4b/4c e os contadores novos.
--
-- Sem fila de storage nova: reunião não tem binário (transcrição vem das
-- legendas do Meet), então não há objeto de bucket para enfileirar.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"("p_organization_id" "uuid", "p_contact_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_anon_label text;
  v_count int;
begin
  select is_anonymized into v_already
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_already then
    return jsonb_build_object('already_anonymized', true, 'counts', v_counts, 'media_paths', v_media_paths);
  end if;

  v_anon_label := 'Cliente Anonimizado #' || substring(p_contact_id::text from 1 for 8);

  -- Collect media storage paths (we only delete what we own — media_storage_path)
  select coalesce(array_agg(distinct media_storage_path) filter (where media_storage_path is not null), '{}')
    into v_media_paths
    from messages
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      );

  -- 1. contacts (irreversible)
  update contacts set
    name = v_anon_label,
    display_name = v_anon_label,
    email = null,
    -- email_normalized NÃO entra: é GENERATED ALWAYS AS (lower(trim(email)))
    -- e o Postgres recusa escrita nela — a linha acima já a zera por derivação.
    -- Com a atribuição, o cascade INTEIRO abortava e nada era anonimizado.
    phone_number = null,
    cpf_encrypted = null,
    cpf_hash = null,
    birthdate = null,
    is_anonymized = true,
    anonymized_at = now(),
    consent = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  -- 2. conversations metadata + preview strip
  update conversations set
    metadata = '{}'::jsonb,
    last_message_preview = null,
    updated_at = now()
  where contact_id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  -- 3. messages: redact body + null media + strip metadata (preserve status/timestamps/conversation_id)
  update messages set
    body = '[mensagem anonimizada]',
    media_url = null,
    media_mime = null,
    media_size_bytes = null,
    media_storage_path = null,
    metadata = '{}'::jsonb,
    updated_at = now()
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_count);

  -- 4. crm_lead_activities — strip payload, metadata E reason (migration 0071).
  --    `reason` é texto livre escrito por LLM sobre a conversa do lead: supor que
  --    nunca conterá um nome é a suposição que falha. `evidence` NÃO é limpa —
  --    guarda só ids, e as linhas apontadas são redigidas por conta própria.
  update crm_lead_activities set
    payload = '{}'::jsonb,
    metadata = '{}'::jsonb,
    reason = null
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('activities', v_count);

  -- 4b. crm_meetings (migration 0098) — a transcrição é a conversa do titular
  --     palavra por palavra; `summary`, `spin_scores` e `coaching` citam trechos
  --     dela; `notes` é texto livre do usuário sobre a pessoa. Tudo sai.
  --     `status`, `outcome`, `score`, `turn_count` e as datas FICAM: "houve uma
  --     R1 de 40 minutos e ela avançou" é fato operacional sobre o funil, não
  --     dado pessoal — mesmo critério do passo 4b da linhagem de ligações.
  update crm_meetings set
    transcript = '[]'::jsonb,
    turn_count = 0,
    summary = null,
    notes = null,
    spin_scores = null,
    coaching = null,
    live_state = '{}'::jsonb,
    analysis_error = null,
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('meetings', v_count);

  -- 4c. crm_meeting_suggestions — a sugestão cita dados reais da conversa
  --     ("Com 15 fechando por mês, chega nos 25?"). O texto sai; `phase_detected`,
  --     `at_seconds` e `was_followed` FICAM — são o esqueleto da métrica de
  --     coaching (% seguido por fase), sem uma palavra do titular.
  update crm_meeting_suggestions set
    suggestion = '[sugestão anonimizada]',
    alert = null
  where organization_id = p_organization_id
    and meeting_id in (
      select id from crm_meetings
        where organization_id = p_organization_id
          and (
            contact_id = p_contact_id
            or lead_id in (
              select id from crm_leads
                where contact_id = p_contact_id and organization_id = p_organization_id
            )
            or lead_id in (
              select lead_id from crm_lead_links
                where target_kind = 'contact'
                  and target_id = p_contact_id
                  and organization_id = p_organization_id
            )
          )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('meeting_suggestions', v_count);

  -- 5. crm_leads — strip title/description/custom_fields/source_metadata/tags but PRESERVE pipeline/stage/value
  update crm_leads set
    title = v_anon_label,
    description = null,
    custom_fields = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_count);

  -- 6. orders — PRESERVE values + status + timestamps. Strip personal fields from payload jsonb
  --    and replace customer_external_id with null (FK-safe; soft de-link). Keep contact_id null.
  update orders set
    payload = (coalesce(payload, '{}'::jsonb))
      - 'customer'
      - 'customer_name'
      - 'customer_email'
      - 'customer_phone'
      - 'shipping_address'
      - 'billing_address'
      - 'contact_identification',
    customer_external_id = null,
    contact_id = null,
    is_anonymized = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_count);

  -- 7. enqueue media for async deletion (idempotent via unique (bucket, object_path))
  if array_length(v_media_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'whatsapp-media', path
      from unnest(v_media_paths) as path
      where path is not null and length(path) > 0
    on conflict (bucket, object_path) do nothing;
  end if;

  -- 8. dense audit row
  insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
  values (
    p_organization_id,
    'lgpd.redact_executed',
    null,
    'contact',
    p_contact_id,
    jsonb_build_object(
      'cascaded_to', v_counts,
      'media_queued', coalesce(array_length(v_media_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths
  );
end;
$$;
