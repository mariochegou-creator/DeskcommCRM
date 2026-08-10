/**
 * Transcrição da ligação pelo Groq Whisper.
 *
 * Não há cliente HTTP novo aqui de propósito: a API de transcrição do Groq é
 * OpenAI-compatível, e o repo já tem `apiTranscriptionProvider` falando esse
 * dialeto (`lib/messaging/media/transcription.ts`, usada pelo media-derive do
 * WhatsApp). Só troca a base, o modelo e o idioma. Escrever um segundo cliente
 * criaria dois lugares para consertar quando o formato de resposta mudar — e o
 * segundo é sempre o que fica para trás.
 */
import { env } from "@/lib/env";
import {
  apiTranscriptionProvider,
  type TranscriptionProvider,
} from "@/lib/messaging/media/transcription";

/** O Groq serve o dialeto OpenAI em `/openai/v1/...`. */
export const GROQ_BASE_URL = "https://api.groq.com/openai";
export const GROQ_WHISPER_MODEL = "whisper-large-v3";

/**
 * `null` quando não há `GROQ_API_KEY` — o worker traduz isso em
 * `skip="groq_key_missing"` e escreve o motivo na atividade. Lançar aqui viraria
 * um retry inútil cinco vezes contra um problema de configuração que nenhuma
 * tentativa resolve.
 */
export function groqTranscriptionProvider(
  fetchImpl: typeof fetch = fetch,
): TranscriptionProvider | null {
  if (!env.GROQ_API_KEY) return null;
  return apiTranscriptionProvider(
    {
      apiKey: env.GROQ_API_KEY,
      baseUrl: GROQ_BASE_URL,
      model: GROQ_WHISPER_MODEL,
      // pt fixo: a operação é no interior da Bahia. Ver o comentário de
      // `language` em transcription.ts para o que a detecção automática faz com
      // áudio curto de viva-voz.
      language: "pt",
      responseFormat: "verbose_json",
    },
    fetchImpl,
  );
}

export function isGroqConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY);
}
