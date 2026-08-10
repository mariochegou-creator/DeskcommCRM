"use client";
/**
 * O popup de gravação da ligação.
 *
 * Cenário real: o SDR disca no CELULAR, põe no viva-voz ao lado do computador, e
 * o CRM grava pelo microfone do computador. Ou seja — este componente não faz a
 * chamada, ele testemunha uma chamada que acontece fora dele. Daí três coisas
 * que parecem enfeite e não são:
 *
 *  - O NÚMERO EM FONTE GRANDE. É para ser digitado no celular olhando para a
 *    tela. Número pequeno faz o SDR errar um dígito e ligar para um estranho.
 *  - O MEDIDOR DE NÍVEL. É a única prova de que o microfone certo está captando.
 *    Sem ele, descobrir que gravou silêncio custa a ligação inteira — e a
 *    ligação não volta.
 *  - O AVISO DO VIVA-VOZ. Fone de ouvido é o padrão de quem trabalha no
 *    computador, e com fone o microfone não capta o outro lado.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useCall, uploadCallAudio, useStartCall } from "@/hooks/calls/useCalls";
import { STATUS_LABELS, isTerminalCallStatus } from "@/lib/calls/analysis-schema";
import { formatPhoneBR } from "@/lib/calls/phone";
import { Microphone, Pause, Play, X, CircleNotch } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  company?: string | null;
  phoneE164: string;
  origin?: "contact" | "deal";
}

type Fase = "pronto" | "gravando" | "pausado" | "enviando" | "acompanhando" | "erro";

/**
 * Bitrate modesto: é voz, e arquivo pequeno sobe rápido numa conexão ruim, que é
 * a regra e não a exceção no interior. 32 kbps mono em Opus mantém a fala
 * perfeitamente inteligível para o Whisper.
 */
const AUDIO_BITS_PER_SECOND = 32_000;
const CHUNK_MS = 5_000;

