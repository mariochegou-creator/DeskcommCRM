-- 0100 — Ligações do SDR: gravação, transcrição e análise por IA
--
-- Port da `feat/ligacoes-sdr` (linhagem upstream, onde nasceu como 0098) para o
-- fork nexo-ia. Renumerada para 0100 porque o fork tomou 0098 (sala de
-- reuniões) e 0099 (unread zera ao responder) — o "merge futuro renumera"
-- previsto no MANIFEST. A `fn_lgpd_cascade_redact_contact` abaixo NÃO é a da
-- branch original: foi reescrita sobre o corpo vigente do fork (que já carrega
-- os blocos 4b/4c de reuniões da 0098) + os blocos novos de ligações. Aplicar a
-- versão da branch apagaria a limpeza LGPD de reuniões em silêncio.
--
-- O SDR liga pelo celular no viva-voz com o CRM aberto ao lado. O CRM grava pelo
-- microfone do computador, sobe o áudio e devolve na timeline uma análise da
-- ligação. Esta migration cria o LASTRO dessa análise.
--
-- TABELA PRÓPRIA, não colunas em `crm_lead_activities`. Três razões:
--
--   1. A atividade é o ACONTECIMENTO ("ligou", "a ligação foi analisada"); a
--      gravação é um ARTEFATO com ciclo de vida próprio (pendente → subindo →
--      transcrevendo → analisando → concluído/falhou) que muda várias vezes
--      DEPOIS que a atividade já nasceu. Estado que evolui dentro da linha de
--      uma timeline é como timeline vira tabela de estado — e aí ela para de ser
--      a história do que aconteceu.
--
--   2. `crm_lead_activities` está na publicação `supabase_realtime`. Cada passo
--      do pipeline escrevendo lá faria a timeline pulsar quatro vezes por
--      ligação, para dizer "ainda estou processando". Mesmo defeito nomeado no
--      cabeçalho da 0075 (o pulso que mente). Esta tabela fica FORA do realtime:
--      o popup faz poll enquanto está aberto; a timeline pulsa uma vez só,
--      quando a análise fica pronta e vira atividade.
--
--   3. Transcrição é texto livre sobre a conversa de um lead — o material mais
--      denso em PII que este produto guarda. Numa tabela própria a redação LGPD
--      é um UPDATE explícito e auditável, não um `payload - 'transcript'`
--      escondido no meio de um jsonb genérico.
--
-- OS DOIS CHECKS ENTRAM (`status`, `outcome`) — e aqui a exceção do
-- `crm_lead_activities.type` NÃO se aplica. Aquela coluna ficou sem CHECK porque
-- clones têm linhas legadas com valores que não conhecemos, e a constraint
-- quebraria o `update.sh` deles. Esta tabela é nova: nenhum clone tem uma linha
-- sequer. Vocabulário fechado desde a primeira linha é vocabulário que dá para
-- fechar. Consequência assumida: `lib/calls/analysis-schema.ts` passa a viver
-- sob `tests/invariants/vocabulario-banco-x-typescript.test.ts`.

create table if not exists public.crm_call_recordings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- `on delete set null` nos dois: perder o negócio ou a atividade não pode
  -- apagar a gravação. O áudio é prova do que foi dito; o card é organização do
  -- funil. Cascade aqui seria o "cascade fantasma" da lista de anti-patterns.
  lead_id uuid references public.crm_leads(id) on delete set null,
  activity_id uuid references public.crm_lead_activities(id) on delete set null,
  status text not null default 'pending',
  outcome text,
  score numeric(3, 1),
  storage_path text,
  mime_type text,
  size_bytes bigint,
  duration_seconds int,
  transcript text,
  analysis jsonb,
  error_detail text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_call_recordings is
  'Gravacao de ligacao do SDR e a analise por IA dela. Tabela propria e FORA do realtime de proposito - ver o cabecalho da migration 0100. A atividade em crm_lead_activities e o acontecimento; esta linha e o artefato com ciclo de vida.';

comment on column public.crm_call_recordings.status is
  'Onde o pipeline esta. pending = tentativa registrada, audio ainda nao subiu (o SDR clicou em Ligar e pode nunca gravar - isso e historico de tentativa, nao erro). done_unformatted = a analise rodou mas o modelo nao devolveu JSON valido nem no retry: o texto cru fica em analysis->>raw e a pessoa le mesmo assim, em vez de perder a analise inteira por um problema de formatacao.';

comment on column public.crm_call_recordings.outcome is
  'O que a ligacao produziu, segundo a analise. Espelha resultado do prompt e RESULTADO_LIGACAO em lib/calls/analysis-schema.ts - o CHECK e o TypeScript tem de concordar (invariante de vocabulario).';

comment on column public.crm_call_recordings.transcript is
  'Transcricao integral da ligacao. PII DENSA: e a conversa do lead palavra por palavra. Zerada pela cascata LGPD (fn_lgpd_cascade_redact_contact) junto com analysis e error_detail.';

comment on column public.crm_call_recordings.score is
  'Nota geral 0-10 promovida de analysis para coluna porque e o que a lista de atividades ordena e agrega. numeric(3,1) aceita 10.0.';

