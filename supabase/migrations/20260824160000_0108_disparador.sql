-- 0108 — Disparador: campanha de mensagem em massa pelo WhatsApp
--
-- O QUE É: mandar UMA mensagem (texto e/ou mídia) para um PÚBLICO do CRM —
-- todos os leads abertos de um funil, os de uma etapa, os de uma tag, os de um
-- nicho vindo da importação. É o primeiro-toque (`leads/[id]/primeiro-toque`)
-- em escala: mesmo trilho de envio, mesmo ator humano, mesma etiqueta.
--
-- POR QUE DUAS TABELAS, E POR QUE A SEGUNDA É A IMPORTANTE
--
-- `broadcasts` é o que o operador escreve. `broadcast_recipients` é o que o
-- worker executa — e ela é fila, trava de duplicata e relatório ao mesmo tempo,
-- de propósito. A linha do destinatário NASCE na ativação, ANTES de qualquer
-- envio, com `unique (broadcast_id, contact_id)`. Disso saem três coisas que um
-- `sent boolean` numa tabela de campanha não daria:
--
--   1. Dedup do público: o mesmo contato pode ter 3 cards no funil (importação
--      repetida, negócio reaberto). Três linhas de lead, UM envio.
--   2. Idempotência sob crash: re-materializar o público é `on conflict do
--      nothing`. Rodar a ativação duas vezes não duplica destinatário.
--   3. Relatório sem segunda fonte: "quantos foram" é count por status na mesma
--      linha que decidiu o envio, não um contador que pode divergir dela.
--
-- A LIÇÃO QUE ESTÁ CODIFICADA AQUI (10/08/2026)
--
-- A cadência anti-vácuo re-inscreveu 38 leads em loop e gerou 9.225 alertas
-- porque o estado do "já mandei pra este" vivia longe do envio e podia ser
-- recriado. As travas da 0064 (unique de inscrição viva) nasceram desse dia.
-- Aqui a mesma doutrina, mais simples: a linha do destinatário é criada antes,
-- é única por contato, e o claim com lease (`fn_claim_due_broadcast_recipients`)
-- garante que dois ticks do cron nunca peguem o mesmo destinatário. Um tick que
-- morre no meio deixa a lease vencer; o worker que a recolhe procura a mensagem
-- em `messages.metadata->>'broadcast_recipient_id'` ANTES de tentar de novo.
--
-- NÃO É UM FLUXO DE FOLLOW-UP, E ISSO É DELIBERADO
--
-- O motor de `followup_flows` (0054+) já sabe agendar toque e cancelar em
-- resposta, e a tentação de reusá-lo é grande. Três coisas impedem:
--   - o nó `action` sai pelo agente, com ator `ai_agent` ⇒ badge "IA" no inbox.
--     Uma frase escrita pelo dono etiquetada como robô é pior que sem etiqueta
--     (mesma razão do cabeçalho de `primeiro-toque`);
--   - depende de versão de agente publicada e de crédito de LLM — a org roda
--     sem agente publicado, e falta de crédito foi justamente o combustível do
--     acidente acima;
--   - o unique org-wide de inscrição viva (0064) faria um disparo EXPULSAR a
--     cadência real do mesmo contato.
-- Disparo é fan-out plano de texto fixo. Não precisa de grafo, e não pode
-- precisar de modelo.
--
-- MÍDIA: o binário mora em `{org}/library/broadcasts/{broadcast_id}/…` e é
-- COPIADO pra dentro de cada conversa no envio — `isMediaPathOwnedBy` exige
-- posse, e o mesmo desenho já roda na gaveta de áudios (0095) e no áudio do
-- grupo da reunião. Bônus: trocar o arquivo depois não muda o que já saiu.

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  -- Por que a campanha parou sozinha. Aparece na tela como frase; sem isto uma
  -- campanha pausada pelo worker (sessão caiu, copy repetida) seria
  -- indistinguível de uma pausada pelo operador.
  pause_reason text,
  -- Spintax `{oi|opa}` + `{{nome}}`. Em vídeo/imagem vira legenda; em áudio é
  -- ignorado (PTT não tem caption — ver lib/waha/media-send.ts).
  body_template text,
  media_storage_path text,
  media_mime text,
  media_size_bytes bigint,
  media_type text,
  -- Filtro do público CONGELADO no momento da ativação (o que virou linha em
  -- broadcast_recipients). Fica como jsonb porque é entrada de tela, não
  -- vocabulário: pipeline_id, stage_id, lead_tag, contact_tag, custom_field.
  audience jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  -- Teto voluntário por DIA desta campanha, por cima do cap do número. null =
  -- só os caps do chip (channel_sessions.daily_message_limit + warm-up).
  daily_cap int,
  max_recipients int not null default 1000,
  -- Quem "assina" a mensagem. sendMessageHandler deriva sent_via do tipo do
  -- ator: só `user` escapa do badge "IA". Por isso NOT NULL — campanha sem dono
  -- humano não deveria conseguir existir.
  send_as_user_id uuid not null references auth.users(id) on delete restrict,
  -- Número preferido de saída. null = resolverSessao decide por contato
  -- (conversa existente vence, senão o mais antigo WORKING).
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.broadcasts is
  'Campanha de disparo em massa (0108): um publico + uma mensagem. "Audio por nicho" = N campanhas, nao uma campanha com N segmentos — cada uma e pausavel sozinha. Execucao em broadcast_recipients.';
