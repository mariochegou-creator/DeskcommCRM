"use client";
/**
 * O popup da ligação — copiloto, não gravador.
 *
 * Cenário real: o SDR disca no CELULAR e fala com o lead enquanto o CRM
 * acompanha pelo computador. A primeira versão desta tela só gravava e só
 * mostrava o resultado depois; o SDR não tinha o que olhar durante a conversa e
 * a análise chegava tarde demais para salvar AQUELA ligação. Agora a tela
 * trabalha DURANTE: transcreve em blocos, sopra a próxima frase e marca sozinha
 * o que o roteiro já cobriu.
 *
 * AS TRÊS DECISÕES QUE MANDAM NO LAYOUT:
 *
 *  - A SUGESTÃO É O MAIOR ELEMENTO DA TELA. Uma frase, grande, sempre no mesmo
 *    lugar. O SDR está com o telefone no ouvido: ele tem meio segundo de olhada,
 *    não tem leitura. Todo o resto é secundário por construção.
 *  - O CHECKLIST NÃO DESMARCA. Item que acendeu fica aceso (a mescla acontece no
 *    servidor). Uma caixinha que apaga sozinha faria o SDR achar que a ligação
 *    andou para trás no meio da conversa.
 *  - A TRANSCRIÇÃO É PEQUENA E ROLA SOZINHA. Ela existe para conferir um número
 *    que o lead falou ("foi 30 ou 13?"), não para ser lida. Dar espaço a ela
 *    seria convidar o SDR a ler em vez de conversar.
 *
 * CAPTURA DE ÁUDIO — a mudança que mais melhora a análise. Antes gravávamos só o
 * microfone, com a chamada no viva-voz: a voz do lead chegava abafada e a
 * transcrição saía picotada. Agora misturamos DUAS fontes — o microfone (o SDR)
 * e o áudio do computador (`getDisplayMedia`), que é por onde a voz do lead sai
 * quando o celular está pareado por Bluetooth ou ligado por cabo. Sem o áudio do
 * computador a tela avisa e continua no modo antigo: degradar é melhor que
 * recusar a gravar.
 *
 * O vídeo do `getDisplayMedia` é pedido porque o Chrome não entrega áudio de
 * sistema sem um pedido de vídeo junto, e é DESLIGADO no mesmo instante. Nada da
 * tela é gravado.
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
import {
  enviarBlocoAoVivo,
  uploadCallAudio,
  useCall,
  useSaveCallNotes,
  useStartCall,
} from "@/hooks/calls/useCalls";
import { STATUS_LABELS, isTerminalCallStatus } from "@/lib/calls/analysis-schema";
import {
  COBERTURA_LABELS,
  COBERTURA_VAZIA,
  LIVE_CHUNK_SECONDS,
  type CoberturaKey,
} from "@/lib/calls/live-schema";
import { formatPhoneBR } from "@/lib/calls/phone";
import {
  CheckCircle,
  CircleNotch,
  Lightbulb,
  Microphone,
  MonitorPlay,
  Pause,
  Play,
  Warning,
  X,
} from "@/lib/ui/icons";
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

/** O passo do copiloto. A constante mora no schema — ver o porquê lá. */
const BLOCO_MS = LIVE_CHUNK_SECONDS * 1_000;

