-- 0104 — UM NÚMERO, UMA CONEXÃO: o mesmo WhatsApp conectado duas vezes partia
-- a conversa do lead em dois lugares.
--
-- SINTOMA (medido em 12/08/2026, org da Nexo): 2 números reais e 4 sessões WAHA
-- vivas — cada WhatsApp conectado DUAS vezes. Conversa é única por
-- (org, contato, conexão), então cada sessão criou a SUA conversa com o mesmo
-- lead: 75 contatos com a conversa partida (65 em duas, 8 em três, 2 em quatro),
-- 162 conversas envolvidas. O lead escreve e cai numa metade; o SDR abre pelo
-- card e cai na outra. Nenhum seletor de número de saída conserta isso — as
-- duas metades são reais e nenhuma tem o histórico inteiro.
--
-- CAUSA: número caiu → religado pelo botão "+ Conectar novo WhatsApp" em vez do
-- "Reconectar" do próprio cartão. Cada clique cria linha nova aqui e sessão nova
-- no WAHA, e o multi-device do WhatsApp aceita até 4 aparelhos — o segundo
-- escaneamento conecta sem reclamar. A unique (org, phone_number) existia, mas
-- valia para a tabela INTEIRA, arquivadas incluídas; por isso o arquivamento
-- precisava zerar o telefone, e por isso a segunda sessão do mesmo número ficava
-- com phone_number NULL (o "Número sem nome" da Central) em vez de ser barrada.
--
-- CORREÇÃO, em três partes:
--   A. `fn_merge_channel_session` — junta o histórico de uma conexão dentro de
--      outra: a conversa do mesmo contato vira uma só, o que não colide muda de
--      dono, e a duplicada é arquivada. É a MESMA função que a trava do app
--      chama quando alguém escaneia o mesmo WhatsApp de novo.
--   B. A TRAVA: a unique passa a valer só entre conexões VIVAS (archived_at is
--      null). Dois cartões vivos com o mesmo número deixa de ser possível no
--      banco — não depende de ninguém lembrar da regra. Como conexão arquivada
--      não colide mais, ela também para de precisar perder o telefone.
--   C. A limpeza desta base: 4 sessões viram 2. O número de cada uma foi
--      confirmado no próprio WAHA (`me.id`), não na coluna que estava vazia.
--
-- Idempotente: rodar de novo não acha conversa duplicada nenhuma e não muda nada.

-- ---------------------------------------------------------------------------
-- A. Juntar duas conexões do mesmo WhatsApp
-- ---------------------------------------------------------------------------

