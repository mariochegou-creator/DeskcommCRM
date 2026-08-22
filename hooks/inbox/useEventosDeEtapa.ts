"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { apiClient } from "@/lib/api/client";
import { CRM_SUMMARY_KEY } from "@/hooks/inbox/useCrmSummary";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { useRefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";
import type { TimelineItemView } from "@/lib/types/contacts";

export const EVENTOS_DE_ETAPA_KEY = "stage-events";

/**
 * As mudanças de etapa do lead, vivas, para quem está com a conversa aberta.
 *
 * ⚠️ ESTE HOOK É QUEM DESTRAVA A ETIQUETA DO CABEÇALHO TAMBÉM, e isso não é
 * efeito colateral: quando o agente move o card, quem escreve é o worker, fora
 * do navegador — nenhuma mutação do cliente acontece, então o
 * `invalidar.ts` (que serve a quem muta pela tela) nunca dispara e o
 * `crm-summary` fica parado. O atendente veria a conversa andando com a etapa
 * de dez minutos atrás, sem nada indicando que está velha.
 *
 * Por isso a chegada de UMA atividade invalida DUAS chaves. Assinar `crm_leads`
 * num segundo canal daria o mesmo resultado por um caminho mais caro e com um
 * defeito próprio: `crm_leads` muda por dezenas de motivos que não interessam
 * ao thread (tag, valor, dono), e cada um recarregaria o painel inteiro.
 *
 * O eixo é o CONTATO porque é o que a conversa conhece — o negócio pode nem
 * existir ainda quando a pessoa manda a primeira mensagem.
 */
export function useEventosDeEtapa(contactId: string | null) {
  const qc = useQueryClient();
  // Memoizada porque entra nas dependências do `onChange`, e um array novo a
  // cada render faria o callback trocar de identidade sem nada ter mudado.
  const queryKey = useMemo(() => [EVENTOS_DE_ETAPA_KEY, contactId] as const, [contactId]);

  const query = useQuery({
    queryKey,
    enabled: !!contactId,
    queryFn: async () => {
      const r = await apiClient.get<{ data: TimelineItemView[] }>(
        `/api/v1/contacts/${contactId}/stage-events`,
      );
      return r.data;
    },
  });

  const onChange = useCallback(() => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: [CRM_SUMMARY_KEY, contactId] });
  }, [qc, queryKey, contactId]);

  // O filtro do supabase-js é simples (uma igualdade), então o canal ouve TODA
  // atividade deste contato e a rota é que separa as de etapa. Ouvir demais e
  // filtrar na leitura custa um refetch a mais de vez em quando; ouvir de menos
  // custaria o evento que este hook existe para mostrar.
  const { ultimaEntrega } = useRealtimeChannel({
    name: contactId ? `stage-events-${contactId}` : "stage-events-disabled",
    postgresChanges: contactId
      ? {
          event: "INSERT",
          schema: "public",
          table: "crm_lead_activities",
          filter: `contact_id=eq.${contactId}`,
        }
      : undefined,
    onChange,
    enabled: !!contactId,
  });

  // A rede de segurança do resto do inbox, pelo mesmo motivo daqui: canal caído
  // não parece caído — parece um lead sem novidade.
  useRefetchDeSeguranca<TimelineItemView[]>({
    queryKey,
    assinatura: (d) => `${d?.length ?? 0}:${d?.[d.length - 1]?.id ?? ""}`,
    ultimaEntrega,
    enabled: !!contactId,
  });

  return query.data ?? [];
}
