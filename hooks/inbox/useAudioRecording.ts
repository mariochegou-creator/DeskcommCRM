"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Gravação de voz do browser (MediaRecorder), sem opinião sobre o destino:
 * quem chama decide se o take vira mensagem (AudioRecorder) ou áudio salvo na
 * gaveta (SaveAudioDialog). Um só lugar cuida do microfone — o stream fica
 * aberto enquanto grava e é fechado em TODA saída (parar, cancelar, desmontar).
 */

const PREFERRED_MIMES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus"];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
}

export interface AudioTake {
  blob: Blob;
  mime: string;
  /** Nome do arquivo com a extensão coerente com o mime real do recorder. */
  filename: string;
  seconds: number;
}

export interface AudioRecording {
  recording: boolean;
  elapsed: number;
  /** mm:ss do tempo corrido — a mesma formatação nos dois usos. */
  elapsedLabel: string;
  start: () => Promise<void>;
  /** Para e entrega o take a quem chamou. */
  finish: () => void;
  /** Para e joga fora (nenhum take é entregue). */
  cancel: () => void;
}

export function useAudioRecording(onTake: (take: AudioTake) => void): AudioRecording {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const startingRef = useRef(false);
  const elapsedRef = useRef(0);

  // O callback mais recente sem re-armar o recorder: `onstop` é registrado uma
  // vez por gravação e leria uma closure velha se dependesse do valor direto.
  const onTakeRef = useRef(onTake);
  useEffect(() => {
    onTakeRef.current = onTake;
  }, [onTake]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, [recording]);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  // Trocar de conversa/rota no meio de uma gravação não pode deixar o mic aberto.
  useEffect(
    () => () => {
      discardRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      cleanupStream();
    },
    [],
  );

  const start = useCallback(async () => {
    if (startingRef.current || recording) return;
    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      discardRef.current = false;
      elapsedRef.current = 0;
      setElapsed(0);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        cleanupStream();
        setRecording(false);
        const seconds = elapsedRef.current;
        elapsedRef.current = 0;
        setElapsed(0);
        if (discardRef.current || chunksRef.current.length === 0) return;
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        onTakeRef.current({
          blob,
          mime: type,
          filename: `ptt.${type.includes("ogg") ? "ogg" : "webm"}`,
          seconds,
        });
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      cleanupStream();
      // permissão negada / sem mic — não gravar é o estado final; toast simples
      const { showApiError } = await import("@/components/feedback/ApiErrorToast");
      showApiError(new Error("Não consegui acessar o microfone. Verifique a permissão do navegador."));
    } finally {
      startingRef.current = false;
    }
  }, [recording]);

  // O guard de state é o que faz dois cliques rápidos em "enviar" gerarem um
  // único take (o 2º clique acha o recorder já inativo).
  const finish = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  return {
    recording,
    elapsed,
    elapsedLabel: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`,
    start,
    finish,
    cancel,
  };
}
