/**
 * Onde o áudio da ligação mora e o que o bucket aceita.
 *
 * Bucket `call-recordings` (migration 0100), privado. O caminho começa pelo
 * `organization_id` como o do `whatsapp-media`: é o prefixo que torna
 * "tudo desta org" uma listagem, o que a redação LGPD e a exclusão de tenant
 * precisam para não varrer o bucket inteiro procurando por dono.
 */

export const CALL_BUCKET = "call-recordings";

/** 100 MB — o mesmo `file_size_limit` do bucket na migration 0100. */
export const MAX_CALL_AUDIO_BYTES = 100 * 1024 * 1024;

/**
 * Os mimes que a rota aceita, mapeados para extensão.
 *
 * ALLOWLIST, nunca blocklist, e o valor não vem do nome do arquivo: `file.name`
 * é string escolhida por quem faz o upload, e confiar nela é como se escreve
 * `.exe` num bucket de áudio. O que decide é o `type` do Blob conferido contra
 * este mapa; o que não estiver aqui é recusado com o motivo na resposta.
 *
 * `audio/webm` é o que o `MediaRecorder` do Chrome/Firefox produz e `audio/mp4`
 * é o do Safari — os dois caminhos do popup. O resto cobre o plano B (gravador
 * do celular, WhatsApp exportado).
 */
const MIME_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm", // o MediaRecorder rotula assim mesmo em trilha só de áudio
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
};

/** O mime base (sem `;codecs=...`), normalizado. */
export function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

export function isAllowedCallMime(mime: string | null | undefined): boolean {
  return normalizeMime(mime) in MIME_EXT;
}

export function callAudioExt(mime: string | null | undefined): string {
  return MIME_EXT[normalizeMime(mime)] ?? "bin";
}

/** `{org}/{contato}/{gravação}.{ext}` — ver a razão do prefixo no topo. */
export function callStoragePath(
  organizationId: string,
  contactId: string,
  callId: string,
  mime: string,
): string {
  return `${organizationId}/${contactId}/${callId}.${callAudioExt(mime)}`;
}

/** A lista para o `accept` do input de arquivo, derivada do mesmo mapa. */
export const CALL_AUDIO_ACCEPT = Object.keys(MIME_EXT).join(",");
