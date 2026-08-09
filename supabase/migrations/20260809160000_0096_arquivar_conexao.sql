-- 0096 — archived_at em channel_sessions: remover um número sem perder o histórico
--
-- A Central de Conexões conectava e reconectava, nunca removia. Número parado
-- ficava pra sempre no card, no seletor do inbox e no seletor de canal do
-- agente/roteador — e um filtro preso numa sessão STOPPED já escondeu conversas
-- saudáveis do inbox uma vez (ver ConnectionsClient/InboxLayout).
--
-- ⚠️ Por que arquivar e não DELETE: `conversations` e `messages` referenciam
-- channel_sessions com ON DELETE **RESTRICT** (baseline.sql). O apagão de
-- verdade é impossível assim que o número trocou a primeira mensagem — e é bom
-- que seja: o histórico do WhatsApp está pendurado nessa linha. Então:
--   • número que NUNCA conversou (erro de digitação, QR nunca escaneado) → a
--     rota DELETE apaga a linha de fato (o RESTRICT nem chega a disparar);
--   • número com histórico → carimba archived_at, some de todas as listas, e
--     as conversas antigas continuam abrindo normalmente.
--
-- ⚠️ phone_number é zerado no arquivamento pela rota (não aqui): a unique
-- (organization_id, phone_number) impediria reconectar o MESMO número depois
-- de removê-lo. O rótulo não se perde — a rota copia o número pra display_name
-- antes de zerar.
--
-- ⚠️ NUMERAÇÃO: 0096 segue a sequência do fork nexo-ia (mesmo racional da 0093,
-- 0094 e 0095 — colide de propósito com o upstream origin/main; merge futuro
-- renumera).

alter table public.channel_sessions
  add column if not exists archived_at timestamptz;

comment on column public.channel_sessions.archived_at is
  'Número removido pelo usuário. Não-nulo = fora de toda lista (Conexões, seletor do inbox, canal do agente/roteador) e webhook do WAHA descartado. O histórico de conversas/mensagens continua intacto.';

-- Toda leitura de lista filtra por archived_at is null; o índice parcial cobre
-- exatamente esse predicado (as linhas arquivadas nem entram no índice).
create index if not exists channel_sessions_ativos_idx
  on public.channel_sessions (organization_id, created_at)
  where archived_at is null;
