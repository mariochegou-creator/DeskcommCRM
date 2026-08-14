-- 0105 — Tags do cliente: o catálogo colorido que se configura uma vez e se usa
-- no Kanban e no inbox.
--
-- O QUE FALTAVA. Já havia TRÊS listas de tag no produto, e nenhuma delas
-- respondia ao pedido:
--   `contacts.tags`      — aplicada, aparece na lista do inbox, mas nasce de
--                          texto livre digitado na hora (ou da importação de
--                          prospecção). Sem cor, sem vocabulário.
--   `crm_leads.tags`     — "Tags do negócio", sugestões em
--                          `crm_pipelines.settings.canonical_tags`.
--   `conversations.tags` — "Tags da conversa" (0033), sugestões em
--                          `organizations.settings.canonical_conversation_tags`.
--
-- Nenhuma tem COR, e as duas listas de sugestão vivem em jsonb de settings, que
-- não tem tela: quem quisesse mudar o vocabulário editava o banco. O pedido é o
-- contrário disso — configurar em Configurações e ver a cor na lista do inbox.
--
-- POR QUE O CATÁLOGO É TABELA E A APLICAÇÃO CONTINUA EM `contacts.tags`.
-- O catálogo ganha tabela porque agora tem ATRIBUTO (cor, ordem) e tela de
-- edição — um array jsonb dentro de `organizations.settings` obrigaria a
-- reescrever o array inteiro para trocar uma cor, e é assim que duas abas
-- abertas se sobrescrevem em silêncio.
--
-- Já a APLICAÇÃO fica onde sempre esteve, em `contacts.tags`, e isso é decisão,
-- não preguiça:
--   1. a tabela de junção seria uma SEGUNDA resposta para "quais tags este
--      cliente tem", e a primeira continuaria existindo, populada pela
--      importação de lista e pela API de contatos. Duas fontes para o mesmo
--      fato é o defeito que a 0103 recusou pelo mesmo motivo;
--   2. `contacts.tags` já viaja no SELECT da lista do inbox
--      (`app/api/v1/conversations/_handler.ts` → CONTACT_COLS). A junção pediria
--      um join novo na consulta mais quente do app para exibir um chip;
--   3. a cascata LGPD já zera `contacts.tags` desde a 0019. Uma tabela de
--      junção nasceria FORA da cascata, e "apagar o titular" deixaria as tags
--      dele para trás — o modo de falha que a 0103 documenta.
--
-- O encontro entre os dois é por NOME, normalizado em `lib/tags/cores.ts`
-- (`chaveDaTag`: trim + minúsculas pt-BR). Tag aplicada que não está no
-- catálogo continua aparecendo, em cinza: o histórico de importação não some
-- porque alguém arrumou o vocabulário depois.
--
-- SEM CASCATA LGPD NOVA. Esta tabela guarda vocabulário da organização ("Cliente
-- VIP", "Não perturbar") — configuração, não dado de titular. O que é do
-- titular é a APLICAÇÃO, e ela já está coberta em `contacts.tags`. Reescrever
-- `fn_lgpd_cascade_redact_contact` aqui só arriscaria perder um dos blocos
-- 4b/4c/4d/4e acumulados desde a 0098.
--
-- FORA da publicação `supabase_realtime`: catálogo muda uma vez por mês, a tela
-- lê por React Query e invalida na mutação. Publicar sem consumidor é a
-- inversão que o teste da 0078 impede.
--
-- NNNN=0105 segue a sequência do fork nexo-ia — merge futuro do upstream
-- renumera, mesmo racional da 0094/0098/0100/0101.

create table if not exists public.crm_client_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- O nome COMO SE ESCREVE ("Cliente VIP"). A unicidade é por nome normalizado
  -- (índice funcional abaixo) — o que se digita preserva maiúsculas.
  name text not null,
  color text not null default 'cinza',
  -- Ordem na tela de Configurações e nas listas. `int` e não `float`: a lista
  -- tem dezenas de linhas, não milhares, e reordenar reescreve todas.
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_client_tags is
  'Catalogo de tags do cliente (0105): nome + cor + ordem, por organizacao. A APLICACAO da tag continua em contacts.tags (text[]) — ver o cabecalho da migration. O encontro entre os dois e por nome normalizado (lib/tags/cores.ts, chaveDaTag).';
comment on column public.crm_client_tags.color is
  'Uma das 8 cores da paleta fechada (lib/tags/cores.ts, CORES_DE_TAG). Fechada e nao hex livre: a tag aparece em 10px na lista do inbox e cor digitada nao tem garantia de contraste — mesma decisao que o pill de etapa tomou sobre crm_stages.color.';

-- Vocabulário fechado desde a primeira linha (tabela nova, nenhum clone tem
-- linha legada — justificativa da 0100/0101). Pareado com `CORES_DE_TAG` de
-- lib/tags/cores.ts sob tests/invariants/vocabulario-banco-x-typescript.test.ts.
alter table public.crm_client_tags drop constraint if exists crm_client_tags_color_check;
alter table public.crm_client_tags add constraint crm_client_tags_color_check
  check (color = any (array['cinza', 'azul', 'ciano', 'verde', 'ambar', 'vermelho', 'roxo', 'rosa']::text[]));

-- Nome vazio é linha que não diz nada na tela de Configurações; o teto casa com
-- o Zod (lib/schemas/client-tags.ts) e com o `maxLen` do editor de chips.
alter table public.crm_client_tags drop constraint if exists crm_client_tags_name_check;
alter table public.crm_client_tags add constraint crm_client_tags_name_check
  check (length(btrim(name)) between 1 and 40);

-- "VIP" e "vip" são a MESMA tag, e é isso que faz o chip achar a cor: o que
-- está aplicado em `contacts.tags` foi digitado por gente diferente em telas
-- diferentes. Sem esta unique, o catálogo teria duas linhas com cores distintas
-- e a lista do inbox escolheria uma delas por ordem de leitura.
create unique index if not exists idx_crm_client_tags_nome_unico
  on public.crm_client_tags (organization_id, lower(btrim(name)));

-- A leitura quente: o catálogo inteiro da org, na ordem da tela.
create index if not exists idx_crm_client_tags_ordem
  on public.crm_client_tags (organization_id, position, name);

alter table public.crm_client_tags enable row level security;

-- Isolamento por tenant, e só por tenant: dentro da organização todo mundo LÊ o
-- catálogo (o chip colorido aparece para quem atende, não só para quem
-- configura). Quem pode ESCREVER é decisão da API — `requireRole('manager')` em
-- app/api/v1/client-tags —, do mesmo jeito que a RLS de `crm_pipelines` deixa a
-- hierarquia para a rota. Regra de papel em policy exigiria replicar ROLE_RANK
-- em SQL, e as duas cópias divergiriam.
drop policy if exists tenant_isolation_crm_client_tags_all on public.crm_client_tags;
create policy tenant_isolation_crm_client_tags_all on public.crm_client_tags
  for all
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

-- Carimbos do BANCO, nunca do processo (lição da 0081: dois relógios derivam).
create or replace function public.fn_carimba_crm_client_tag()
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

drop trigger if exists trg_crm_client_tags_carimbo on public.crm_client_tags;
create trigger trg_crm_client_tags_carimbo
  before insert or update on public.crm_client_tags
  for each row
  execute function public.fn_carimba_crm_client_tag();

-- Fora do realtime (ver cabeçalho). Defensivo: se a publicação tiver sido criada
-- como FOR ALL TABLES em algum clone, a tabela entraria sozinha.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'crm_client_tags'
  ) then
    execute 'alter publication supabase_realtime drop table public.crm_client_tags';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Renomear e apagar alcançam o que já foi aplicado.