comment on column public.broadcasts.send_as_user_id is
  'Ator humano do envio. sendMessageHandler marca sent_via=user SO quando actor.type=user; qualquer outro vira "ai" no inbox (app/api/v1/messages/_handler.ts).';
comment on column public.broadcasts.audience is
  'Filtro congelado na ativacao: {pipeline_id, stage_id, lead_status, lead_tag, contact_tag, custom_field:{key,value}}. Reprocessar nao re-consulta o funil — o publico ja virou linha.';

-- Vocabulário fechado desde a primeira linha (tabela nova, nenhum clone tem
-- linha legada — justificativa da 0100/0101/0105). Pareado com
-- lib/broadcasts/vocabulario.ts sob o invariante de vocabulário banco×TS.
alter table public.broadcasts drop constraint if exists broadcasts_status_check;
alter table public.broadcasts add constraint broadcasts_status_check
  check (status = any (array['draft', 'scheduled', 'running', 'paused', 'done', 'cancelled']::text[]));

alter table public.broadcasts drop constraint if exists broadcasts_media_type_check;
alter table public.broadcasts add constraint broadcasts_media_type_check
  check (media_type is null or media_type = any (array['audio', 'video', 'image']::text[]));

alter table public.broadcasts drop constraint if exists broadcasts_name_check;
alter table public.broadcasts add constraint broadcasts_name_check
  check (length(btrim(name)) between 1 and 120);

-- Campanha sem texto E sem mídia não tem o que mandar. Barrar aqui (e não só na
-- rota) porque a ativação é o ponto de não-retorno: depois dela existe fila.
alter table public.broadcasts drop constraint if exists broadcasts_tem_conteudo;
alter table public.broadcasts add constraint broadcasts_tem_conteudo
  check (body_template is not null or media_storage_path is not null);

-- Mídia é tudo-ou-nada: path sem tipo faria wahaSendPlanFor cair no sendFile
-- genérico e o áudio chegaria como ANEXO em vez de nota de voz.
alter table public.broadcasts drop constraint if exists broadcasts_midia_coerente;
alter table public.broadcasts add constraint broadcasts_midia_coerente
  check ((media_storage_path is null) = (media_type is null));

-- Teto duro. 10.000 é o mesmo teto de DAILY_LIMIT_BOUNDS (lib/ai/pacing-knobs.ts):
-- acima disso não é campanha, é incidente.
alter table public.broadcasts drop constraint if exists broadcasts_max_recipients_check;
alter table public.broadcasts add constraint broadcasts_max_recipients_check
  check (max_recipients between 1 and 10000);

alter table public.broadcasts drop constraint if exists broadcasts_daily_cap_check;
alter table public.broadcasts add constraint broadcasts_daily_cap_check
  check (daily_cap is null or daily_cap > 0);

-- A leitura da tela: campanhas da org, mais recente primeiro.
create index if not exists idx_broadcasts_org_criacao
  on public.broadcasts (organization_id, created_at desc);

-- A leitura do worker: quem está de pé agora (poucas linhas, varrido a cada minuto).
create index if not exists idx_broadcasts_em_andamento
  on public.broadcasts (status, scheduled_at)
  where status in ('scheduled', 'running');

alter table public.broadcasts enable row level security;

-- Isolamento por tenant, e só por tenant: quem escreve é decisão da rota
-- (`requireRole('manager')`), mesma doutrina da 0105 — regra de papel em policy
-- exigiria replicar ROLE_RANK em SQL e as duas cópias divergiriam.
drop policy if exists tenant_isolation_broadcasts_all on public.broadcasts;
create policy tenant_isolation_broadcasts_all on public.broadcasts
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

-- ---------------------------------------------------------------------------