alter table public.crm_call_recordings
  drop constraint if exists crm_call_recordings_status_check;

alter table public.crm_call_recordings
  add constraint crm_call_recordings_status_check check (
    status = any (array[
      'pending', 'uploading', 'transcribing', 'analyzing',
      'done', 'done_unformatted', 'failed'
    ]::text[])
  );

alter table public.crm_call_recordings
  drop constraint if exists crm_call_recordings_outcome_check;

alter table public.crm_call_recordings
  add constraint crm_call_recordings_outcome_check check (
    outcome is null
    or outcome = any (array[
      'agendou', 'nao_agendou', 'follow_up_marcado', 'nao_atendeu_ou_invalida'
    ]::text[])
  );

alter table public.crm_call_recordings
  drop constraint if exists crm_call_recordings_score_range;

alter table public.crm_call_recordings
  add constraint crm_call_recordings_score_range check (
    score is null or (score >= 0 and score <= 10)
  );

-- ---- tenancy ----
alter table public.crm_call_recordings enable row level security;

drop policy if exists tenant_isolation_crm_call_recordings_all on public.crm_call_recordings;
create policy tenant_isolation_crm_call_recordings_all on public.crm_call_recordings
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

create index if not exists idx_crm_call_recordings_org_created
  on public.crm_call_recordings (organization_id, created_at desc);

create index if not exists idx_crm_call_recordings_org_lead
  on public.crm_call_recordings (organization_id, lead_id);

create index if not exists idx_crm_call_recordings_org_contact
  on public.crm_call_recordings (organization_id, contact_id);

drop trigger if exists trg_crm_call_recordings_updated_at on public.crm_call_recordings;
create trigger trg_crm_call_recordings_updated_at
  before update on public.crm_call_recordings
  for each row execute function public.fn_set_updated_at();

-- FORA da publicação de realtime — ver razão 2 do cabeçalho. Remover é
-- defensivo: corrige um clone que a tenha publicado por engano.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'crm_call_recordings'
  ) then
    execute 'alter publication supabase_realtime drop table public.crm_call_recordings';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Bucket privado das gravações. 100 MB (o dobro do whatsapp-media): ligação de
-- prospecção é longa e o SDR também pode subir gravação feita por fora, em mp3
-- sem compressão agressiva. Acesso só por service role — upload pela rota,
-- leitura por signed URL. Sem policy para anon/authenticated, igual à 0055.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('call-recordings', 'call-recordings', false, 104857600)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- LGPD — a tabela nova entra no cascade de anonimização NO MESMO ARQUIVO que a
-- cria, pelo motivo escrito na 0071: separar é como a regra de apagamento nunca
-- acontece. E aqui o risco é maior que o de lá — `transcript` não é um campo que
-- "pode conter" dado pessoal, é a conversa inteira do titular transcrita.
--
-- Corpo IDÊNTICO ao vigente do fork (extraído do baseline pós-0099, com os
-- blocos 4b/4c de reuniões da 0098 preservados) + as adições de ligações:
-- v_call_paths, a coleta dos caminhos, o bloco 4d e a fila do bucket novo no
-- passo 7.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"("p_organization_id" "uuid", "p_contact_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_call_paths text[] := '{}';
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

  -- Idem para as gravações de ligação (bucket call-recordings, migration 0100).
  -- Array SEPARADO porque o bucket é outro: enfileirar tudo como 'whatsapp-media'
  -- faria o worker de storage procurar o objeto no lugar errado, não achar, e
  -- marcar como apagado. O áudio continuaria lá — e a auditoria diria que não.
  select coalesce(array_agg(distinct storage_path) filter (where storage_path is not null), '{}')
    into v_call_paths
    from crm_call_recordings
    where organization_id = p_organization_id
      and contact_id = p_contact_id;

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
  --     `status`, `outcome`, `score`, `turn_count` e as datas FICAM: fato
  --     operacional sobre o funil, não dado pessoal.
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

  -- 4c. crm_meeting_suggestions — a sugestão cita dados reais da conversa.
  --     O texto sai; phase_detected/at_seconds/was_followed ficam (esqueleto da
  --     métrica de coaching, sem uma palavra do titular).
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

  -- 4d. crm_call_recordings (migration 0100) — a transcrição é a conversa do
  --     titular palavra por palavra, e `analysis` cita trechos dela no campo
  --     `acertos`. Os dois saem. `status` e `outcome` FICAM: "houve uma ligação,
  --     e ela agendou reunião" é fato operacional sobre a empresa, não dado
  --     pessoal — mesmo critério que preserva valor e estágio do negócio no
  --     passo 5. `storage_path` vira null só DEPOIS de o caminho já estar em
  --     `v_call_paths` (coletado lá em cima); zerar antes perderia o ponteiro e
  --     o áudio ficaria órfão no bucket, inalcançável e não apagado.
  update crm_call_recordings set
    transcript = null,
    analysis = null,
    error_detail = null,
    storage_path = null,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('call_recordings', v_count);

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

  if array_length(v_call_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'call-recordings', path
      from unnest(v_call_paths) as path
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
      'call_recordings_queued', coalesce(array_length(v_call_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths,
    'call_recording_paths', v_call_paths
  );
end;
$$;