--
-- As tags aplicadas vivem em `contacts.tags` por NOME (ver o cabeçalho). Sem
-- estas duas funções, renomear "Cliente VIP" para "VIP" deixaria todo mundo
-- marcado com uma tag que sumiu do catálogo — visível na tela, cinza, e sem
-- explicação; e apagar deixaria a marca aplicada para sempre, sem tela nenhuma
-- para removê-la em massa.
--
-- POR QUE SQL E NÃO TYPESCRIPT: o casamento é por nome NORMALIZADO ("VIP" e
-- "vip" são a mesma tag), e o PostgREST não sabe filtrar array por elemento
-- case-insensitive. Em TypeScript, a rota teria de LER todos os contatos com
-- tag da organização para decidir quais mudar — a leitura inteira da tabela
-- para tocar em cinco linhas, e o resultado ainda seria não-atômico.
--
-- SECURITY INVOKER (o padrão, e explícito aqui para quem vier depois não
-- "consertar"): a RLS de `contacts` continua valendo, então a função nunca
-- alcança contato de outra organização — o `p_organization_id` é filtro, não
-- autorização.
-- ---------------------------------------------------------------------------
create or replace function public.fn_renomeia_tag_do_cliente(
  p_organization_id uuid,
  p_de text,
  p_para text
) returns integer
  language sql
  security invoker
  set search_path to 'public', 'pg_temp'
