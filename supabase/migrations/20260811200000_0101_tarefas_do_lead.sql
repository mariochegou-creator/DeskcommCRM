-- 0101 — Tarefas do time presas ao lead (o que sucede o "Lembrar" do inbox)
--
-- O botão do relógio no cabeçalho da conversa adiava a CONVERSA (snooze da
-- 0062: some da fila e volta em 1/3/24h). Isso responde "me lembra desta
-- conversa" e não responde o caso que aparece toda vez que uma reunião é
-- marcada: *ligar 5h antes*, *ligar 2h antes*, *deixar a informação que o
-- closer precisa ler antes de entrar na sala*. Essas três coisas têm DONO (às
-- vezes outro), TEXTO e PRAZO COM HORA — nada disso cabe em adiar uma conversa,
-- e empilhar colunas em `conversations` para isso faria de um estado da fila um
-- gerenciador de trabalho.
--
-- POR QUE NÃO REUSAR `plan_tasks` (0094): aquela tabela é o plano comercial de
-- 60 dias — dono é um enum de PESSOA DA CASA ('mario'|'david'|'dupla'|'claude'),
-- prazo é DATE civil ("até sexta") e a linha nasce de um seed idempotente por
-- slug. Aqui o dono é um usuário do CRM (uuid, atribuível a quem for), o prazo é
-- um INSTANTE ("hoje 15:00", 2h antes da reunião) e a linha nasce de um humano
-- clicando dentro de uma conversa. Mesma palavra, dois objetos: fundir os dois
-- obrigaria um deles a mentir sobre o próprio prazo.
--
-- O PRAZO É `timestamptz`, e é a diferença que justifica a tabela: "ligar 2h
-- antes da R1" não existe num campo DATE. A 0094 escolheu DATE pela razão
-- oposta e continua certa lá — prazo de plano é calendário, prazo de ligação é
-- relógio.
--
-- NOTIFICAÇÃO SEM TABELA DE NOTIFICAÇÃO: quem é alertado sai da própria linha —
-- `assigned_to_user_id` (para quem é) e `created_by_user_id` (quem pediu). Os
-- dois veem, que é o pedido: quem delega precisa saber que a ligação não foi
-- feita tanto quanto quem ia ligar. Uma tabela de "notificações" separada seria
-- uma segunda fonte para o mesmo fato ("esta tarefa venceu"), com o risco
-- clássico de as duas discordarem — o aviso continua aceso depois da tarefa
-- concluída. Aqui o aviso É a tarefa pendente vencida: some quando se resolve,
-- porque não existe em outro lugar.
--
-- FORA da publicação `supabase_realtime`: a tela lê por React Query e invalida
-- na mutação. Publicar sem consumidor é a inversão que o teste da 0078 impede.
--
-- NNNN=0101 segue a sequência do fork nexo-ia (0100 foi o port de ligações) —
-- merge futuro do upstream renumera, mesmo racional da 0094/0098/0100.

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  kind text not null default 'outro',
  -- A informação que se passa junto ("cliente só atende depois das 18h", "o
  -- sócio decide, pergunta por ele"). É o campo que faz a tarefa valer mais que
  -- um alarme — e é texto livre sobre uma pessoa, por isso entra na cascata LGPD.
  notes text,
  -- INSTANTE, não data civil: ver o cabeçalho.
  due_at timestamptz not null,
  -- `on delete cascade` no dono, e a escolha é deliberada: tarefa é ordem de
  -- serviço PESSOAL — sem dono ninguém é notificado e a linha vira trabalho
  -- invisível na lista de todo mundo. Na prática quase nunca dispara: tirar
  -- alguém da organização mexe em `user_organizations`, não em `auth.users`.
  assigned_to_user_id uuid not null references auth.users(id) on delete cascade,
  -- Já o AUTOR pode sumir sem levar a tarefa junto: o trabalho continua devido.
  created_by_user_id uuid references auth.users(id) on delete set null,
  -- Os três vínculos são opcionais e `on delete set null` (cascade fantasma da
  -- 0100): tarefa nasce dentro de uma conversa, mas apagar a conversa não pode
  -- apagar o compromisso de ligar para a pessoa.
  conversation_id uuid references public.conversations(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  status text not null default 'pending',
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_tasks is
  'Tarefas do time presas a um lead/conversa (0101): o que fazer, para quem, até quando, com a informação junto. Sucede o snooze da 0062 — aquele adia a conversa, esta cria trabalho com dono e hora. O alerta do CRM É esta linha pendente e vencida (assigned_to_user_id e created_by_user_id veem os dois), sem tabela de notificação paralela.';
comment on column public.crm_tasks.due_at is
  'Instante do vencimento. timestamptz e nao date (oposto de plan_tasks.due_date): "ligar 2h antes da R1" e relogio, nao calendario.';
comment on column public.crm_tasks.notes is
  'Texto livre do time sobre o lead (o recado para o SDR/closer). PII: zerado pela cascata LGPD.';

-- Vocabulário fechado desde a primeira linha (tabela nova, nenhum clone tem
-- linha legada — mesma justificativa da 0100). Os dois CHECKs passam a viver
-- sob tests/invariants/vocabulario-banco-x-typescript.test.ts, pareados com
-- lib/tarefas/tarefa.ts.
alter table public.crm_tasks drop constraint if exists crm_tasks_kind_check;
alter table public.crm_tasks add constraint crm_tasks_kind_check
  check (kind = any (array['ligar', 'mensagem', 'nota', 'reuniao', 'outro']::text[]));

alter table public.crm_tasks drop constraint if exists crm_tasks_status_check;
alter table public.crm_tasks add constraint crm_tasks_status_check
  check (status = any (array['pending', 'done', 'canceled']::text[]));

-- Espelho da 0082/0094: sair de pending exige carimbo, voltar a pending limpa.
-- Status resolvido sem data não sabe dizer quando — e é de quando que a lista
-- de "feitas hoje" depende.
alter table public.crm_tasks drop constraint if exists crm_tasks_resolucao_datada;
alter table public.crm_tasks add constraint crm_tasks_resolucao_datada check (
  (status = 'pending' and resolved_at is null)
  or (status <> 'pending' and resolved_at is not null)
);

-- Título vazio é tarefa que não diz o que fazer: a lista mostra uma linha em
-- branco e o dono descobre o que era abrindo o lead. O teto casa com MAX_TITULO
-- do zod (lib/schemas/tarefas.ts) e do módulo puro.
alter table public.crm_tasks drop constraint if exists crm_tasks_title_check;
alter table public.crm_tasks add constraint crm_tasks_title_check
  check (length(btrim(title)) between 1 and 200);

alter table public.crm_tasks drop constraint if exists crm_tasks_notes_check;
alter table public.crm_tasks add constraint crm_tasks_notes_check
  check (notes is null or length(notes) <= 2000);

-- As duas leituras quentes são as MESMAS duas pessoas da notificação: "o que eu
-- tenho para fazer" e "o que eu pedi e não voltou". Índices parciais em
-- `status='pending'` porque tarefa resolvida só é lida no histórico da aba.
create index if not exists idx_crm_tasks_dono_pendentes
  on public.crm_tasks (organization_id, assigned_to_user_id, due_at)
  where status = 'pending';

create index if not exists idx_crm_tasks_autor_pendentes
  on public.crm_tasks (organization_id, created_by_user_id, due_at)
  where status = 'pending';

-- O dialog do inbox lista as tarefas da conversa aberta a cada abertura.
create index if not exists idx_crm_tasks_conversa
  on public.crm_tasks (conversation_id, due_at)
  where conversation_id is not null;

alter table public.crm_tasks enable row level security;

-- Isolamento por tenant, e SÓ por tenant: dentro da organização todo mundo lê
-- todas as tarefas de propósito — a aba tem o filtro "da equipe", e o SDR
-- precisa enxergar o que o closer combinou com o mesmo lead. Quem pode ver a
-- conversa já podia ver a nota interna dela (0052).
drop policy if exists tenant_isolation_crm_tasks_all on public.crm_tasks;
create policy tenant_isolation_crm_tasks_all on public.crm_tasks
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

-- Carimbos do BANCO, nunca do processo (lição da 0081: dois relógios derivam —
-- e aqui a comparação `due_at <= now()` é exatamente o que decide se a tarefa
-- está atrasada na tela).
create or replace function public.fn_carimba_crm_task()
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

drop trigger if exists trg_crm_tasks_carimbo on public.crm_tasks;
create trigger trg_crm_tasks_carimbo
  before insert or update on public.crm_tasks
  for each row
  execute function public.fn_carimba_crm_task();

-- Fora do realtime (ver cabeçalho). Defensivo: se a publicação tiver sido
-- criada como FOR ALL TABLES em algum clone, a tabela entraria sozinha.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'crm_tasks'
  ) then
    execute 'alter publication supabase_realtime drop table public.crm_tasks';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- LGPD — a tabela nova entra no cascade NO MESMO ARQUIVO que a cria (razão da
-- 0071: separar é como a regra de apagamento nunca acontece).
--
-- Corpo IDÊNTICO ao vigente (o da 0100, com os blocos 4b/4c de reuniões da 0098
-- e o 4d de ligações preservados) + o bloco 4e novo. Reaplicar a versão de
-- qualquer migration anterior apagaria em silêncio a limpeza das outras.
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

  -- 4e. crm_tasks (migration 0101) — `title` costuma trazer o nome da pessoa
  --     ("Ligar para João da Silva", escrito pelo próprio sugeridor da tela) e
  --     `notes` é o recado do time sobre ela ("só atende depois das 18h"). Os
  --     dois saem. O ESQUELETO fica de pé: tipo, prazo, dono, autor e status —
  --     "havia uma ligação combinada para terça e ela não foi feita" é fato
  --     operacional sobre o funil, mesmo critério do passo 4d. Trocar o título
  --     por rótulo em vez de anular: `title` é NOT NULL com CHECK de tamanho, e
  --     a lista precisa de alguma coisa para mostrar na linha.
  update crm_tasks set
    title = '[tarefa anonimizada]',
    notes = null,
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
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
  v_counts := v_counts || jsonb_build_object('tasks', v_count);

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
