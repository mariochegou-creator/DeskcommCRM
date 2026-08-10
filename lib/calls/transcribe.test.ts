import { describe, expect, it } from "vitest";

import { apiTranscriptionProvider } from "@/lib/messaging/media/transcription";

/**
 * O que este teste protege: **a ligação não pode ser transcrita no idioma
 * errado.**
 *
 * `language=pt` não é otimização. Áudio curto, sotaque do interior da Bahia e a
 * voz abafada de um viva-voz são exatamente as condições em que a detecção
 * automática do Whisper erra para espanhol — e o SDR recebe a ligação inteira
 * transcrita noutro idioma, com a análise em cima disso. O campo é opcional na
 * interface (o caminho do WhatsApp atende org de qualquer idioma), então nada
 * além deste teste garante que o caminho das ligações o esteja mandando.
 */
describe("apiTranscriptionProvider — campos opcionais", () => {
  it("manda language e response_format quando pedidos", async () => {
    let enviado: FormData | null = null;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      enviado = init?.body as FormData;
      return new Response(JSON.stringify({ text: "bom dia" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = apiTranscriptionProvider(
      {
        apiKey: "k",
        baseUrl: "https://api.groq.com/openai",
        model: "whisper-large-v3",
        language: "pt",
        responseFormat: "verbose_json",
      },
      fakeFetch,
    );

    const texto = await provider.transcribe(Buffer.from([1, 2, 3]), "audio/webm;codecs=opus");

    expect(texto).toBe("bom dia");
    expect(enviado!.get("language")).toBe("pt");
    expect(enviado!.get("response_format")).toBe("verbose_json");
    expect(enviado!.get("model")).toBe("whisper-large-v3");
  });

  it("NÃO manda os campos quando ausentes — o caminho do WhatsApp não muda", async () => {
    let enviado: FormData | null = null;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      enviado = init?.body as FormData;
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = apiTranscriptionProvider({ apiKey: "k" }, fakeFetch);
    await provider.transcribe(Buffer.from([1]), "audio/ogg");

    expect(enviado!.get("language")).toBeNull();
    expect(enviado!.get("response_format")).toBeNull();
  });

  it("bate na URL do dialeto OpenAI do Groq", async () => {
    let url = "";
    const fakeFetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ text: "" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = apiTranscriptionProvider(
      { apiKey: "k", baseUrl: "https://api.groq.com/openai" },
      fakeFetch,
    );
    await provider.transcribe(Buffer.from([1]), "audio/webm");

    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });
});
