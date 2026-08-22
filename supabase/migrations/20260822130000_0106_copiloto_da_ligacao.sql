-- 0106 — Copiloto da ligação: transcrição ao vivo, sugestão no ouvido do SDR e
-- a anotação dele entrando na análise.
--
-- O QUE MUDOU NO PRODUTO. Até aqui a ligação era um gravador cego: o SDR
-- apertava "gravar", falava cinco minutos e só depois de encerrar descobria o
-- que a IA achou. Duas coisas quebravam nisso — a análise chegava tarde demais
-- para salvar A LIGAÇÃO (só a próxima), e nada do que o SDR percebeu durante a
-- conversa entrava no material. Agora o áudio é transcrito em blocos enquanto a
-- chamada acontece, o copiloto devolve UMA pergunta por vez para o SDR falar, e
-- a anotação dele vai junto para a análise final.
--
-- DUAS COLUNAS, NENHUMA TABELA NOVA. A tentação era espelhar
-- `crm_meeting_suggestions` (0098) e guardar cada sugestão numa linha. Não vale
-- aqui: naquela tabela as linhas existem para MEDIR "o vendedor seguiu o
-- roteiro?" ao longo de reuniões de uma hora. A ligação de qualificação dura
-- cinco minutos e o que sobra dela é a análise final — uma tabela nova traria
-- RLS, índice, cascata LGPD e tela própria para guardar meia dúzia de frases
-- que ninguém vai consultar depois. O checklist de cobertura vive em
-- `live_state`, que é memória de trabalho e é descartável por natureza.
--
-- POR QUE `transcript` NÃO GANHA COLUNA NOVA. A transcrição ao vivo escreve na
-- MESMA coluna `transcript` que o worker preencheria depois. É de propósito: o
-- `call-analysis-worker` já pula o Whisper quando encontra `transcript`
-- preenchido (o desvio que existia para não pagar duas vezes numa retentativa).
-- Com o copiloto ligado, esse desvio passa a ser o caminho normal — a ligação
-- chega ao fim já transcrita, a análise sai em segundos e o áudio inteiro nunca
-- é enviado ao Whisper uma segunda vez. Uma coluna `live_transcript` separada
-- criaria duas respostas para "o que foi dito nesta ligação", e a segunda
-- ficaria para trás.

alter table public.crm_call_recordings
  add column if not exists sdr_notes text;

alter table public.crm_call_recordings
  add column if not exists live_state jsonb not null default '{}'::jsonb;

comment on column public.crm_call_recordings.sdr_notes is
  'Anotacao que o SDR escreveu DURANTE a ligacao, no popup. Entra no prompt da analise final como contexto do que a transcricao nao capta (reacao, tom, o que ficou combinado). PII: texto livre sobre o titular - zerada pela cascata LGPD junto com transcript e analysis.';

comment on column public.crm_call_recordings.live_state is
  'Memoria de trabalho do copiloto ao vivo: {fase, cobertura:{...}, sugestao, alerta, chunks}. Existe para nao reenviar a transcricao inteira a cada bloco de audio - mesmo papel de crm_meetings.live_state (0098). Descartavel: perder isto no meio da ligacao custa o checklist, nao a gravacao.';

-- ---------------------------------------------------------------------------
-- LGPD — `sdr_notes` é texto livre que uma pessoa escreveu sobre outra durante
-- uma ligação ("o sócio é quem decide, mulher dele atende a loja"). É dado de
-- titular tanto quanto a transcrição, e nasceria FORA da cascata se este
-- arquivo não a reescrevesse — o modo de falha sem sintoma que o cabeçalho da
-- 0100 descreve.
--
-- Corpo IDÊNTICO ao vigente (o da 0101, com os blocos 4b/4c de reuniões, 4d de
-- ligações e 4e de tarefas) + as duas colunas novas no bloco 4d. As 0102-0105
-- não tocaram nesta função; reaplicar a versão de qualquer migration anterior
-- à 0101 apagaria a limpeza das tarefas em silêncio.
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
  --     `sdr_notes` e `live_state` entram aqui na 0106: a anotação é o SDR
  --     escrevendo sobre o titular ("quem decide é a esposa"), e o `live_state`
  --     guarda a última sugestão, que cita dados reais ditos na ligação.
  update crm_call_recordings set
    transcript = null,
    analysis = null,
    error_detail = null,
    sdr_notes = null,
    live_state = '{}'::jsonb,
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
