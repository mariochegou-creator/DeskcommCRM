-- 0102 — O NONO DÍGITO: o mesmo WhatsApp estava virando dois cadastros.
--
-- SINTOMA (medido em 11/08/2026, org da Nexo): 435 negócios no Kanban, 287
-- conversas no inbox, e apenas 8 negócios cujo contato tinha conversa. Abrir a
-- conversa da "Líder Aluguel de Veículos" não mostrava card nenhum no painel, e
-- filtrar o inbox por etapa do funil devolvia quase nada.
--
-- CAUSA: o CRM reconhece a pessoa pelo TEXTO do telefone (`wa_identity` =
-- 'phone:' || phone_number, com unique por org — migration 0027). Para DDD >= 31
-- o WhatsApp entrega o número SEM o nono dígito (+55 73 9981-8151), enquanto a
-- importação do Google Maps traz COM ele (+55 73 9 9981-8151). Dois textos, duas
-- identidades, dois contatos: um ficou com o card, o outro com a conversa, e
-- nada os aproximava. 168 pares nesta base.
--
-- CORREÇÃO, em três partes:
--   A. `fn_telefone_wa` — a chave canônica: para DDD >= 31, o nono dígito sai.
--      DDD 11–28 NÃO é tocado, porque lá o WhatsApp usa o 9 mesmo.
--   B. Junta os pares que já existem, repontando TODA tabela que referencia
--      contacts(id) — descobertas no catálogo, não numa lista escrita à mão
--      (entre a 0027 e hoje nasceram 14 tabelas novas com contact_id).
--   C. `wa_identity` passa a nascer da chave canônica, e o upsert da ingestão
--      passa a gravar a forma que o WhatsApp usou. A partir daqui os dois
--      caminhos — importar lista e receber mensagem — caem no MESMO contato.
--
-- QUEM VENCE O EMPATE: o contato SEM o nono dígito, sempre que ele é quem tem a
-- conversa. Não é estética — `resolveWahaChatId` (lib/waha/send.ts) monta o
-- destino a partir de `phone_number`, então o número gravado precisa continuar
-- sendo o que o WhatsApp de fato atende, ou o envio passa a falhar calado.
-- Nesta base os 168 vencedores têm conversa e os perdedores não (exceto um par,
-- em conexões diferentes — sem colisão).
--
-- E O BOTÃO LIGAR? Discar +55 73 9981-8151 não completa: falta o 9. Quem
-- reconstrói é `paraDiscarBR` (lib/calls/phone.ts) na hora de montar o `tel:`.
-- O banco guarda a verdade do WhatsApp; a tela reconstrói a verdade da operadora.
--
-- Idempotente: rodar de novo não acha par nenhum e não muda nada.

-- ---------------------------------------------------------------------------
-- A. A chave canônica
-- ---------------------------------------------------------------------------

create or replace function public.fn_telefone_wa(p_phone text)
returns text
language sql
immutable
parallel safe
as $$
  -- +55 DD 9 XXXXXXXX  ->  +55 DD XXXXXXXX, só para DDD 31-99.
  -- O `[6-9]` depois do 9 é o que separa celular de fixo: fixo começa em 2-5, e
  -- um fixo NUNCA teve nono dígito para perder.
  select case
    when p_phone ~ '^\+55[3-9][0-9]9[6-9][0-9]{7}$'
      then '+55' || substr(p_phone, 4, 2) || substr(p_phone, 7)
    else p_phone
  end
$$;

comment on function public.fn_telefone_wa is
  'Telefone BR na forma que o WhatsApp usa como identidade (DDD >= 31 perde o nono dígito). Chave de dedup de contatos — ver migration 0102.';

-- ---------------------------------------------------------------------------
-- B. Junta os pares que já existem
-- ---------------------------------------------------------------------------

