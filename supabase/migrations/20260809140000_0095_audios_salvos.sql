-- 0095 — saved_audios: a gaveta de áudios prontos do composer do inbox
--
-- O vendedor repete as MESMAS falas o dia inteiro (abertura, "manda seu CNPJ",
-- explicação do serviço). Gravar de novo a cada conversa é o custo. Aqui o
-- áudio é gravado UMA vez e reenviado quantas vezes precisar — chega no
-- WhatsApp como PTT (sendVoice, lib/waha/media-send.ts), indistinguível de um
-- áudio gravado na hora.
--
-- Escopo espelha message_templates (0060), de propósito: owner_user_id
-- preenchido = pessoal do vendedor; null = compartilhado da org. RLS: todo
-- membro LÊ (compartilhados + próprios); escreve o próprio (agent+) ou o
-- compartilhado (manager+). Mesma policy, mesma doutrina — quem entende uma
-- entende a outra.
--
-- ⚠️ O binário NÃO mora aqui: fica no bucket whatsapp-media sob
-- {org}/library/{uuid}.{ext}. `library` no lugar do conversation_id é o que
-- mantém isMediaPathOwnedBy (0055/Onda 2) intacto — o áudio salvo não pertence
-- a nenhuma conversa, então o envio COPIA o objeto pra pasta da conversa antes
-- de mandar (app/api/v1/saved-audios/[id]/attach). Sem a cópia, a checagem de
-- posse do _handler recusaria o path — e afrouxar essa checagem abriria envio
-- de mídia de uma conversa em outra.
--
-- ⚠️ NUMERAÇÃO: 0095 segue a sequência do fork nexo-ia (mesmo racional da 0093
-- e da 0094 — colide de propósito com o upstream origin/main; merge futuro
-- renumera).

create table if not exists public.saved_audios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  storage_path text not null,
  media_mime text not null,
  media_size_bytes bigint not null,
  -- Duração medida no browser durante a gravação (o servidor não decodifica o
  -- container). Nullable: áudio salvo antes de a UI medir não vira erro.
  duration_seconds int,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.saved_audios is
  'Áudios prontos reenviáveis do composer (PTT). Binário no bucket whatsapp-media sob {org}/library/; o envio copia pra pasta da conversa. owner_user_id null = compartilhado da org, espelhando message_templates (0060).';
comment on column public.saved_audios.storage_path is
  'Path no bucket whatsapp-media: {org}/library/{uuid}.{ext}. Nunca é enviado direto ao WAHA — o attach copia pra {org}/{conversa}/ e é a cópia que vai.';

-- Um objeto por linha: sem isso, apagar uma linha apagaria o binário de outra.
alter table public.saved_audios drop constraint if exists saved_audios_storage_path_unique;
alter table public.saved_audios add constraint saved_audios_storage_path_unique
  unique (storage_path);

alter table public.saved_audios drop constraint if exists saved_audios_mime_audio_check;
alter table public.saved_audios add constraint saved_audios_mime_audio_check
  check (media_mime like 'audio/%');

alter table public.saved_audios drop constraint if exists saved_audios_size_check;
alter table public.saved_audios add constraint saved_audios_size_check
  check (media_size_bytes > 0);

-- A gaveta abre listando os mais recentes primeiro.
create index if not exists idx_saved_audios_org_updated
  on public.saved_audios (organization_id, updated_at desc);

alter table public.saved_audios enable row level security;

-- Helpers canônicos do repo: fn_user_org_ids() SETOF uuid,
-- fn_role_at_least(org uuid, min text) boolean, fn_is_platform_admin() boolean.
drop policy if exists "saved_audios_select" on public.saved_audios;
create policy "saved_audios_select" on public.saved_audios
  for select using (
    (
      organization_id in (select fn_user_org_ids())
      and (owner_user_id is null or owner_user_id = auth.uid())
    )
    or fn_is_platform_admin()
  );

drop policy if exists "saved_audios_write" on public.saved_audios;
create policy "saved_audios_write" on public.saved_audios
  for all using (
    organization_id in (select fn_user_org_ids())
    and (
      (owner_user_id = auth.uid() and fn_role_at_least(organization_id, 'agent'))
      or (owner_user_id is null and fn_role_at_least(organization_id, 'manager'))
    )
  )
  with check (
    organization_id in (select fn_user_org_ids())
    and (
      (owner_user_id = auth.uid() and fn_role_at_least(organization_id, 'agent'))
      or (owner_user_id is null and fn_role_at_least(organization_id, 'manager'))
    )
  );

-- Carimbo do BANCO, nunca do processo (lição da 0081).
create or replace function public.fn_carimba_saved_audio()
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

drop trigger if exists trg_saved_audios_carimbo on public.saved_audios;
create trigger trg_saved_audios_carimbo
  before insert or update on public.saved_audios
  for each row
  execute function public.fn_carimba_saved_audio();
