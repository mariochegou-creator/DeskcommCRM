import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * O relógio do cabeçalho da conversa DEPOIS da 0101.
 *
 * O botão parou de abrir um menu de três durações e passou a abrir o dialog de
 * tarefas, com o adiar preservado dentro dele. Os dois caminhos são testados
 * aqui porque a regressão que importa é justamente a de perder o antigo ao
 * ganhar o novo: adiar a conversa continua sendo um clique a partir do relógio.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    patch: vi.fn(),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

const showApiErrorMock = vi.fn();
vi.mock("@/components/feedback/ApiErrorToast", () => ({
  showApiError: (...args: unknown[]) => showApiErrorMock(...args),
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-1", full_name: "Mario" } }),
}));

import { SnoozeButton } from "@/components/inbox/SnoozeButton";

function wrap(ui: React.ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  deleteMock.mockReset();
  showApiErrorMock.mockReset();
  // Toda leitura desta tela (tarefas da conversa, membros, resumo do CRM) cai
  // no mesmo apiClient.get — devolver a forma vazia de cada uma mantém o teste
  // sobre o comportamento do botão, não sobre os dados.
  getMock.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/v1/tasks")) return { data: { tasks: [] } };
    return { data: [] };
  });
});

describe("SnoozeButton", () => {
  it("sem tarefa nem lembrete: o botão diz 'Tarefa' e abre o dialog", async () => {
    render(wrap(<SnoozeButton conversationId="conv-1" snoozeUntil={null} />));

    fireEvent.click(screen.getByRole("button", { name: /^tarefa$/i }));

    expect(await screen.findByText("Tarefa e lembrete")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("Ligar para o lead");
  });

  it("adiar a conversa continua a um clique: '3 horas' chama o snooze com duration_hours:3", async () => {
    postMock.mockResolvedValue({ data: { snooze_until: "2026-08-11T20:00:00.000Z" } });

    render(wrap(<SnoozeButton conversationId="conv-1" snoozeUntil={null} />));
    fireEvent.click(screen.getByRole("button", { name: /^tarefa$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "3 horas" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/api/v1/conversations/conv-1/snooze", {
        duration_hours: 3,
      }),
    );
  });

  it("com lembrete ativo o rótulo muda e o dialog oferece cancelar", async () => {
    deleteMock.mockResolvedValue(undefined);
    const futuro = new Date(Date.now() + 3_600_000).toISOString();

    render(wrap(<SnoozeButton conversationId="conv-1" snoozeUntil={futuro} />));

    fireEvent.click(screen.getByRole("button", { name: /lembrete ativo/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith("/api/v1/conversations/conv-1/snooze"),
    );
  });

  it("criar tarefa manda título, tipo, prazo e o vínculo da conversa", async () => {
    postMock.mockResolvedValue({ data: { task: { id: "t-1" } } });

    render(
      wrap(
        <SnoozeButton
          conversationId="conv-1"
          snoozeUntil={null}
          contactId="contact-1"
          nomeDoLead="GNG Solar"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /^tarefa$/i }));
    expect(await screen.findByLabelText("Título")).toHaveValue("Ligar para GNG Solar");

    fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/api/v1/tasks", expect.anything()));
    const corpo = postMock.mock.calls.find((c) => c[0] === "/api/v1/tasks")?.[1] as Record<
      string,
      unknown
    >;
    expect(corpo).toMatchObject({
      title: "Ligar para GNG Solar",
      kind: "ligar",
      conversation_id: "conv-1",
      contact_id: "contact-1",
      assigned_to_user_id: "user-1",
    });
    // O atalho pré-selecionado é "em 1 hora": prazo no futuro, sempre.
    expect(Date.parse(corpo.due_at as string)).toBeGreaterThan(Date.now());
  });

  it("disabled prop desabilita o botão", () => {
    render(wrap(<SnoozeButton conversationId="conv-1" snoozeUntil={null} disabled />));
    expect(screen.getByRole("button", { name: /^tarefa$/i })).toBeDisabled();
  });

  it("erro ao adiar chama showApiError", async () => {
    postMock.mockRejectedValue(new Error("falhou"));

    render(wrap(<SnoozeButton conversationId="conv-1" snoozeUntil={null} />));
    fireEvent.click(screen.getByRole("button", { name: /^tarefa$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "1 hora" }));

    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalled());
  });
});