-- B1. Marca o perdedor. `is_merged_into` é o próprio mapa (mesma doutrina da
--     0027) — sem tabela temporária, que não sobrevive a psql puro.
--     Só entra par 1-para-1: se dois contatos com o 9 apontassem para o mesmo
--     vencedor, o `join` traria dois e a escolha viraria sorteio.
with par as (
  select
    perdedor.id as perdedor_id,
    (
      select vencedor.id
      from public.contacts vencedor
      where vencedor.organization_id = perdedor.organization_id
        and vencedor.is_merged_into is null
        and vencedor.id <> perdedor.id
        and vencedor.phone_number = public.fn_telefone_wa(perdedor.phone_number)
      order by vencedor.created_at, vencedor.id
      limit 1
    ) as vencedor_id
  from public.contacts perdedor
  where perdedor.is_merged_into is null
    and perdedor.phone_number is not null
    and perdedor.phone_number <> public.fn_telefone_wa(perdedor.phone_number)
)
update public.contacts c
set is_merged_into = par.vencedor_id,
    merged_at = now()
from par
where c.id = par.perdedor_id
  and par.vencedor_id is not null;

-- B2. ANTES de repontar: as travas UNIQUE que envolvem contact_id transformam
--     "juntar" em erro de chave duplicada. Se houver colisão, a migration PARA e
--     desfaz tudo — melhor um erro visível do que uma junção pela metade.
do $$
declare
  v_conflito bigint;
begin
  select count(*) into v_conflito
  from public.conversations perdida
  join public.contacts c on c.id = perdida.contact_id and c.is_merged_into is not null
  where exists (
    select 1 from public.conversations mantida
    where mantida.organization_id = perdida.organization_id
      and mantida.contact_id = c.is_merged_into
      and mantida.channel_session_id is not distinct from perdida.channel_session_id
      and mantida.is_group = false and perdida.is_group = false
  );
  if v_conflito > 0 then
    raise exception 'Junção abortada: % conversa(s) do perdedor colidem com conversa do vencedor na mesma conexão. Resolva à mão antes de rodar.', v_conflito;
  end if;

  select count(*) into v_conflito
  from public.lead_state perdido
  join public.contacts c on c.id = perdido.contact_id and c.is_merged_into is not null
  where exists (
    select 1 from public.lead_state mantido
    where mantido.organization_id = perdido.organization_id
      and mantido.contact_id = c.is_merged_into
  );
  if v_conflito > 0 then
    raise exception 'Junção abortada: % linha(s) de lead_state colidem (uma por contato).', v_conflito;
  end if;

  select count(*) into v_conflito
  from public.followup_enrollments perdida
  join public.contacts c on c.id = perdida.contact_id and c.is_merged_into is not null
  where perdida.status in ('active', 'waiting_reply', 'paused_handoff')
    and exists (
      select 1 from public.followup_enrollments mantida
      where mantida.organization_id = perdida.organization_id
        and mantida.contact_id = c.is_merged_into
        and mantida.status in ('active', 'waiting_reply', 'paused_handoff')
    );
  if v_conflito > 0 then
    raise exception 'Junção abortada: % inscrição(ões) de follow-up vivas colidem.', v_conflito;
  end if;

  select count(*) into v_conflito
  from public.job_queue perdido
  join public.contacts c on c.id = perdido.contact_id and c.is_merged_into is not null
  where perdido.status = 'running'
    and exists (
      select 1 from public.job_queue mantido
      where mantido.contact_id = c.is_merged_into and mantido.status = 'running'
    );
  if v_conflito > 0 then
    raise exception 'Junção abortada: % job(s) em execução colidem.', v_conflito;
  end if;
end $$;

-- B3. Reponta TUDO que aponta para contacts(id), lido do catálogo.
--     A 0027 escreveu a lista à mão e ela envelheceu: hoje são 20 colunas, não 7.
do $$
declare
  r record;
  n bigint;
begin
  for r in
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = 'contacts'
      and ccu.column_name = 'id'
      -- O mapa não se reponta: `is_merged_into` é o que estamos seguindo.
      and not (tc.table_name = 'contacts' and kcu.column_name = 'is_merged_into')
    order by tc.table_name, kcu.column_name
  loop
    execute format(
      'update public.%I t set %I = c.is_merged_into
         from public.contacts c
        where t.%I = c.id and c.is_merged_into is not null',
      r.table_name, r.column_name, r.column_name
    );
    get diagnostics n = row_count;
    if n > 0 then
      raise notice '0102: %.% -> % linha(s) repontada(s)', r.table_name, r.column_name, n;
    end if;
  end loop;