create or replace function public.fn_merge_channel_session(
  p_org  uuid,
  p_from uuid,  -- a conexão repetida (sai do ar)
  p_into uuid   -- a conexão que fica
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_fundidas int := 0;
  v_movidas  int := 0;
begin
  if p_from = p_into then
    raise exception 'fn_merge_channel_session: origem e destino são a mesma conexão (%)', p_from;
  end if;
  perform 1 from public.channel_sessions where id = p_from and organization_id = p_org;
  if not found then
    raise exception 'fn_merge_channel_session: conexão % não é da org %', p_from, p_org;
  end if;
  perform 1 from public.channel_sessions
   where id = p_into and organization_id = p_org and archived_at is null;
  if not found then
    raise exception 'fn_merge_channel_session: destino % não é conexão viva da org %', p_into, p_org;
  end if;

  -- 1. O contato tem conversa nas DUAS: o histórico da repetida entra na que
  --    fica, e a linha duplicada é apagada. Toda tabela que aponta para
  --    conversations(id) é repontada antes — inclusive as de ON DELETE CASCADE,
  --    que perderiam nota e mensagem em silêncio.
  for r in
    select d.id as dup, k.id as fica
      from public.conversations d
      join public.conversations k
        on k.organization_id     = d.organization_id
       and k.contact_id          = d.contact_id
       and k.channel_session_id  = p_into
       and coalesce(k.group_chat_id, '') = coalesce(d.group_chat_id, '')
     where d.organization_id    = p_org
       and d.channel_session_id = p_from
  loop
    update public.messages
       set conversation_id = r.fica, channel_session_id = p_into
     where conversation_id = r.dup;
    update public.conversation_notes             set conversation_id = r.fica where conversation_id = r.dup;
    update public.conversation_assignment_events set conversation_id = r.fica where conversation_id = r.dup;
    update public.crm_tasks                      set conversation_id = r.fica where conversation_id = r.dup;
    update public.followup_enrollments           set conversation_id = r.fica where conversation_id = r.dup;
    update public.agent_cases                    set conversation_id = r.fica where conversation_id = r.dup;
    update public.ai_invocations                 set conversation_id = r.fica where conversation_id = r.dup;
    begin
      update public.ai_agent_runs set conversation_id = r.fica where conversation_id = r.dup;
    exception when unique_violation then
      -- ai_agent_runs_one_running_per_conv: as duas tinham turno rodando. O da
      -- conversa que morre solta o vínculo (o FK é ON DELETE SET NULL de todo jeito).
      update public.ai_agent_runs set conversation_id = null
       where conversation_id = r.dup and status = 'running';
      update public.ai_agent_runs set conversation_id = r.fica where conversation_id = r.dup;
    end;

    -- Rastro de quem virou quem: se um dia alguém perguntar "cadê a outra
    -- conversa desse lead", a resposta está aqui.
    update public.conversations
       set metadata = metadata || jsonb_build_object(
             'fundido_de',
             coalesce(metadata->'fundido_de', '[]'::jsonb) || to_jsonb(r.dup::text)
           ),
           updated_at = now()
     where id = r.fica;

    delete from public.conversations where id = r.dup;
    v_fundidas := v_fundidas + 1;
  end loop;

  -- 2. Contato que só falou pela repetida: a conversa inteira muda de dono.
  update public.conversations
     set channel_session_id = p_into, updated_at = now()
   where organization_id = p_org and channel_session_id = p_from;
  get diagnostics v_movidas = row_count;

  update public.messages
     set channel_session_id = p_into
   where organization_id = p_org and channel_session_id = p_from;

  -- 3. Timeline da conversa que ficou, recalculada da verdade (as mensagens).
  update public.conversations c set
    last_message_at      = agg.max_at,
    last_inbound_at      = agg.max_in,
    last_outbound_at     = agg.max_out,
    last_message_preview = agg.preview
  from (
    select conversation_id,
           max(coalesce(sent_at, created_at)) as max_at,
           max(coalesce(sent_at, created_at)) filter (where direction = 'inbound')  as max_in,
           max(coalesce(sent_at, created_at)) filter (where direction = 'outbound') as max_out,
           (array_agg(coalesce(nullif(body, ''), '[' || type || ']')
                      order by coalesce(sent_at, created_at) desc))[1] as preview
      from public.messages
     where organization_id = p_org and channel_session_id = p_into
     group by conversation_id
  ) agg
  where c.id = agg.conversation_id;

  -- 4. A repetida sai de todas as listas. O telefone FICA na linha (a unique
  --    nova só olha conexão viva) — é o que dá nome ao cartão no histórico.
  update public.channel_sessions
     set archived_at           = coalesce(archived_at, now()),
         status                = 'STOPPED',
         status_reason         = 'conexão repetida do mesmo WhatsApp — histórico juntado no cartão que ficou',
         display_name          = coalesce(display_name, phone_number, waha_session_name),
         last_status_change_at = now()
   where id = p_from and organization_id = p_org;

  return jsonb_build_object(
    'conversas_fundidas', v_fundidas,
    'conversas_movidas',  v_movidas
  );
end;
$$;

comment on function public.fn_merge_channel_session is
  'Junta o histórico de uma conexão WhatsApp repetida dentro da que fica (conversa do mesmo contato vira uma só) e arquiva a repetida. Usada pela limpeza da 0104 e pela trava de número duplicado do app.';

revoke all on function public.fn_merge_channel_session(uuid, uuid, uuid) from public;
grant execute on function public.fn_merge_channel_session(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- A2. Número que caiu e foi religado pelo "+": o cartão ORIGINAL assume a
--     sessão que acabou de conectar, em vez de nascer um cartão paralelo.
--
--     É o pedido do Mario em 12/08/2026: "quando o número desconectar, ao
--     conectar de novo o sistema deve ver que ele já estava conectado antes e
--     só subir de novo, não criar vários do mesmo".
--
--     O cartão antigo é o que tem o histórico, o rótulo, o agente e os knobs —
--     então é ele que fica; o que muda de mão é o `waha_session_name`, que é o
--     que liga a linha à sessão viva no WAHA (o webhook de produção resolve a
--     conexão por esse nome).
-- ---------------------------------------------------------------------------

create or replace function public.fn_adotar_conexao(
  p_org    uuid,
  p_cartao uuid,  -- o cartão de sempre (histórico, rótulo, agente)
  p_nova   uuid,  -- a linha recém-criada, que está com a sessão WAHA de pé
  p_numero text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_res  jsonb;
begin
  if p_cartao = p_nova then
    raise exception 'fn_adotar_conexao: cartão e conexão nova são a mesma linha (%)', p_nova;
  end if;
  select waha_session_name into v_nome
    from public.channel_sessions where id = p_nova and organization_id = p_org;
  if not found then
    raise exception 'fn_adotar_conexao: conexão % não é da org %', p_nova, p_org;
  end if;
  perform 1 from public.channel_sessions where id = p_cartao and organization_id = p_org;
  if not found then
    raise exception 'fn_adotar_conexao: cartão % não é da org %', p_cartao, p_org;
  end if;

  -- O cartão volta a ser conexão viva (é justamente o que estamos fazendo) —
  -- e o merge exige destino vivo.
  update public.channel_sessions
     set archived_at = null
   where id = p_cartao and organization_id = p_org;

  -- Se a linha nova já chegou a conversar (escaneada há minutos), o pouco que
  -- ela tem entra no cartão. Ela também sai das listas aqui dentro.
  v_res := public.fn_merge_channel_session(p_org, p_nova, p_cartao);

  -- A linha nova solta o nome da sessão (é unique) — sem apagar a linha:
  -- ai_agent_versions referencia channel_sessions com ON DELETE RESTRICT.
  update public.channel_sessions
     set waha_session_name = v_nome || '_sub' || left(md5(random()::text), 4),
         phone_number      = null,
         status_reason     = 'mesmo número do cartão que já existia — conexão devolvida a ele'
   where id = p_nova and organization_id = p_org;

  -- O cartão assume a sessão que está de pé no WAHA.
  update public.channel_sessions
     set waha_session_name       = v_nome,
         phone_number            = p_numero,
         status                  = 'WORKING',
         status_reason           = null,
         archived_at             = null,
         consecutive_health_fails = 0,
         last_status_change_at   = now()
   where id = p_cartao and organization_id = p_org;

  return v_res || jsonb_build_object('sessao_waha', v_nome);
end;
$$;

comment on function public.fn_adotar_conexao is
  'O cartão antigo do mesmo número assume a sessão WAHA recém-conectada (0104). Evita que "+ Conectar novo WhatsApp" num número que só caiu vire um cartão paralelo.';

revoke all on function public.fn_adotar_conexao(uuid, uuid, uuid, text) from public;
grant execute on function public.fn_adotar_conexao(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- B. A TRAVA — dois cartões VIVOS com o mesmo número: impossível
-- ---------------------------------------------------------------------------

alter table public.channel_sessions
  drop constraint if exists channel_sessions_phone_per_org_unique;

create unique index if not exists channel_sessions_numero_vivo_unique
  on public.channel_sessions (organization_id, phone_number)
  where archived_at is null and phone_number is not null;

comment on index public.channel_sessions_numero_vivo_unique is
  'Um número, uma conexão viva por org (0104). Arquivada fica de fora — reconectar o mesmo número continua possível, e a linha arquivada pode guardar o telefone.';

-- ---------------------------------------------------------------------------
-- C. Limpeza desta base
--
-- Conferido no WAHA em 12/08/2026 (`GET /api/sessions?all=true` → me.id):
--   557799325325  org_22db0b3c_6d6ef0 (fica)  ← org_22db0b3c_7b08ee
--   557798980343  org_22db0b3c_997592 (fica)  ← org_22db0b3c_de5457
--                                             ← org_22db0b3c_c51a6c
--
-- AQUI só entra a `c51a6c`: ela foi arquivada em 10/08 e a sessão dela já não
-- existe no WAHA, então juntar o histórico (172 conversas, 1021 mensagens que
-- ficaram presas nela) não corre risco nenhum.
--
-- As outras duas — `7b08ee` e `de5457` — estão VIVAS no WAHA, com o aparelho
-- ainda plugado no celular. Arquivar por SQL antes de desconectar o aparelho
-- faria o webhook DESCARTAR o que chegasse nelas (`skip:channel_archived`):
-- mensagem de cliente sumindo sem erro. Quem cuida delas é a trava do app
-- (`lib/waha/um-numero-uma-conexao.ts`), na ordem certa — solta o aparelho no
-- WAHA primeiro, junta o histórico depois. Basta abrir a Central de Conexões.
--
-- Em outro clone/banco os IDs não existem e o bloco inteiro não faz nada.
-- ---------------------------------------------------------------------------

do $limpeza$
declare
  v_org  uuid := '22db0b3c-4e26-4dad-85d7-4bfaf4774c7d';
  v_res  jsonb;
  v_par  record;
begin
  if not exists (select 1 from public.organizations where id = v_org) then
    return;
  end if;

  for v_par in
    select * from (values
      ('9637d356-6e4e-42a0-ace6-380b3360103d'::uuid, '14c7a203-9b4d-474f-b568-d87928ca6d27'::uuid, '557798980343')
    ) as t(repetida, fica, numero)
  loop
    if exists (select 1 from public.channel_sessions where id = v_par.repetida and organization_id = v_org)
       and exists (select 1 from public.channel_sessions
                    where id = v_par.fica and organization_id = v_org and archived_at is null) then
      v_res := public.fn_merge_channel_session(v_org, v_par.repetida, v_par.fica);
      raise notice '0104 % : %', v_par.numero, v_res;
    end if;
  end loop;

  -- O bom-dia das 8h30 apontava para uma conexão que não existe mais desde 10/08
  -- (caía no fallback "primeira WORKING"). Passa a apontar para o cartão que ficou.
  update public.organizations o
     set settings = jsonb_set(o.settings, '{sixty_day_brief,session_name}',
                              to_jsonb('org_22db0b3c_997592'::text), false)
   where o.id = v_org
     and o.settings->'sixty_day_brief'->>'session_name'
         in ('org_22db0b3c_c51a6c', 'org_22db0b3c_de5457', 'org_22db0b3c_7b08ee');
end
$limpeza$;
