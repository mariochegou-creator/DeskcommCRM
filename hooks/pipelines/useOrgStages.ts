"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { OrgStage } from "@/lib/kanban/types";

/**
 * As etapas ativas de todos os funis da org, já na ordem do quadro.
 *
 * `staleTime` alto de propósito: etapa de funil muda em tela de configuração,
 * não no dia a dia do inbox — refazer esta leitura a cada foco de aba seria
 * gastar rede para reconfirmar o que ninguém mudou.
 */
export function useOrgStages(orgId: string | null) {
  return useQuery({
    queryKey: ["org-stages", orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgStage[]> => {
      const res = await apiClient.get<{ data: OrgStage[] }>("/api/v1/stages");
      return res.data;
    },
  });
}