end $$;

-- B4. O nome do negócio estava no cadastro que veio da importação; o que veio do
--     WhatsApp costuma ter só o apelido do aparelho (ou nada). Sem esta linha, o
--     contato sobrevivente fica sem nome e o card perde a identificação.
update public.contacts vencedor
set name = perdedor.name
from public.contacts perdedor
where perdedor.is_merged_into = vencedor.id
  and perdedor.name is not null and perdedor.name <> ''
  and (vencedor.name is null or vencedor.name = '');

update public.contacts vencedor
set display_name = perdedor.display_name
from public.contacts perdedor
where perdedor.is_merged_into = vencedor.id
  and perdedor.display_name is not null and perdedor.display_name <> ''
  and (vencedor.display_name is null or vencedor.display_name = '');

-- ---------------------------------------------------------------------------
-- C. Fecha a porta: a identidade passa a ser a chave canônica
-- ---------------------------------------------------------------------------

-- Coluna gerada não se altera no lugar — cai e nasce de novo. Nada se perde:
-- todo o conteúdo é derivado de phone_number/source_metadata.
drop index if exists public.uniq_contacts_org_wa_identity;

alter table public.contacts drop column if exists wa_identity;

alter table public.contacts
  add column wa_identity text generated always as (
    case
      when phone_number is not null then 'phone:' || public.fn_telefone_wa(phone_number)
      when (source_metadata ->> 'waha_lid') is not null
        then 'lid:' || regexp_replace(source_metadata ->> 'waha_lid', '@.*$', '')
      else null
    end
  ) stored;

comment on column public.contacts.wa_identity is
  'Identidade WhatsApp canônica por org (phone:+E164-sem-nono-dígito | lid:<digits>). Chave de dedup/upsert da ingestão WAHA — ver migrations 0027 e 0102.';

create unique index uniq_contacts_org_wa_identity
  on public.contacts (organization_id, wa_identity)
  where wa_identity is not null and is_merged_into is null;

-- O upsert da ingestão passa a gravar a forma que o WhatsApp USOU. É o que
-- mantém `resolveWahaChatId` apontando para um chat que existe quando o contato
-- nasceu pela importação (com o 9) e a primeira mensagem chega sem ele.
create or replace function public.fn_upsert_wa_contact(
  p_org uuid,
  p_kind text,      -- 'phone' | 'lid'
  p_phone text,     -- +E164 (kind=phone) senão null
  p_lid text,       -- somente dígitos (kind=lid) senão null
  p_chat_id text,   -- chatId cru p/ source_metadata (auditoria)
  p_notify text     -- notifyName/pushName, se houver
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.contacts (
    organization_id, phone_number, source, consent, tags, source_metadata, display_name
  )
  values (
    p_org,
    case when p_kind = 'phone' then p_phone end,
    'whatsapp',
    '{}'::jsonb,
    '{}'::text[],
    case when p_kind = 'lid'
      then jsonb_build_object('waha_lid', p_lid, 'notify_name', nullif(p_notify, ''))
      else jsonb_build_object('waha_chat_id', p_chat_id, 'notify_name', nullif(p_notify, '')) end,
    nullif(p_notify, '')
  )
  on conflict (organization_id, wa_identity) where wa_identity is not null and is_merged_into is null
  do update set
    display_name = coalesce(contacts.display_name, excluded.display_name),
    -- O WhatsApp é a autoridade sobre o próprio endereço: se ele fala pelo
    -- número sem o nono dígito, é esse que precisa estar gravado, senão o
    -- próximo envio monta um chatId que não existe.
    phone_number = coalesce(excluded.phone_number, contacts.phone_number),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.fn_upsert_wa_contact is
  'Resolve/cria contato WhatsApp de forma atômica pela identidade canônica (org, wa_identity). Grava a forma do número que o WhatsApp usou — ver migration 0102.';
