-- 0099 — o contador de não-lidas zera quando o operador responde pelo próprio
-- WhatsApp (celular / WhatsApp Web), não só pelo composer do CRM.
--
-- `fn_mark_conversation_message` só sabia SOMAR: inbound incrementava, outbound
-- não mexia. Como nada zerava do lado do banco, o número azul da lista virava um
-- acumulador vitalício — a conversa aparecia com "1", "2", "3" mesmo depois de
-- respondida, e o operador lia aquilo como se contasse a mensagem que ELE tinha
-- acabado de mandar (é o último item da conversa, afinal). O badge conta
-- mensagem do contato AGUARDANDO RESPOSTA; respondida, a espera acabou.
--
-- Por que a regra pode ser "todo outbound zera" sem risco de apagar um aviso
-- real: mensagem enviada PELO CRM volta no webhook como `fromMe=true` e morre no
-- dedup por `external_id` (23505) ANTES de chamar esta função — ver o retorno
-- antecipado em `handleOutboundFromUserPhone` (lib/waha/ingest.ts). Então o
-- outbound que chega aqui é o que nasceu fora do CRM, ou seja: uma pessoa
-- digitando no aparelho. Cadência automática e agente de IA passam pelo handler
-- da API, que decide zerar ou não por tipo de ator — e deliberadamente NÃO zera.
create or replace function public.fn_mark_conversation_message(
  p_conv uuid,
  p_direction text,   -- 'inbound' | 'outbound'
  p_preview text,
  p_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set
    last_message_at = p_at,
    last_message_preview = p_preview,
    last_inbound_at  = case when p_direction = 'inbound'  then p_at else last_inbound_at  end,
    last_outbound_at = case when p_direction = 'outbound' then p_at else last_outbound_at end,
    unread_count_for_assignee = case
      when p_direction = 'inbound' then unread_count_for_assignee + 1
      else 0
    end,
    updated_at = now()
  where id = p_conv;
end;
$$;

comment on function public.fn_mark_conversation_message is
  'Atualiza agregados de timeline da conversa. Inbound incrementa o não-lido; outbound (resposta digitada no aparelho do operador) zera — o badge conta mensagem do contato aguardando resposta.';

revoke all on function public.fn_mark_conversation_message(uuid, text, text, timestamptz) from public;
grant execute on function public.fn_mark_conversation_message(uuid, text, text, timestamptz) to service_role;

-- Backfill: conversa cuja última mensagem já é do operador não está aguardando
-- nada — o contador é resíduo do comportamento antigo. Não toca em conversa com
-- inbound mais recente que o outbound (essa espera de verdade).
update public.conversations
set unread_count_for_assignee = 0
where unread_count_for_assignee > 0
  and last_outbound_at is not null
  and (last_inbound_at is null or last_inbound_at <= last_outbound_at);
