-- 0103 — Mais de um contato por negócio (o decisor que o lead manda no meio da
-- conversa)
--
-- O caso é diário na prospecção: o SDR fala com quem atendeu o WhatsApp, e a
-- pessoa manda o cartão de outro — "fala com meu sócio", "o financeiro é a
-- Maria". Hoje esse número morre na conversa: `crm_leads.contact_id` é UM só, e
-- trocá-lo perderia quem já vinha respondendo. Na prática o SDR salvava o
-- número na agenda do celular, e o CRM nunca ficava sabendo que o negócio tinha
-- duas portas.
--
-- SEM TABELA NOVA, e isso é decisão, não economia. `crm_lead_links` já É o
-- vínculo polimórfico do lead, e `target_kind='contact'` já é caminho VIVO:
-- a cascata LGPD (0019 → 0071 → 0098 → 0100 → 0101) varre exatamente este par
-- em CINCO blocos para achar os leads de um titular. Criar `crm_lead_contatos`
-- ao lado seria uma segunda resposta para "quais contatos este negócio tem" —
-- e a cascata continuaria lendo só a primeira, que é o modo de falha em que o
-- apagamento diz que apagou e não apagou.
--
-- POR ISSO ESTA MIGRATION NÃO REESCREVE `fn_lgpd_cascade_redact_contact`: o
-- vínculo que ela habilita já está coberto pela versão vigente (a da 0101), e
-- o `metadata` do link NÃO GUARDA PII — nome e telefone vivem em `contacts`,
-- que é anonimizado no passo 1. O que entra no metadata é procedência
-- (`{"origem":"vcard","message_id":…}`), que é registro operacional. Guardar o
-- nome ali para "poupar um join" seria criar uma segunda cópia do dado pessoal
-- fora do alcance da cascata — a cópia que sobrevive ao apagamento.
--
-- SEM CHECK EM `link_kind`, pela doutrina de `crm_lead_activities.type`: a
-- coluna é compartilhada com vínculos de pedido e de conversa, e um CHECK de
-- conjunto nela quebraria o `update.sh` de qualquer clone com um valor legado.
-- O vocabulário mora em lib/leads/papel-do-contato.ts e prende quem escreve
-- daqui. Por não ter CHECK, este par NÃO entra em
-- tests/invariants/vocabulario-banco-x-typescript.test.ts — aquele invariante
-- cobre apenas colunas que já têm CHECK, como o próprio cabeçalho dele avisa.
--
-- FORA da publicação `supabase_realtime`: a lista é lida por React Query e
-- invalidada na mutação, como em 0101.
--
-- NNNN=0103 segue a sequência do fork nexo-ia (0102 foi o nono dígito).

-- ---------------------------------------------------------------------------
-- 1. O mesmo contato não entra duas vezes no mesmo negócio
-- ---------------------------------------------------------------------------
-- O botão do inbox é de um clique e a conversa continua rolando: adicionar o
-- cartão do sócio duas vezes é o erro ÓBVIO deste fluxo, não um caso de borda.
-- Sem isto, "2 contatos para chamar" viraria o mesmo número contado duas vezes
-- — o pior tipo de contagem, porque parece informação nova.
--
-- Parcial em `target_kind='contact'`: pedido e conversa têm cardinalidade
-- própria e não podem herdar esta regra.
create unique index if not exists uq_crm_lead_links_contato_por_negocio
  on public.crm_lead_links (lead_id, target_id)
  where target_kind = 'contact';

-- ---------------------------------------------------------------------------
-- 2. A leitura quente: "quem eu chamo neste negócio"
-- ---------------------------------------------------------------------------
-- Roda a cada abertura do dossiê no kanban e a cada conversa aberta no inbox.
create index if not exists idx_crm_lead_links_contatos_do_negocio
  on public.crm_lead_links (organization_id, lead_id)
  where target_kind = 'contact';

-- A volta: "em quais negócios esta pessoa aparece". É o caminho que a cascata
-- LGPD já percorre cinco vezes por titular anonimizado (0101), hoje sem índice.
create index if not exists idx_crm_lead_links_negocios_do_contato
  on public.crm_lead_links (organization_id, target_id)
  where target_kind = 'contact';

comment on column public.crm_lead_links.link_kind is
  'O PAPEL do vínculo. Para target_kind=''contact'' (0103) é quem a pessoa é dentro do negócio: decisor|socio|financeiro|tecnico|outro — vocabulário em lib/leads/papel-do-contato.ts. Sem CHECK de propósito: a coluna é compartilhada com vínculos de pedido/conversa e um conjunto fechado quebraria clones com valor legado.';

comment on column public.crm_lead_links.metadata is
  'Procedência do vínculo, NUNCA dado pessoal: {"origem":"vcard"|"manual","message_id":…}. Nome e telefone vivem em contacts, que a cascata LGPD anonimiza — copiá-los para cá criaria a cópia que sobrevive ao apagamento.';

-- Defensivo, como na 0101: se a publicação tiver sido criada como FOR ALL
-- TABLES em algum clone, a tabela entraria no realtime sozinha.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'crm_lead_links'
  ) then
    execute 'alter publication supabase_realtime drop table public.crm_lead_links';
  end if;
end $$;
