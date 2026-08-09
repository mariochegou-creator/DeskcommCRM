-- 0097 — v_channel_session_atividade: quanto cada número está trabalhando
--
-- ⚠️ O QUE ISTO EVITA (aconteceu em 09/08/2026): a Central mostrava os números
-- só com nome de sessão e status. Dois números "Conectado", nenhum jeito de
-- saber qual estava vivo — e o número REMOVIDO foi o que tinha 118 mensagens
-- na semana e a última dois minutos antes do clique. O que ficou no painel era
-- o duplicado morto, sem mensagem desde 5 dias antes.
--
-- Status não distingue número vivo de número esquecido. Atividade distingue.
--
-- ⚠️ A agregação sai de `conversations`, não de `messages`, de propósito:
-- conversations já tem last_message_at com índice (idx_conversations_org_last_msg)
-- e é ordens de grandeza menor. Um group by direto em messages seria seq scan —
-- não existe índice por (channel_session_id, created_at).
--
-- security_invoker = true: a view roda com a permissão de quem consulta, então
-- a RLS de conversations continua valendo. Sem isso a view furaria o isolamento
-- entre organizações.
--
-- ⚠️ NUMERAÇÃO: 0097 segue a sequência do fork nexo-ia (mesmo racional da 0093
-- a 0096 — colide de propósito com o upstream origin/main).

create or replace view public.v_channel_session_atividade
with (security_invoker = true) as
select
  c.organization_id,
  c.channel_session_id,
  max(c.last_message_at)                                              as ultima_mensagem_em,
  count(*) filter (
    where c.last_message_at > now() - interval '7 days'
  )::int                                                              as conversas_7d,
  count(*)::int                                                       as conversas_total
from public.conversations c
where c.channel_session_id is not null
group by c.organization_id, c.channel_session_id;

comment on view public.v_channel_session_atividade is
  'Atividade por número de WhatsApp: última mensagem e conversas dos últimos 7 dias. Alimenta o card da Central de Conexões e o aviso de "este número está trabalhando" antes de remover.';