/** Preferência de container: Opus onde houver, mp4 no Safari. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidatos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidatos.find((m) => MediaRecorder.isTypeSupported(m));
}

function mmss(totalSegundos: number): string {
  const m = Math.floor(totalSegundos / 60);
  const s = totalSegundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallRecorderDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  company,
  phoneE164,
  origin = "contact",
}: Props) {
  const [fase, setFase] = useState<Fase>("pronto");
  const [callId, setCallId] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [nivel, setNivel] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCall = useStartCall(contactId);
  const call = useCall(callId, { poll: fase === "acompanhando" });
  const status = call.data?.data.status ?? null;

  const gravando = fase === "gravando" || fase === "pausado";

  /** Solta microfone, timer e o loop de animação. Idempotente de propósito. */
  const liberarRecursos = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    // Parar as tracks é o que apaga o indicador de gravação do navegador. Sem
    // isto, o cadeado vermelho fica aceso depois de encerrar e o usuário conclui,
    // com razão, que o CRM continua ouvindo.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setNivel(0);
  }, []);

  useEffect(() => liberarRecursos, [liberarRecursos]);

  /**
   * Fechar a aba no meio da gravação perde a ligação inteira, e o áudio não
   * volta. O `beforeunload` é o único ponto em que o navegador ainda deixa
   * avisar.
   */
  useEffect(() => {
    if (!gravando) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [gravando]);

  const iniciarMedidor = useCallback((stream: MediaStream) => {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return; // sem Web Audio o medidor some, a gravação continua
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      // RMS em torno do silêncio (128) — responde ao volume de fala, não a picos
      // isolados, então a barra não pisca com um clique de teclado.
      let soma = 0;
      for (const v of buffer) {
        const d = (v - 128) / 128;
        soma += d * d;
      }
      const rms = Math.sqrt(soma / buffer.length);
      setNivel(Math.min(1, rms * 4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const iniciarGravacao = useCallback(async () => {
    setErro(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErro(
        "Este navegador não permite gravar áudio nesta página. Abra o CRM em HTTPS (ou localhost) num navegador atualizado.",
      );
      setFase("erro");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false },
      });
    } catch (err) {
      // `echoCancellation: false` é deliberado: o processamento do navegador é
      // afinado para chamada com fone e trata o áudio do viva-voz como eco a
      // suprimir — justamente a voz do lead, que é o que precisamos ouvir.
      const nome = err instanceof DOMException ? err.name : "";
      setErro(
        nome === "NotAllowedError"
          ? "Permissão de microfone negada. Clique no cadeado ao lado do endereço, marque Microfone como “Permitir” e recarregue a página."
          : nome === "NotFoundError"
            ? "Nenhum microfone encontrado. Conecte um microfone e tente de novo."
            : "Não foi possível acessar o microfone.",
      );
      setFase("erro");
      return;
    }

    // A gravação só começa depois de a tentativa estar registrada: se o
    // servidor recusar (contato anonimizado, sem telefone), é melhor descobrir
    // agora que depois de cinco minutos de áudio sem para onde ir.
    let novoCallId: string;
    try {
      const r = await startCall.mutateAsync(origin);
      novoCallId = r.data.call_id;
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setErro("Não foi possível registrar a ligação. Tente novamente.");
      setFase("erro");
      return;
    }

    setCallId(novoCallId);
    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start(CHUNK_MS);

    iniciarMedidor(stream);
    setSegundos(0);
    timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    setFase("gravando");
  }, [iniciarMedidor, origin, startCall]);

  const alternarPausa = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setFase("pausado");
    } else if (rec.state === "paused") {
      rec.resume();
      timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      setFase("gravando");
    }
  }, []);

  const encerrar = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || !callId) return;

    setFase("enviando");
    const duracao = segundos;

    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });

    liberarRecursos();

    try {
      const ext = (rec.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm";
      await uploadCallAudio({
        callId,
        blob,
        filename: `ligacao.${ext}`,
        durationSeconds: duracao,
      });
      setFase("acompanhando");
    } catch (err) {
      showApiError(err);
      setErro(
        err instanceof Error
          ? `O áudio não subiu: ${err.message}`
          : "O áudio não subiu.",
      );
      setFase("erro");
    }
  }, [callId, liberarRecursos, segundos]);

  const podeFechar = !gravando && fase !== "enviando";

  const handleOpenChange = (novo: boolean) => {
    if (!novo && !podeFechar) return; // gravando: fechar por engano perde tudo
    if (!novo) {
      liberarRecursos();
      setFase("pronto");
      setCallId(null);
      setSegundos(0);
      setErro(null);
    }
    onOpenChange(novo);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ligar para {contactName}</DialogTitle>
          <DialogDescription>{company || "Ligação de prospecção"}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface-elevated p-4 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Disque no celular
            </p>
            <p className="mt-1 select-all font-mono text-3xl font-semibold tabular-nums">
              {formatPhoneBR(phoneE164)}
            </p>
          </div>

          <p className="rounded-md border border-warning-fg/30 bg-warning-bg p-3 text-sm text-warning-fg">
            Coloque a chamada no viva-voz, perto do computador.
          </p>

          {erro && (
            <p role="alert" className="rounded-md border border-error-fg/30 bg-error-bg p-3 text-sm text-error-fg">
              {erro}
            </p>
          )}

          {gravando && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-error-fg">
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-2.5 w-2.5 rounded-full bg-error-fg",
                      fase === "gravando" && "animate-pulse",
                    )}
                  />
                  {fase === "gravando" ? "Gravando" : "Pausado"}
                </span>
                <span className="font-mono text-lg tabular-nums">{mmss(segundos)}</span>
              </div>

              <div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-border"
                  role="meter"
                  aria-label="Nível do microfone"
                  aria-valuenow={Math.round(nivel * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-accent-500 transition-[width] duration-75"
                    style={{ width: `${Math.round(nivel * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  A barra tem de se mexer quando alguém fala. Se ficar parada, o microfone
                  não está captando a chamada.
                </p>
              </div>
            </div>
          )}

          {fase === "enviando" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={16} className="animate-spin" aria-hidden />
              Enviando…
            </p>
          )}

          {fase === "acompanhando" && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm">
                {status && !isTerminalCallStatus(status) && (
                  <CircleNotch size={16} className="animate-spin" aria-hidden />
                )}
                <span>{status ? STATUS_LABELS[status] : "Enviando…"}</span>
              </p>
              {status && isTerminalCallStatus(status) && (
                <p className="text-sm text-muted-foreground">
                  {status === "failed"
                    ? (call.data?.data.error_detail ?? "A análise não pôde ser concluída.")
                    : "A análise está na timeline do contato."}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Pode fechar esta janela — o processamento continua e o resultado aparece na
                timeline.
              </p>
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {fase === "pronto" || fase === "erro" ? (
            <Button onClick={() => void iniciarGravacao()} disabled={startCall.isPending}>
              <Microphone size={16} weight="bold" aria-hidden />
              <span>Iniciar gravação</span>
            </Button>
          ) : null}

          {gravando && (
            <>
              <Button variant="outline" onClick={alternarPausa}>
                {fase === "gravando" ? (
                  <>
                    <Pause size={16} weight="bold" aria-hidden />
                    <span>Pausar</span>
                  </>
                ) : (
                  <>
                    <Play size={16} weight="bold" aria-hidden />
                    <span>Retomar</span>
                  </>
                )}
              </Button>
              <Button variant="destructive" onClick={() => void encerrar()}>
                <X size={16} weight="bold" aria-hidden />
                <span>Encerrar ligação</span>
              </Button>
            </>
          )}

          {podeFechar && fase !== "pronto" && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Fechar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
