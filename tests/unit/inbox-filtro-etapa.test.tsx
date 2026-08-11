/**
 * O filtro de ETAPA do inbox — "me mostra só quem já está em R1 marcada".
 *
 * O que esta superfície precisa garantir: o select existe quando a org tem
 * funil, escolher uma etapa devolve o id dela (não o nome, que se repete entre
 * funis), e "Todas as etapas" LIMPA o filtro em vez de virar um id inventado.
 *
 * O recorte de verdade — quem chega à lista — é do join no handler, provado em
 * tests/unit/inbox-lista-ordenacao.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InboxFilters, type InboxFiltersValue } from "@/components/inbox/InboxFilters";
import type { ActiveOrg } from "@/lib/auth/types";
import type { OrgStage } from "@/lib/kanban/types";

const activeOrgRef: { current: ActiveOrg | null } = { current: null };
const stagesRef: { current: OrgStage[] } = { current: [] };

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: activeOrgRef.current }),
}));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: [] }),
}));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({ data: {} }),
}));
vi.mock("@/hooks/pipelines/useOrgStages", () => ({
  useOrgStages: () => ({ data: stagesRef.current }),
}));

const PROSPECCAO = "7abdf83a-91ea-40f0-9c10-a57110ca6acd";
const PEDIDOS = "89f7087d-2835-4f72-aab2-bada6a5e2375";
const R1 = "999af389-c481-408a-a142-671589a48522";

const ETAPAS: OrgStage[] = [
  { id: "s-1", name: "A contatar", pipeline_id: PROSPECCAO, pipeline_name: "Prospecção" },
  { id: R1, name: "R1 agendada", pipeline_id: PROSPECCAO, pipeline_name: "Prospecção" },
  { id: "s-3", name: "Pago", pipeline_id: PEDIDOS, pipeline_name: "Pedidos" },
];

const VALUE: InboxFiltersValue = { tab: "all", search: "", onlyUnread: false };

// O jsdom não implementa Pointer Capture nem scrollIntoView, e o Select do
// Radix chama os dois ao abrir. Sem estes dublês o teste morre no clique — não
// por causa do componente, mas do ambiente.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  activeOrgRef.current = { orgId: "org-1", name: "Org", role: "manager", visibility_mode: "all" };
  stagesRef.current = ETAPAS;
});
afterEach(cleanup);

describe("filtro de etapa do funil no inbox", () => {
  it("escolher uma etapa devolve o ID dela", async () => {
    const onChange = vi.fn();
    render(<InboxFilters value={VALUE} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("Filtrar por etapa do funil"));
    await userEvent.click(await screen.findByRole("option", { name: "R1 agendada" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stage_id: R1 }));
  });

  it("'Todas as etapas' limpa o filtro — undefined, nunca a string 'all'", async () => {
    const onChange = vi.fn();
    render(<InboxFilters value={{ ...VALUE, stage_id: R1 }} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("Filtrar por etapa do funil"));
    await userEvent.click(await screen.findByRole("option", { name: "Todas as etapas" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ stage_id: undefined }));
  });

  it("com mais de um funil, o nome do funil aparece — 'Pago' existe em mais de um quadro", async () => {
    render(<InboxFilters value={VALUE} onChange={() => {}} />);

    await userEvent.click(screen.getByLabelText("Filtrar por etapa do funil"));

    expect(await screen.findByText("Prospecção")).toBeInTheDocument();
    expect(screen.getByText("Pedidos")).toBeInTheDocument();
  });

  it("org sem funil nenhum: o campo não aparece (em vez de um select vazio)", () => {
    stagesRef.current = [];
    render(<InboxFilters value={VALUE} onChange={() => {}} />);

    expect(screen.queryByLabelText("Filtrar por etapa do funil")).not.toBeInTheDocument();
  });
});
