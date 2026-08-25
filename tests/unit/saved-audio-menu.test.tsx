import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A gaveta de áudios prontos: o que precisa ser verdade é que o envio NÃO manda
 * o path da biblioteca direto — ele passa pelo attach (que copia o objeto pra
 * pasta da conversa) e só então vira mensagem type=audio. É essa costura que a
 * checagem de posse do backend exige.
 */
const audios = [
  { id: "a1", title: "Abertura", media_mime: "audio/ogg", media_size_bytes: 900, duration_seconds: 8, owner_user_id: "u1" },
  { id: "a2", title: "Explicando o serviço", media_mime: "audio/ogg", media_size_bytes: 2400, duration_seconds: 25, owner_user_id: null },
  // 0109: a mesma gaveta guarda foto. O tipo sai do mime, não de coluna.
  { id: "f1", title: "Pesquisa Google", media_mime: "image/png", media_size_bytes: 51200, duration_seconds: null, owner_user_id: "u1" },
];

const attachMock = vi.fn(async (args: { id: string; conversationId: string }) =>
  args.id.startsWith("f")
    ? {
        storage_path: "org-1/conv-1/out-copia.png",
        media_mime: "image/png",
        media_size_bytes: 51200,
        kind: "image" as const,
      }
    : {
        storage_path: "org-1/conv-1/out-copia.ogg",
        media_mime: "audio/ogg",
        media_size_bytes: 900,
        kind: "audio" as const,
      },
);
const deleteMock = vi.fn();
const sendMock = vi.fn();

vi.mock("@/hooks/inbox/useSavedAudios", () => ({
  useSavedAudios: () => ({ data: audios, isLoading: false }),
  savedAudioSrc: (id: string) => `/api/v1/saved-audios/${id}/audio`,
  useAttachSavedAudio: () => ({ mutateAsync: attachMock, isPending: false }),
  useDeleteSavedAudio: () => ({ mutate: deleteMock, isPending: false }),
  useCreateSavedAudio: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  usePermission: () => true,
}));

import { SavedAudioMenu } from "@/components/inbox/composer/SavedAudioMenu";

const onSent = vi.fn();

function openDrawer(caption?: string) {
  render(<SavedAudioMenu conversationId="conv-1" caption={caption} onSent={onSent} />);
  fireEvent.click(screen.getByRole("button", { name: /áudios e fotos salvos/i }));
}

describe("SavedAudioMenu", () => {
  beforeEach(() => {
    attachMock.mockClear();
    deleteMock.mockClear();
    sendMock.mockClear();
    onSent.mockClear();
  });

  it("lista os áudios salvos ao abrir a gaveta", async () => {
    openDrawer();
    expect(await screen.findByText("Abertura")).toBeInTheDocument();
    expect(screen.getByText("Explicando o serviço")).toBeInTheDocument();
  });

  it("enviar copia pra conversa (attach) e manda como áudio, com o path da CÓPIA", async () => {
    openDrawer();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /enviar abertura/i }));
    });

    await waitFor(() => expect(attachMock).toHaveBeenCalledWith({ id: "a1", conversationId: "conv-1" }));
    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: "conv-1",
          type: "audio",
          media_storage_path: "org-1/conv-1/out-copia.ogg",
        }),
        expect.anything(),
      ),
    );
  });

  it("excluir pede confirmação antes de apagar", async () => {
    openDrawer();
    fireEvent.click(await screen.findByRole("button", { name: /excluir abertura/i }));
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /^excluir$/i }));
    expect(deleteMock).toHaveBeenCalledWith("a1", expect.anything());
  });

  it("foto vai como imagem, com o texto do composer de legenda, e limpa o composer", async () => {
    openDrawer("Olha onde sua loja aparece");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /enviar pesquisa google/i }));
    });

    await waitFor(() => expect(attachMock).toHaveBeenCalledWith({ id: "f1", conversationId: "conv-1" }));
    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "image",
          body: "Olha onde sua loja aparece",
          media_storage_path: "org-1/conv-1/out-copia.png",
        }),
        expect.anything(),
      ),
    );
    // O onSuccess do mutate é quem chama o onSent; o mock não o executa sozinho.
    sendMock.mock.calls[0]?.[1]?.onSuccess?.();
    expect(onSent).toHaveBeenCalled();
  });

  it("áudio salvo NÃO leva o texto de legenda nem limpa o composer", async () => {
    openDrawer("texto que o vendedor ainda está escrevendo");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /enviar abertura/i }));
    });

    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    expect(sendMock.mock.calls[0]?.[0]).not.toHaveProperty("body");
    sendMock.mock.calls[0]?.[1]?.onSuccess?.();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("gravar novo áudio abre o diálogo de gravação", async () => {
    openDrawer();
    fireEvent.click(await screen.findByRole("button", { name: /gravar novo áudio/i }));
    expect(await screen.findByRole("button", { name: /gravar áudio/i })).toBeInTheDocument();
  });
});
