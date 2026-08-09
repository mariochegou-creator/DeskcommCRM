import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guardar um áudio na gaveta: grava → OUVE → nomeia → salva. O take fica em
 * memória até o "Salvar" (regravar não pode deixar lixo no bucket), e o nome
 * é obrigatório — gaveta com "áudio 1, áudio 2" não serve pra escolher rápido.
 */
const createMock = vi.fn(async (_args: unknown) => ({ id: "a9" }));

vi.mock("@/hooks/inbox/useSavedAudios", () => ({
  useCreateSavedAudio: () => ({ mutateAsync: createMock, isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  usePermission: () => true,
}));

import { SaveAudioDialog } from "@/components/inbox/composer/SaveAudioDialog";

class FakeRecorder {
  static isTypeSupported = () => true;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  mimeType = "audio/ogg;codecs=opus";
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    if (opts?.mimeType) this.mimeType = opts.mimeType;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2])], { type: this.mimeType }) });
    this.onstop?.();
  }
}

async function gravaUmTake() {
  fireEvent.click(screen.getByRole("button", { name: /gravar áudio/i }));
  const parar = await screen.findByRole("button", { name: /parar/i });
  await act(async () => {
    fireEvent.click(parar);
  });
}

describe("SaveAudioDialog", () => {
  beforeEach(() => {
    createMock.mockClear();
    vi.stubGlobal("MediaRecorder", FakeRecorder as unknown as typeof MediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    });
    URL.createObjectURL = vi.fn(() => "blob:take");
    URL.revokeObjectURL = vi.fn();
  });

  it("sem gravação, salvar fica desabilitado", () => {
    render(<SaveAudioDialog onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /^salvar$/i })).toBeDisabled();
  });

  it("gravou mas não nomeou: salvar continua desabilitado", async () => {
    render(<SaveAudioDialog onClose={() => {}} />);
    await gravaUmTake();
    expect(await screen.findByLabelText(/ouvir a gravação/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^salvar$/i })).toBeDisabled();
  });

  it("gravar + nomear + salvar manda o blob com o título e fecha", async () => {
    const onClose = vi.fn();
    render(<SaveAudioDialog onClose={onClose} />);
    await gravaUmTake();
    fireEvent.change(await screen.findByLabelText(/nome do áudio/i), { target: { value: "abertura" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^salvar$/i }));
    });

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "abertura", shared: false, filename: "ptt.ogg" }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("com o switch ligado, salva como compartilhado do time", async () => {
    render(<SaveAudioDialog onClose={() => {}} />);
    await gravaUmTake();
    fireEvent.change(await screen.findByLabelText(/nome do áudio/i), { target: { value: "abertura" } });
    fireEvent.click(screen.getByLabelText(/compartilhar com o time/i));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^salvar$/i }));
    });

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ shared: true })));
  });

  it("regravar joga o take fora e volta pro microfone", async () => {
    render(<SaveAudioDialog onClose={() => {}} />);
    await gravaUmTake();
    fireEvent.click(await screen.findByRole("button", { name: /regravar/i }));
    expect(screen.getByRole("button", { name: /gravar áudio/i })).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
