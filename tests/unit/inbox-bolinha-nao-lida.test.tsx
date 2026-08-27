/**
 * A BOLINHA DO AVATAR SÓ APARECE COM MENSAGEM DO LEAD POR LER.
 *
 * O defeito relatado em 27/08/2026: o card "70x7 Expositores" mostrava a
 * bolinha azul sem ter mensagem nova nenhuma. A bolinha era colorida por STATUS
 * (`claimed` = azul), não por não-lida — e naquela conversa a última mensagem
 * era NOSSA, respondida às 17:25.
 *
 * Medido no banco no dia: das 8 conversas `claimed`, 7 estavam marcadas sem ter
 * nada por ler; e 49 conversas `open` com mensagem do cliente esperando saíam
 * com o cinza apagado. A marca dizia o contrário do que era lida.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// O chip de tag lê o catálogo por react-query; aqui só a bolinha importa.
vi.mock("@/hooks/tags/useClientTags", () => ({
  useClientTags: () => ({ data: [], isLoading: false }),
}));

import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

afterEach(cleanup);

function conversa(over: Partial<ConversationWithContact> = {}): ConversationWithContact {
  return {
    id: "c1",
    organization_id: "o1",
    contact_id: "ct1",
    channel_session_id: null,
    channel: "whatsapp",
    status: "open",
    assigned_to_user_id: null,
    assignee_kind: null,
    last_inbound_at: "2026-08-27T15:52:42Z",
    last_outbound_at: null,
    last_message_at: "2026-08-27T15:52:42Z",
    last_message_preview: "[audio]",
    unread_count_for_assignee: 0,
    is_group: false,
    tags: [],
    metadata: {},
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-27T15:52:42Z",
    contacts: {
      id: "ct1",
      name: "bp.expositores",
      display_name: "70x7 Expositores",
      phone_number: "+5577999999999",
      tags: [],
      is_anonymized: false,
      is_blocked: false,
    },
    ...over,
  } as unknown as ConversationWithContact;
}

/** A bolinha é o único `rounded-full` posicionado sobre o avatar. */
function temBolinha(container: HTMLElement): boolean {
  return container.querySelector("span.absolute.rounded-full") !== null;
}

function desenhar(c: ConversationWithContact, isSelected = false) {
  return render(
    <ConversationListItem conversation={c} isSelected={isSelected} onSelect={() => {}} />,
  );
}

describe("bolinha do avatar", () => {
  it("NÃO aparece na conversa atribuída sem nada por ler — o caso relatado", () => {
    const { container } = desenhar(
      conversa({
        status: "claimed",
        assignee_kind: "user",
        assigned_to_user_id: "u1",
        unread_count_for_assignee: 0,
        last_outbound_at: "2026-08-27T17:25:48Z",
      }),
    );
    expect(temBolinha(container)).toBe(false);
  });

  it("aparece quando o lead mandou mensagem e ninguém abriu", () => {
    const { container } = desenhar(conversa({ unread_count_for_assignee: 2 }));
    expect(temBolinha(container)).toBe(true);
  });

  it("some assim que a conversa está aberta na tela", () => {
    const { container } = desenhar(conversa({ unread_count_for_assignee: 2 }), true);
    expect(temBolinha(container)).toBe(false);
  });

  it("status não decide mais nada: fechada com não-lida ainda marca", () => {
    const { container } = desenhar(
      conversa({ status: "closed", unread_count_for_assignee: 1 }),
    );
    expect(temBolinha(container)).toBe(true);
  });

  it("a IA tocando a conversa, sem não-lida, não marca", () => {
    const { container } = desenhar(
      conversa({ status: "ai_handling", unread_count_for_assignee: 0 }),
    );
    expect(temBolinha(container)).toBe(false);
  });
});
