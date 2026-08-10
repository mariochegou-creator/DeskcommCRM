/**
 * Transcrição de áudio plugável (Onda 3). Default: API speech-to-text
 * OpenAI-compatível (Whisper) via BYOK. O derivado é texto → alimenta QUALQUER
 * modelo de chat (camada universal). Um backend mlx-whisper local implementa a
 * mesma interface para self-host em Apple Silicon (fora deste MVP).
 */
export interface TranscriptionProvider {
  transcribe(audio: Buffer, mime: string): Promise<string>;
}

export interface TranscriptionCreds {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /**
   * ISO-639-1 do idioma falado (`"pt"`). Sem isto o Whisper detecta sozinho, e
   * detectar erra: trecho curto, sotaque regional e áudio abafado de viva-voz
   * são exatamente as condições em que ele confunde português com espanhol — e
   * o SDR receberia a ligação inteira transcrita no idioma errado. Opcional
   * porque o caminho do WhatsApp (media-derive) atende org de qualquer idioma e
   * ali a detecção automática é o comportamento certo.
   */
  language?: string;
  /** `"json"` (default da API) ou `"verbose_json"`, que traz segmentos. */
  responseFormat?: string;
}

const DEFAULT_BASE = "https://api.openai.com";
const DEFAULT_MODEL = "whisper-1";

function extFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  if (base.includes("webm")) return "webm";
  if (base.includes("wav")) return "wav";
  return "bin";
}

export function apiTranscriptionProvider(
  creds: TranscriptionCreds,
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider {
  const base = creds.baseUrl ?? DEFAULT_BASE;
  const model = creds.model ?? DEFAULT_MODEL;
  return {
    async transcribe(audio, mime) {
      const form = new FormData();
      form.append("model", model);
      // Só entram quando pedidos: o caminho antigo (WhatsApp/BYOK OpenAI) segue
      // mandando exatamente os mesmos campos de antes.
      if (creds.language) form.append("language", creds.language);
      if (creds.responseFormat) form.append("response_format", creds.responseFormat);
      form.append(
        "file",
        new Blob([new Uint8Array(audio)], { type: mime.split(";")[0]!.trim() }),
        `audio.${extFor(mime)}`,
      );
      const res = await fetchImpl(`${base}/v1/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        body: form,
      });
      if (!res.ok) throw new Error(`transcription_${res.status}`);
      const json = (await res.json()) as { text?: string };
      return json.text ?? "";
    },
  };
}