as $function$
  with mexidos as (
    update public.contacts c
       set tags = coalesce((
             select array_agg(distinct case
                      when lower(btrim(t)) = lower(btrim(p_de)) then btrim(p_para)
                      else t
                    end)
               from unnest(c.tags) as t
           ), '{}'::text[])
     where c.organization_id = p_organization_id
       and exists (
             select 1 from unnest(c.tags) as t
              where lower(btrim(t)) = lower(btrim(p_de))
           )
    returning 1
  )
  select count(*)::int from mexidos;
$function$;

comment on function public.fn_renomeia_tag_do_cliente(uuid, text, text) is
  'Renomeia uma tag do cliente em contacts.tags (0105), casando por nome normalizado. array_agg(distinct) tambem resolve o caso de renomear PARA um nome que o contato ja tinha: as duas viram uma.';

create or replace function public.fn_remove_tag_do_cliente(
  p_organization_id uuid,
  p_nome text
) returns integer
  language sql
  security invoker
  set search_path to 'public', 'pg_temp'
as $function$
  with mexidos as (
    update public.contacts c
       set tags = coalesce((
             select array_agg(t)
               from unnest(c.tags) as t
              where lower(btrim(t)) <> lower(btrim(p_nome))
           ), '{}'::text[])
     where c.organization_id = p_organization_id
       and exists (
             select 1 from unnest(c.tags) as t
              where lower(btrim(t)) = lower(btrim(p_nome))
           )
    returning 1
  )
  select count(*)::int from mexidos;
$function$;

comment on function public.fn_remove_tag_do_cliente(uuid, text) is
  'Tira uma tag do cliente de contacts.tags (0105) em toda a organizacao, casando por nome normalizado. O coalesce e necessario: array_agg de zero linhas devolve NULL, e a coluna e NOT NULL.';

-- ---------------------------------------------------------------------------
-- Semente: o catálogo não nasce vazio.
--
-- Tela de configuração vazia não ensina para que serve — e a primeira coisa que
-- se faz numa lista vazia é fechar. As cinco são as que a operação já usa em
-- texto livre. Só onde a org NÃO TEM NENHUMA tag ainda (`not exists`), para o
-- seed não ressuscitar o que alguém apagou de propósito: idempotente e
-- reversível, mesmo padrão do vocabulário da 0033.
-- ---------------------------------------------------------------------------
insert into public.crm_client_tags (organization_id, name, color, position)
select o.id, s.name, s.color, s.position
  from public.organizations o
 cross join (values
   ('Cliente',        'verde',    0),
   ('Interessado',    'azul',     1),
   ('Sem retorno',    'ambar',    2),
   ('Não perturbar',  'vermelho', 3),
   ('Parceiro',       'roxo',     4)
 ) as s(name, color, position)
 where not exists (
   select 1 from public.crm_client_tags t where t.organization_id = o.id
 );
