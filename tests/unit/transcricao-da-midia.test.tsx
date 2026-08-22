import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TranscricaoDaMidia } from "@/components/inbox/TranscricaoDaMidia";
import type { Message } from "@/lib/types/messaging";

function msg(over: Partial<Message>): Message {
  return {
    id: "m1",
    organization_id: "o",
    conversation_id: "c",
    channel_session_id: "s",
    contact_id: "ct",
    external_id: null,
    type: "audio",
    direction: "inbound",
    status: "received",
    ack: null,
    error_code: null,
    error_message: null,
    body: null,
    media_url: "https://x/a.ogg",
    media_mime: "audio/ogg",
    media_size_bytes: 1,
    media_storage_path: "p",
    media_derived_text: null,
    media_derived_status: null,
    sent_via: "user",
    sent_by_user_id: null,
    sent_at: "2026-08-22T12:00:00Z",
    delivered_at: null,
    read_at: null,
    metadata: {},
    created_at: "2026-08-22T12:00:00Z",
    ...over,
  };
}

describe("TranscricaoDaMidia", () => {
  it("mostra o texto do áudio COM o rótulo de que é transcrição", () => {
    // O rótulo não é enfeite: sem ele, quem lê o histórico meses depois atribui
    // ao cliente uma frase que a máquina escreveu — e transcrição erra nome,
    // número e valor.
    render(
      <TranscricaoDaMidia
        message={msg({ media_derived_text: "Meu problema é que ninguém responde no domingo.", media_derived_status: "ready" })}
        isOutbound={false}
      />,
    );
    expect(screen.getByText("Transcrição do áudio")).toBeTruthy();
    expect(screen.getByText(/ninguém responde no domingo/)).toBeTruthy();
  });

  it("enquanto não voltou, diz que está transcrevendo", () => {
    render(<TranscricaoDaMidia message={msg({ media_derived_status: "pending" })} isOutbound={false} />);
    expect(screen.getByText(/Transcrevendo o áudio/)).toBeTruthy();
  });

  it("quando falha, manda dar o play — não fica em silêncio", () => {
    // Silêncio aqui seria indistinguível de "ainda está vindo", e as duas
    // leituras pedem ações opostas: uma é esperar, a outra é ouvir.
    render(<TranscricaoDaMidia message={msg({ media_derived_status: "failed" })} isOutbound={false} />);
    expect(screen.getByText(/Não deu para transcrever/)).toBeTruthy();
  });

  it("áudio ANTIGO (sem status e sem texto) não promete transcrição que nunca vem", () => {
    const { container } = render(<TranscricaoDaMidia message={msg({})} isOutbound={false} />);
    expect(container.textContent).toBe("");
  });

  it("figurinha não ganha bloco nenhum", () => {
    const { container } = render(
      <TranscricaoDaMidia message={msg({ type: "sticker", media_derived_status: "pending" })} isOutbound={false} />,
    );
    expect(container.textContent).toBe("");
  });

  it("imagem é DESCRIÇÃO, não transcrição — o rótulo tem que dizer a verdade", () => {
    render(
      <TranscricaoDaMidia
        message={msg({ type: "image", media_derived_text: "Foto da fachada da loja.", media_derived_status: "ready" })}
        isOutbound={false}
      />,
    );
    expect(screen.getByText("Descrição da imagem")).toBeTruthy();
  });
});
