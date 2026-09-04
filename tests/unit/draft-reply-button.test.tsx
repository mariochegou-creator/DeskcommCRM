import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

const postMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) },
}));

const showApiErrorMock = vi.fn();
vi.mock("@/components/feedback/ApiErrorToast", () => ({
  showApiError: (...args: unknown[]) => showApiErrorMock(...args),
}));

import { DraftReplyButton } from "@/components/inbox/composer/DraftReplyButton";

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

const TRES = {
  data: {
    sugestoes: [
      { angulo: "pergunta direta", texto: "Quem responde o WhatsApp aí hoje?" },
      { angulo: "prova", texto: "Fiz a busca e mandei o print." },
      { angulo: "convite", texto: "Fica melhor segunda ou terça?" },
    ],
    fontes: ["as últimas 12 mensagens desta conversa", "a cola do mercado"],
  },
};

beforeEach(() => {
  postMock.mockReset();
  showApiErrorMock.mockReset();
});

describe("DraftReplyButton", () => {
  it("clicar dispara a mutation e desabilita enquanto pendente", async () => {
    let resolvePost!: (v: unknown) => void;
    postMock.mockReturnValue(new Promise((resolve) => (resolvePost = resolve)));
    const onDraft = vi.fn();

    render(wrap(<DraftReplyButton conversationId="conv-1" onDraft={onDraft} campoOcupado={false} />));
    const btn = screen.getByRole("button", { name: "Sugerir resposta" });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/api/v1/conversations/conv-1/draft-reply", {}),
    );
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("aria-busy", "true");

    resolvePost(TRES);
    await waitFor(() => expect(screen.getByText("prova")).toBeInTheDocument());
  });

  /**
   * O ponto do botão depois da mudança: ele NÃO mexe no campo sozinho. Quem
   * clicava com um texto pela metade escrito perdia o texto — e o clique era num
   * botão de ajuda.
   */
  it("mostrar as opções não toca no campo; só a escolha manda o texto", async () => {
    postMock.mockResolvedValue(TRES);
    const onDraft = vi.fn();

    render(wrap(<DraftReplyButton conversationId="conv-1" onDraft={onDraft} campoOcupado={false} />));
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));

    await waitFor(() => expect(screen.getByText("pergunta direta")).toBeInTheDocument());
    expect(onDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Usar esta" })[1]!);
    expect(onDraft).toHaveBeenCalledWith("Fiz a busca e mandei o print.");
  });

  it("com o campo ocupado o rótulo avisa que vai substituir", async () => {
    postMock.mockResolvedValue(TRES);
    render(wrap(<DraftReplyButton conversationId="conv-1" onDraft={vi.fn()} campoOcupado />));
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Substituir pelo texto" })).toHaveLength(3),
    );
  });

  it("as fontes aparecem na tela — sugestão que não se confere não se usa", async () => {
    postMock.mockResolvedValue(TRES);
    render(wrap(<DraftReplyButton conversationId="conv-1" onDraft={vi.fn()} campoOcupado={false} />));
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));

    await waitFor(() =>
      expect(screen.getByText(/as últimas 12 mensagens desta conversa/)).toBeInTheDocument(),
    );
  });

  it("erro chama showApiError e não chama onDraft", async () => {
    postMock.mockRejectedValue(new Error("falhou"));
    const onDraft = vi.fn();

    render(wrap(<DraftReplyButton conversationId="conv-1" onDraft={onDraft} campoOcupado={false} />));
    fireEvent.click(screen.getByRole("button", { name: "Sugerir resposta" }));

    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalled());
    expect(onDraft).not.toHaveBeenCalled();
  });

  it("disabled prop desabilita o botão", () => {
    render(
      wrap(<DraftReplyButton conversationId="conv-1" onDraft={vi.fn()} campoOcupado={false} disabled />),
    );
    expect(screen.getByRole("button", { name: "Sugerir resposta" })).toBeDisabled();
  });
});