/** Pausa de digitação a partir da qual a anotação é salva sozinha. */
const NOTAS_DEBOUNCE_MS = 1_500;

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

  const [temAudioDoComputador, setTemAudioDoComputador] = useState<boolean | null>(null);
  const [transcricao, setTranscricao] = useState("");
  const [sugestao, setSugestao] = useState<string | null>(null);
  const [alerta, setAlerta] = useState<string | null>(null);
  const [cobertura, setCobertura] = useState<Record<string, boolean>>(COBERTURA_VAZIA);
  const [avisoAoVivo, setAvisoAoVivo] = useState<string | null>(null);
  const [notas, setNotas] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const blocoRecRef = useRef<MediaRecorder | null>(null);
  const blocoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontesRef = useRef<MediaStream[]>([]);
  const mixadoRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Enquanto true, o ciclo de blocos se reinicia sozinho ao fim de cada um. */
  const ativoRef = useRef(false);
  /** Fila serial dos envios: um bloco por vez, na ordem em que foram gravados. */
  const filaRef = useRef<Promise<void>>(Promise.resolve());
  const callIdRef = useRef<string | null>(null);
  const segundosRef = useRef(0);
  const transcricaoBoxRef = useRef<HTMLDivElement | null>(null);

  const startCall = useStartCall(contactId);
  const salvarNotas = useSaveCallNotes(callId);
  const call = useCall(callId, { poll: fase === "acompanhando" });
  const status = call.data?.data.status ?? null;

  const gravando = fase === "gravando" || fase === "pausado";

  useEffect(() => {
    segundosRef.current = segundos;
  }, [segundos]);

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  /** A transcrição rola sozinha para o fim — ninguém arrasta barra numa ligação. */
  useEffect(() => {
    const box = transcricaoBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [transcricao]);

  /** Solta microfone, áudio do computador, timer e o loop de animação. */
  const liberarRecursos = useCallback(() => {
    ativoRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (blocoTimerRef.current !== null) {
      clearTimeout(blocoTimerRef.current);
      blocoTimerRef.current = null;
    }
    if (blocoRecRef.current && blocoRecRef.current.state !== "inactive") {
      try {
        blocoRecRef.current.stop();
      } catch {
        /* já parado */
      }
    }
    blocoRecRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    // Parar as tracks é o que apaga o indicador de gravação do navegador. Sem
    // isto, o cadeado vermelho fica aceso depois de encerrar e o usuário conclui,
    // com razão, que o CRM continua ouvindo. Vale para o microfone E para a
    // captura de áudio do computador, que tem barra própria no Chrome.
    fontesRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    fontesRef.current = [];
    mixadoRef.current = null;
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

  /** A anotação salva sozinha depois que ele para de digitar. */
  useEffect(() => {
    if (!callId) return;
    const t = setTimeout(() => salvarNotas.mutate(notas), NOTAS_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `salvarNotas` é recriado a cada render; incluí-lo reiniciaria o debounce a
    // cada tecla e a anotação nunca chegaria a salvar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas, callId]);

  /**
   * Um bloco por vez, na ordem. Sem a fila, dois blocos em voo ao mesmo tempo
   * escreveriam a transcrição fora de ordem no servidor — e a ligação apareceria
   * com as frases trocadas na análise final.
   */
  const enfileirarBloco = useCallback((blob: Blob, at: number) => {
    const id = callIdRef.current;
    if (!id) return;
    filaRef.current = filaRef.current.then(async () => {
      try {
        const r = await enviarBlocoAoVivo({ callId: id, blob, atSeconds: at });
        if (r.texto) setTranscricao((t) => (t ? `${t} ${r.texto}` : r.texto));
        if (r.sugestao) {
          setSugestao(r.sugestao.sugestao);
          setAlerta(r.sugestao.alerta);
          setCobertura(r.sugestao.cobertura);
        }
        setAvisoAoVivo(
          r.transcription_error ? "Um trecho não foi transcrito. A gravação continua." : null,
        );
      } catch {
        // O copiloto é acessório: a gravação da íntegra segue rodando e a
        // análise final sai do mesmo jeito. Avisar sem alarme.
        setAvisoAoVivo("O copiloto está fora do ar. A gravação continua normal.");
      }
    });
  }, []);

  /**
   * O ciclo se reinicia chamando A SI MESMO no `onstop`, e um `useCallback` não
   * pode se referenciar dentro do próprio corpo. O ref é o laço: ele guarda
   * sempre a versão mais recente da função, e o `onstop` a alcança por ele.
   */
  const cicloRef = useRef<() => void>(() => {});

  /** Grava um bloco fechado, manda, e recomeça — enquanto `ativoRef` permitir. */
  const iniciarCicloDeBlocos = useCallback(() => {
    const mixado = mixadoRef.current;
    if (!mixado || !ativoRef.current) return;

    const mimeType = pickMimeType();
    // Gravador NOVO a cada bloco de propósito: um `MediaRecorder` contínuo
    // entrega pedaços de stream que só decodificam em sequência — o segundo
    // pedaço sozinho não é um arquivo, e o Whisper devolveria erro. Reiniciar
    // produz um arquivo completo por bloco, ao custo de um cabeçalho a cada 15 s.
    const rec = new MediaRecorder(mixado, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    const partes: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) partes.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(partes, { type: rec.mimeType || "audio/webm" });
      if (blob.size > 0) enfileirarBloco(blob, segundosRef.current);
      if (ativoRef.current) cicloRef.current();
    };
    blocoRecRef.current = rec;
    rec.start();
    blocoTimerRef.current = setTimeout(() => {
      if (rec.state !== "inactive") rec.stop();
    }, BLOCO_MS);
  }, [enfileirarBloco]);

  useEffect(() => {
    cicloRef.current = iniciarCicloDeBlocos;
  }, [iniciarCicloDeBlocos]);

  const iniciarMedidor = useCallback((ctx: AudioContext, fontes: MediaStreamAudioSourceNode[]) => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    // O analisador NÃO é ligado à saída do contexto: ligar devolveria o áudio da
    // ligação pelos alto-falantes do computador, que o microfone captaria de
    // volta — realimentação em cima de uma ligação real.
    fontes.forEach((f) => f.connect(analyser));
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
    setAvisoAoVivo(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErro(
        "Este navegador não permite gravar áudio nesta página. Abra o CRM em HTTPS num navegador atualizado.",
      );
      setFase("erro");
      return;
    }

    // ---- 1. o microfone (a voz do SDR) ----
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        // `echoCancellation: false` é deliberado: o processamento do navegador é
        // afinado para chamada com fone e trata o áudio do viva-voz como eco a
        // suprimir — justamente a voz do lead, que é o que precisamos ouvir.
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
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

    // ---- 2. o áudio do computador (a voz do lead) ----
    // Opcional por construção: se o SDR cancelar a janela de compartilhamento ou
    // esquecer de marcar "compartilhar áudio", a ligação grava mesmo assim, no
    // modo antigo (viva-voz para o microfone). Recusar aqui perderia a ligação
    // inteira por causa de uma caixinha não marcada.
    let tela: MediaStream | null = null;
    try {
      tela = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      tela = null;
    }
    const trilhaDoComputador = tela?.getAudioTracks()[0] ?? null;
    // O vídeo morre imediatamente: só foi pedido porque o Chrome não entrega
    // áudio de sistema sem um pedido de vídeo junto. Nada da tela é gravado.
    tela?.getVideoTracks().forEach((t) => t.stop());
    setTemAudioDoComputador(Boolean(trilhaDoComputador));

    // ---- 3. registrar a tentativa ----
    // Antes de gravar: se o servidor recusar (contato anonimizado, sem telefone),
    // é melhor descobrir agora que depois de cinco minutos de áudio sem para
    // onde ir.
    let novoCallId: string;
    try {
      const r = await startCall.mutateAsync(origin);
      novoCallId = r.data.call_id;
    } catch {
      mic.getTracks().forEach((t) => t.stop());
      tela?.getTracks().forEach((t) => t.stop());
      setErro("Não foi possível registrar a ligação. Tente novamente.");
      setFase("erro");
      return;
    }

    // ---- 4. misturar as duas fontes numa trilha só ----
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const destino = ctx.createMediaStreamDestination();
    const fontes: MediaStreamAudioSourceNode[] = [ctx.createMediaStreamSource(mic)];
    if (trilhaDoComputador) {
      fontes.push(ctx.createMediaStreamSource(new MediaStream([trilhaDoComputador])));
    }
    fontes.forEach((f) => f.connect(destino));

    fontesRef.current = [mic, ...(tela ? [tela] : [])];
    mixadoRef.current = destino.stream;
    chunksRef.current = [];

    setCallId(novoCallId);
    callIdRef.current = novoCallId;
    setTranscricao("");
    setSugestao(null);
    setAlerta(null);
    setCobertura(COBERTURA_VAZIA);
    setNotas("");
    filaRef.current = Promise.resolve();

    // ---- 5. gravador da íntegra ----
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(destino.stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start(CHUNK_MS);

    // ---- 6. copiloto ----
    ativoRef.current = true;
    iniciarCicloDeBlocos();

    iniciarMedidor(ctx, fontes);
    setSegundos(0);
    segundosRef.current = 0;
    timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    setFase("gravando");
  }, [iniciarCicloDeBlocos, iniciarMedidor, origin, startCall]);

  const alternarPausa = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      // `ativoRef` cai ANTES de parar o bloco: é o que impede o `onstop` de
      // reiniciar o ciclo durante a pausa.
      ativoRef.current = false;
      if (blocoTimerRef.current !== null) {
        clearTimeout(blocoTimerRef.current);
        blocoTimerRef.current = null;
      }
      if (blocoRecRef.current && blocoRecRef.current.state !== "inactive") {
        blocoRecRef.current.stop(); // manda o bloco parcial e não reinicia
      }
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setFase("pausado");
    } else if (rec.state === "paused") {
      rec.resume();
      ativoRef.current = true;
      iniciarCicloDeBlocos();
      timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      setFase("gravando");
    }
  }, [iniciarCicloDeBlocos]);

  const encerrar = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || !callId) return;

    setFase("enviando");
    const duracao = segundos;

    // O ciclo de blocos para AQUI: o último bloco é fechado e enfileirado antes
    // de o áudio íntegro subir.
    ativoRef.current = false;
    if (blocoTimerRef.current !== null) {
      clearTimeout(blocoTimerRef.current);
      blocoTimerRef.current = null;
    }
    if (blocoRecRef.current && blocoRecRef.current.state !== "inactive") {
      blocoRecRef.current.stop();
    }

    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });

    liberarRecursos();

    // Esperar a fila esvaziar não é capricho: o upload do áudio DISPARA a
    // análise, e ela lê a transcrição que estes blocos ainda estão escrevendo.
    // Subir antes faria a análise sair sem o último minuto da ligação. O teto de
    // 30 s existe para que um bloco preso na rede não segure o SDR na tela —
    // passado o prazo, o worker refaz a transcrição pelo áudio íntegro (ele
    // compara a contagem de blocos com a duração; ver a migration 0106).
    await Promise.race([filaRef.current, new Promise((r) => setTimeout(r, 30_000))]);

    try {
      if (notas.trim()) await salvarNotas.mutateAsync(notas);
    } catch {
      // Anotação perdida não pode impedir o áudio de subir.
    }

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
      setErro(err instanceof Error ? `O áudio não subiu: ${err.message}` : "O áudio não subiu.");
      setFase("erro");
    }
  }, [callId, liberarRecursos, notas, salvarNotas, segundos]);

  const podeFechar = !gravando && fase !== "enviando";

  const handleOpenChange = (novo: boolean) => {
    if (!novo && !podeFechar) return; // gravando: fechar por engano perde tudo
    if (!novo) {
      liberarRecursos();
      setFase("pronto");
      setCallId(null);
      setSegundos(0);
      setErro(null);
      setTranscricao("");
      setSugestao(null);
      setAlerta(null);
      setCobertura(COBERTURA_VAZIA);
      setNotas("");
      setAvisoAoVivo(null);
      setTemAudioDoComputador(null);
    }
    onOpenChange(novo);
  };

  const itensDoChecklist = Object.entries(COBERTURA_LABELS) as [CoberturaKey, string][];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ligar para {contactName}</DialogTitle>
          <DialogDescription>{company || "Ligação de qualificação"}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* ---- antes de começar: o número e o combinado ---- */}
          {(fase === "pronto" || fase === "erro") && (
            <>
              <div className="rounded-md border border-border bg-surface-elevated p-4 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Disque no celular
                </p>
                <p className="mt-1 select-all font-mono text-3xl font-semibold tabular-nums">
                  {formatPhoneBR(phoneE164)}
                </p>
              </div>

              <div className="rounded-md border border-border bg-surface-elevated p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <MonitorPlay size={16} weight="duotone" aria-hidden />
                  Para o copiloto ouvir o lead
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>
                    Ligue o celular no computador (Bluetooth ou cabo) e deixe o som da chamada sair
                    por ele.
                  </li>
                  <li>
                    Ao clicar em Iniciar, o navegador pede para compartilhar a tela —{" "}
                    <strong className="text-fg">marque “Compartilhar áudio”</strong> e escolha a tela
                    inteira.
                  </li>
                  <li>
                    Sem isso ainda funciona: deixe a chamada no viva-voz perto do computador.
                  </li>
                </ol>
              </div>
            </>
          )}

          {erro && (
            <p
              role="alert"
              className="rounded-md border border-error-fg/30 bg-error-bg p-3 text-sm text-error-fg"
            >
              {erro}
            </p>
          )}

          {/* ---- durante a ligação ---- */}
          {gravando && (
            <>
              {/* a sugestão: o maior elemento da tela, sempre no mesmo lugar */}
              <div
                aria-live="polite"
                className={cn(
                  "rounded-lg border p-4",
                  sugestao
                    ? "border-accent-500/50 bg-accent-500/10"
                    : "border-dashed border-border bg-surface-elevated",
                )}
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Lightbulb size={14} weight="duotone" aria-hidden />
                  Fale agora
                </p>
                <p className="mt-1 text-xl font-semibold leading-snug">
                  {sugestao ?? "Ouvindo a conversa…"}
                </p>
              </div>

              {alerta && (
                <p className="flex items-center gap-2 rounded-md border border-warning-fg/30 bg-warning-bg p-3 text-sm font-medium text-warning-fg">
                  <Warning size={16} weight="fill" aria-hidden />
                  {alerta}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {/* checklist do roteiro */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Roteiro
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {itensDoChecklist.map(([chave, rotulo]) => {
                      const feito = Boolean(cobertura[chave]);
                      return (
                        <li key={chave} className="flex items-start gap-2 text-sm">
                          <CheckCircle
                            size={18}
                            weight={feito ? "fill" : "regular"}
                            aria-hidden
                            className={cn(
                              "mt-0.5 shrink-0",
                              feito ? "text-success-fg" : "text-muted-foreground/40",
                            )}
                          />
                          <span className={cn(feito ? "text-fg" : "text-muted-foreground")}>
                            {rotulo}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* transcrição — pequena de propósito */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Transcrição
                  </h4>
                  <div
                    ref={transcricaoBoxRef}
                    className="mt-2 h-32 overflow-y-auto rounded-md border border-border bg-surface-elevated p-2 text-xs leading-relaxed text-muted-foreground"
                  >
                    {transcricao || "As falas aparecem aqui alguns segundos depois."}
                  </div>
                </div>
              </div>

              {/* anotação do SDR */}
              <div>
                <label
                  htmlFor="anotacao-ligacao"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Sua anotação
                </label>
                <textarea
                  id="anotacao-ligacao"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={2}
                  placeholder="O que ficou combinado, quem decide, o que ele falou fora do roteiro…"
                  className="mt-1 w-full rounded-md border border-border bg-surface-elevated p-2 text-sm outline-none focus:border-accent-500"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Salva sozinha e entra na análise da ligação.
                </p>
              </div>

              {/* estado da captura */}
              <div className="space-y-2">
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

                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-border"
                  role="meter"
                  aria-label="Nível do áudio"
                  aria-valuenow={Math.round(nivel * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-accent-500 transition-[width] duration-75"
                    style={{ width: `${Math.round(nivel * 100)}%` }}
                  />
                </div>

                {temAudioDoComputador === false && (
                  <p className="rounded-md border border-warning-fg/30 bg-warning-bg p-2 text-xs text-warning-fg">
                    Sem o áudio do computador: a voz do lead só entra se a chamada estiver no
                    viva-voz perto do microfone.
                  </p>
                )}
                {avisoAoVivo && <p className="text-xs text-muted-foreground">{avisoAoVivo}</p>}
              </div>
            </>
          )}

          {fase === "enviando" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={16} className="animate-spin" aria-hidden />
              Fechando a ligação e enviando o áudio…
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
                    : "A análise está na timeline do contato e na tela de Ligações."}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Pode fechar esta janela — o processamento continua.
              </p>
              {transcricao && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-surface-elevated p-2 text-xs text-muted-foreground">
                  {transcricao}
                </div>
              )}
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