create table if not exists public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- Procedência: qual card fez este contato entrar. `set null` e não cascade —
  -- apagar o negócio não pode reescrever o histórico do que já foi enviado
  -- (anti-pattern nº 7, cascade fantasma).
  lead_id uuid references public.crm_leads(id) on delete set null,
  status text not null default 'pending',
  -- Por que não recebeu. É o que a tela mostra no lugar de "0 enviados" mudo.
  skip_reason text,
  attempts int not null default 0,
  -- Lease do claim. Tick que morre no meio deixa a lease vencer, e o reaper
  -- procura a mensagem antes de tentar de novo (ver cabeçalho).
  claimed_until timestamptz,
  message_id uuid references public.messages(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.broadcast_recipients is
  'Fila, trava de duplicata e relatorio do disparo (0108), na mesma linha. Nasce na ativacao ANTES de qualquer envio; unique (broadcast_id, contact_id) e o que impede mandar duas vezes pro mesmo contato mesmo que ele tenha 3 cards no funil.';
comment on column public.broadcast_recipients.claimed_until is
  'Lease do claim atomico (fn_claim_due_broadcast_recipients). Vencida = o tick morreu; o reaper procura messages.metadata->>broadcast_recipient_id antes de reenfileirar.';

alter table public.broadcast_recipients drop constraint if exists broadcast_recipients_status_check;
alter table public.broadcast_recipients add constraint broadcast_recipients_status_check
  check (status = any (array['pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled']::text[]));

-- Espelho da `resolucao_datada` da 0082/0094/0101: enviado ⇔ tem carimbo.
alter table public.broadcast_recipients drop constraint if exists broadcast_recipients_envio_datado;
alter table public.broadcast_recipients add constraint broadcast_recipients_envio_datado
  check ((status = 'sent') = (sent_at is not null));

-- A TRAVA CENTRAL. Ver o cabeçalho: dedup do público + idempotência da
-- ativação + fim do "mandei duas vezes" na mesma constraint.
create unique index if not exists uniq_broadcast_recipient
  on public.broadcast_recipients (broadcast_id, contact_id);

-- A leitura quente do worker: o que falta mandar desta campanha.
create index if not exists idx_broadcast_recipients_pendentes
  on public.broadcast_recipients (broadcast_id, created_at)
  where status = 'pending';

-- A leitura do relatório: contagem por status, e o drill-down das falhas.
create index if not exists idx_broadcast_recipients_relatorio
  on public.broadcast_recipients (broadcast_id, status);

-- A volta: "este contato já recebeu disparo?" — usada pela tela do lead e pelo
-- preview (que avisa quem foi disparado há pouco).
create index if not exists idx_broadcast_recipients_contato
  on public.broadcast_recipients (organization_id, contact_id, created_at desc);

alter table public.broadcast_recipients enable row level security;

-- Leitura pelo tenant (é o relatório). ESCRITA só service role: quem cria linha
-- é a ativação e quem muda status é o worker, os dois com admin client. Uma
-- policy de escrita aqui abriria caminho pra marcar `sent` sem ter enviado.
drop policy if exists tenant_isolation_broadcast_recipients_select on public.broadcast_recipients;
create policy tenant_isolation_broadcast_recipients_select on public.broadcast_recipients
  for select
  using (organization_id in (select fn_user_org_ids()));

-- ---------------------------------------------------------------------------
-- Carimbos do BANCO, nunca do processo (lição da 0081: dois relógios derivam).

create or replace function public.fn_carimba_broadcast()
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

drop trigger if exists trg_broadcasts_carimbo on public.broadcasts;
create trigger trg_broadcasts_carimbo
  before insert or update on public.broadcasts
  for each row
  execute function public.fn_carimba_broadcast();

drop trigger if exists trg_broadcast_recipients_carimbo on public.broadcast_recipients;
create trigger trg_broadcast_recipients_carimbo
  before insert or update on public.broadcast_recipients
  for each row
  execute function public.fn_carimba_broadcast();

-- ---------------------------------------------------------------------------
-- Claim atômico do worker (SKIP LOCKED) — service role only.
--
-- Clone de `fn_claim_due_followup_enrollments` (0054), pelo mesmo motivo: o cron
-- roda a cada minuto e um tick lento ainda está de pé quando o próximo começa.
-- Sem SKIP LOCKED os dois pegariam o mesmo destinatário e o lead receberia a
-- mensagem duas vezes — a unique não salva aqui, porque a linha já existe: o
-- que se disputa é o direito de ENVIAR por ela.
--
-- A campanha é filtrada DENTRO da função (não pelo chamador) para que pausar
-- valha no minuto em que se clica: um tick que já tinha lido a lista de
-- campanhas em memória continuaria mandando.
create or replace function public.fn_claim_due_broadcast_recipients(
  p_limit int,
  p_lease_seconds int
)
returns setof public.broadcast_recipients
language sql
security definer
set search_path = public
as $$
  update broadcast_recipients r
  set status = 'sending',
      claimed_until = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where r.id in (
    select br.id
    from broadcast_recipients br
    join broadcasts b on b.id = br.broadcast_id
    where b.status = 'running'
      and (b.scheduled_at is null or b.scheduled_at <= now())
      and br.status = 'pending'
      and (br.claimed_until is null or br.claimed_until < now())
    order by br.created_at
    limit p_limit
    for update of br skip locked
  )
  returning r.*;
$$;

revoke all on function public.fn_claim_due_broadcast_recipients(int, int) from public, anon, authenticated;

-- Fora do realtime: a tela do disparo lê por React Query (polling curto durante
-- a campanha) e publicar sem consumidor é a inversão que o teste da 0078
-- impede. Defensivo, caso a publicação de algum clone seja FOR ALL TABLES.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime drop table public.broadcasts;
    exception when others then null;
    end;
    begin
      alter publication supabase_realtime drop table public.broadcast_recipients;
    exception when others then null;
    end;
  end if;
end $$;
