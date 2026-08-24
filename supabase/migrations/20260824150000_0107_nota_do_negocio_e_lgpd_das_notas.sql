-- ============================================================================
-- 0107 — a nota do negocio sai da ligacao, e `lead_notes` entra na cascata LGPD
--
-- DUAS COISAS, e a segunda e a que obriga esta migration a existir.
--
-- (1) O worker de analise da ligacao passou a gravar em `lead_notes` o que o
--     DONO disse, nas palavras dele — dor, numeros, quem decide, o combinado.
--     E a aula 10 do Caderno da Ligacao Fria ("colar a dor nas notas com as
--     palavras que ele usou") feita sozinha. Sem tabela nova: `lead_notes` ja
--     existe desde a 0050 e ja e de onde o preparo da reuniao le
--     (`lib/agendamento/material-gerar.ts`). Nada muda no schema.
--
-- (2) `lead_notes` NUNCA ESTEVE NA CASCATA LGPD, e isso ja era um buraco antes
--     desta entrega: o agente escreve notas ali pela tool `save_lead_note`
--     desde a 0050, com fala do titular dentro. Anonimizar um contato deixava
--     essas linhas intactas — e o indice de notas, que e injetado no prompt de
--     toda abertura, continuaria citando a pessoa que pediu para ser apagada.
--     Escrever a fala do dono ali sem fechar esse buraco seria aumentar o
--     vazamento de proposito.
--
-- POR QUE REESCREVE A FUNCAO INTEIRA: `fn_lgpd_cascade_redact_contact` e
-- CREATE OR REPLACE, entao aplicar uma versao antiga apaga blocos novos EM
-- SILENCIO. Este corpo e o da 0106 verbatim + o bloco 4f. Se outra migration
-- tocar a funcao antes desta ser aplicada, reconstrua a partir do corpo
-- VIGENTE no banco, nunca a partir deste arquivo.
--
-- Sem coluna nova -> `database.types.ts` intacto. FORA do realtime.
-- ============================================================================

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

  -- 4f. lead_notes (migration 0050) — a memoria duravel por CONTATO.
  --     Ela sempre guardou fala do titular: o agente escreve ali pela tool
  --     `save_lead_note` desde a 0050, e desde a 0107 o worker de ligacao
  --     grava a dor NAS PALAVRAS DO DONO (aula 10 do Caderno da Ligacao Fria).
  --     Estava FORA da cascata — a linha ficava inteira depois de anonimizar o
  --     contato, e o proprio indice injetado no prompt do agente continuaria
  --     citando a pessoa que pediu para ser apagada.
  --     DELETE, e nao UPDATE como nas outras tabelas: aqui nao ha nada a
  --     preservar. Em `messages` o status e o timestamp sustentam metrica e
  --     auditoria; uma nota e 100% conteudo sobre o titular, e uma linha
  --     "[anonimizado] — [anonimizado]" no indice so ocuparia o orcamento de
  --     tokens do prompt sem dizer nada a ninguem.
  delete from lead_notes
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('lead_notes', v_count);

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
