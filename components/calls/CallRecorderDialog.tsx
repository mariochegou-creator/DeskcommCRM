"use client";
/**
 * O popup da ligação — copiloto, não gravador.
 *
 * O SDR clica em Ligar, o Windows disca pelo Vincular ao Telefone (o `tel:` do
 * navegador cai nele) e a chamada acontece no headset. O CRM ouve os dois lados,
 * transcreve em blocos, sopra a próxima frase e marca sozinho o que o roteiro já
 * cobriu. A análise completa sai segundos depois de desligar.
 *
 * DE ONDE VEM CADA VOZ — a decisão central deste arquivo. São duas entradas
 * SEPARADAS, escolhidas na tela e lembradas entre ligações:
 *
 *  - SUA VOZ: o microfone do headset. O padrão é o dispositivo "communications"
 *    do Windows, que é justamente o que o sistema usa em chamada — trocar de
 *    headset no Windows troca aqui junto, sem ninguém reconfigurar nada.
 *  - VOZ DO LEAD: quando o celular está pareado, o Windows expõe a chamada como
 *    um microfone ("… Hands-Free …"). Gravar dali é o caminho limpo: chega em
 *    trilha própria, sem eco e SEM pedir compartilhamento de tela. Se esse
 *    dispositivo não existir, caímos no áudio do computador
 *    (`getDisplayMedia`), e em último caso no viva-voz para o microfone.
 *
 * As duas trilhas são misturadas numa só antes de gravar, porque tanto o Whisper
 * quanto a análise leem um arquivo de voz — não uma sessão de dois canais.
 *
 * AS TRÊS DECISÕES QUE MANDAM NO LAYOUT:
 *
 *  - A SUGESTÃO É O MAIOR ELEMENTO DA TELA. Uma frase, grande, sempre no mesmo
 *    lugar. O SDR está com o telefone no ouvido: ele tem meio segundo de olhada,
 *    não tem leitura. Todo o resto é secundário por construção.
 *  - O CHECKLIST NÃO DESMARCA. Item que acendeu fica aceso (a mescla acontece no
 *    servidor). Uma caixinha que apaga sozinha faria o SDR achar que a ligação
 *    andou para trás no meio da conversa.
 *  - DOIS MEDIDORES, NÃO UM. Um por voz. É a única forma de descobrir ANTES do
 *    fim que só metade da conversa está entrando — e ligação não volta.
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
  CALL_PHASE_LABELS,
  COBERTURA_LABELS,
  COBERTURA_VAZIA,
  DEGRAU_LABELS,
  LIVE_CHUNK_SECONDS,
  OBJECAO_LABELS,
  type CallPhase,
  type CoberturaKey,
  type DegrauDaDor,
  type Objecao,
} from "@/lib/calls/live-schema";
import { rotuloDoEixo } from "@/lib/calls/palavras-eixo";
import { formatPhoneBR } from "@/lib/calls/phone";
import {
  CheckCircle,
  CircleNotch,
  HandPalm,
  Lightbulb,
  Microphone,
  Pause,
  Phone,
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

/**
 * A escolha de áudio vive no NAVEGADOR, não no banco: ela descreve esta máquina
 * (qual headset está plugado nela), não o usuário. O mesmo SDR num computador
 * diferente tem outros dispositivos, e sincronizar isso pelo servidor faria a
 * máquina B herdar o headset da máquina A e gravar silêncio.
 */
const CHAVE_MIC = "nexo.ligacao.microfone";
const CHAVE_LEAD = "nexo.ligacao.voz-do-lead";

/** Valor especial: a voz do lead vem do áudio do computador, não de um device. */
const LEAD_SISTEMA = "sistema";

/**
 * O endpoint que o Windows cria quando o celular está pareado por Bluetooth.
 *
 * Ele aparece como MICROFONE ("Microfone (Fulano Hands-Free HF Audio)") e o que
 * chega por ele é a chamada. É a fonte preferida da voz do lead: trilha própria,
 * sem eco de sala e sem a janela de compartilhamento de tela.
 */
function pareceCelularPareado(label: string): boolean {
  return /hands[- ]?free|hf audio|ag audio/i.test(label);
}

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

function lerPreferencia(chave: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null; // navegador com storage bloqueado: cai no automático
  }
}

function gravarPreferencia(chave: string, valor: string): void {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* sem storage: a escolha vale só para esta ligação */
  }
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
  const [nivelMic, setNivelMic] = useState(0);
  const [nivelLead, setNivelLead] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const [entradas, setEntradas] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [leadId, setLeadId] = useState<string>(LEAD_SISTEMA);
  const [temVozDoLead, setTemVozDoLead] = useState<boolean | null>(null);

  const [transcricao, setTranscricao] = useState("");
  const [sugestao, setSugestao] = useState<string | null>(null);
  /**
   * Em que etapa do ROTEIRO a ligação está — nada a ver com `fase` acima, que é
   * o estado do gravador (pronto/gravando/enviando). Vem calculada do checklist
   * no servidor, não da opinião do modelo: ver `faseDaCobertura`.
   */
  const [etapa, setEtapa] = useState<CallPhase | null>(null);
  /** Em que degrau da dor a conversa está. Fora da fase "dor", null. */
  const [degrau, setDegrau] = useState<DegrauDaDor | null>(null);
  /** "calar" quando a coisa certa é esperar — a regra da aula 03 do caderno. */
  const [tipo, setTipo] = useState<string>("falar");
  /** A palavra-eixo travada. Uma vez escolhida, ela fica na tela até o fim. */
  const [eixo, setEixo] = useState<string | null>(null);
  /** Qual resposta pronta está na tela, quando o dono soltou uma objeção. */
  const [objecao, setObjecao] = useState<string | null>(null);
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

  /**
   * Descobrir as entradas de áudio quando o popup abre.
   *
   * O `getUserMedia` de uma linha antes do `enumerateDevices` não é desperdício:
   * sem permissão concedida o navegador devolve a lista com os RÓTULOS VAZIOS, e
   * uma lista de "Microfone 1 / Microfone 2" é impossível de escolher. Com a
   * permissão, os nomes reais aparecem — e é pelo nome que se reconhece o
   * celular pareado.
   */
  const carregarDispositivos = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const provisorio = await navigator.mediaDevices.getUserMedia({ audio: true });
      provisorio.getTracks().forEach((t) => t.stop());
    } catch {
      /* permissão negada: a lista vem sem rótulo, e a escolha manual ainda vale */
    }

    const todos = await navigator.mediaDevices.enumerateDevices();
    const audio = todos.filter((d) => d.kind === "audioinput");
    setEntradas(audio);

    const salvoMic = lerPreferencia(CHAVE_MIC);
    const micValido = salvoMic && audio.some((d) => d.deviceId === salvoMic) ? salvoMic : null;
    // "communications" é o dispositivo que o Windows usa EM CHAMADA. Preferi-lo
    // faz o CRM seguir o headset que o sistema já escolheu, em vez de guardar um
    // id fixo que semana que vem aponta para um fone desconectado.
    const comms = audio.find((d) => d.deviceId === "communications")?.deviceId;
    setMicId(micValido ?? comms ?? audio[0]?.deviceId ?? "");

    const salvoLead = lerPreferencia(CHAVE_LEAD);
    const leadValido =
      salvoLead === LEAD_SISTEMA || (salvoLead && audio.some((d) => d.deviceId === salvoLead))
        ? salvoLead
        : null;
    const celular = audio.find((d) => pareceCelularPareado(d.label))?.deviceId;
    setLeadId(leadValido ?? celular ?? LEAD_SISTEMA);
  }, []);

  useEffect(() => {
    if (open) void carregarDispositivos();
  }, [open, carregarDispositivos]);

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
    // com razão, que o CRM continua ouvindo.
    fontesRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    fontesRef.current = [];
    mixadoRef.current = null;
    recorderRef.current = null;
    setNivelMic(0);
    setNivelLead(0);
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
   * Entrega o número ao Windows.
   *
   * Um `<a href="tel:">` clicado, e não `window.location`: a navegação por
   * `location` faz o Chrome tratar a página como saindo, e num popup que está
   * gravando isso é a diferença entre discar e perder a gravação. O clique num
   * link some com esse risco, e o Windows manda o número para o app registrado
   * no protocolo `tel:` — o Vincular ao Telefone, que disca pelo celular
   * pareado.
   */
  const discar = useCallback(() => {
    const link = document.createElement("a");
    link.href = `tel:${phoneE164}`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [phoneE164]);

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
          setEtapa((r.sugestao.fase as CallPhase | null) ?? null);
          setDegrau((r.sugestao.degrau as DegrauDaDor | null) ?? null);
          setTipo(r.sugestao.tipo ?? "falar");
          setEixo(r.sugestao.eixo ?? null);
          setObjecao(r.sugestao.objecao ?? null);
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
   * pode se referenciar dentro do próprio corpo. O ref é o laço: guarda sempre a
   * versão mais recente da função, e o `onstop` a alcança por ele.
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

  /**
   * Um medidor por voz.
   *
   * Os analisadores NÃO são ligados à saída do contexto: ligar devolveria o
   * áudio da ligação pelos alto-falantes, que o microfone captaria de volta —
   * realimentação em cima de uma ligação real.
   */
  const iniciarMedidores = useCallback(
    (ctx: AudioContext, minha: AudioNode, doLead: AudioNode | null) => {
      const criar = (fonte: AudioNode) => {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        fonte.connect(analyser);
        // `new ArrayBuffer(n)` em vez de `new Uint8Array(n)`: a assinatura de
        // `getByteTimeDomainData` exige um Uint8Array respaldado por ArrayBuffer,
        // e o construtor por tamanho devolve o tipo genérico (que aceitaria um
        // SharedArrayBuffer).
        const buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        return { analyser, buffer };
      };

      const a = criar(minha);
      const b = doLead ? criar(doLead) : null;

      // RMS em torno do silêncio (128) — responde ao volume de fala, não a picos
      // isolados, então a barra não pisca com um clique de teclado.
      const rms = (par: { analyser: AnalyserNode; buffer: Uint8Array<ArrayBuffer> }) => {
        par.analyser.getByteTimeDomainData(par.buffer);
        let soma = 0;
        for (const v of par.buffer) {
          const d = (v - 128) / 128;
          soma += d * d;
        }
        return Math.min(1, Math.sqrt(soma / par.buffer.length) * 4);
      };

      const tick = () => {
        setNivelMic(rms(a));
        setNivelLead(b ? rms(b) : 0);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [],
  );

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

    // Nunca com processamento: eco, ruído e ganho automático do navegador são
    // afinados para chamada com fone e tratam a voz que vem do outro lado como
    // ruído a suprimir — justamente o que precisamos ouvir.
    const cru = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

    // ---- 1. sua voz (o microfone do headset) ----
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { ...cru, channelCount: 1, ...(micId ? { deviceId: { exact: micId } } : {}) },
      });
    } catch (err) {
      const nome = err instanceof DOMException ? err.name : "";
      setErro(
        nome === "NotAllowedError"
          ? "Permissão de microfone negada. Clique no cadeado ao lado do endereço, marque Microfone como “Permitir” e recarregue a página."
          : nome === "NotFoundError" || nome === "OverconstrainedError"
            ? "O microfone escolhido sumiu (headset desligado?). Escolha outro na lista e tente de novo."
            : "Não foi possível acessar o microfone.",
      );
      setFase("erro");
      return;
    }

    // ---- 2. a voz do lead ----
    let vozDoLead: MediaStream | null = null;
    if (leadId !== LEAD_SISTEMA) {
      // Caminho bom: o celular pareado entrega a chamada como um microfone.
      try {
        vozDoLead = await navigator.mediaDevices.getUserMedia({
          audio: { ...cru, deviceId: { exact: leadId } },
        });
      } catch {
        vozDoLead = null;
      }
    } else {
      // Caminho de reserva: o áudio do computador. O vídeo é pedido porque o
      // Chrome não entrega áudio de sistema sem um pedido de vídeo junto, e é
      // desligado no mesmo instante — nada da tela é gravado.
      try {
        const tela = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: cru });
        tela.getVideoTracks().forEach((t) => t.stop());
        if (tela.getAudioTracks().length > 0) {
          vozDoLead = tela;
        } else {
          tela.getTracks().forEach((t) => t.stop());
        }
      } catch {
        vozDoLead = null;
      }
    }
    setTemVozDoLead(Boolean(vozDoLead));

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
      vozDoLead?.getTracks().forEach((t) => t.stop());
      setErro("Não foi possível registrar a ligação. Tente novamente.");
      setFase("erro");
      return;
    }

    // ---- 4. misturar as duas vozes numa trilha só ----
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const destino = ctx.createMediaStreamDestination();
    const fonteMic = ctx.createMediaStreamSource(mic);
    fonteMic.connect(destino);
    let fonteLead: MediaStreamAudioSourceNode | null = null;
    if (vozDoLead) {
      fonteLead = ctx.createMediaStreamSource(vozDoLead);
      fonteLead.connect(destino);
    }

    fontesRef.current = [mic, ...(vozDoLead ? [vozDoLead] : [])];
    mixadoRef.current = destino.stream;
    chunksRef.current = [];

    setCallId(novoCallId);
    callIdRef.current = novoCallId;
    setTranscricao("");
    setSugestao(null);
    setEtapa(null);
    setDegrau(null);
    setTipo("falar");
    setEixo(null);
    setObjecao(null);
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

    iniciarMedidores(ctx, fonteMic, fonteLead);
    setSegundos(0);
    segundosRef.current = 0;
    timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    setFase("gravando");

    // ---- 7. e só então discar ----
    // Por último de propósito: quando o telefone começa a chamar, tudo que
    // precisa gravar já está gravando. Discar primeiro custaria os primeiros
    // segundos da ligação, que é onde mora a abertura.
    discar();
  }, [discar, iniciarCicloDeBlocos, iniciarMedidores, leadId, micId, origin, startCall]);

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
      setEtapa(null);
      setDegrau(null);
      setTipo("falar");
      setEixo(null);
      setObjecao(null);
      setAlerta(null);
      setCobertura(COBERTURA_VAZIA);
      setNotas("");
      setAvisoAoVivo(null);
      setTemVozDoLead(null);
    }
    onOpenChange(novo);
  };

  const itensDoChecklist = Object.entries(COBERTURA_LABELS) as [CoberturaKey, string][];
  const calando = tipo === "calar" && Boolean(sugestao);
  const rotuloEixo = rotuloDoEixo(eixo);
  const rotuloObjecao = objecao ? (OBJECAO_LABELS[objecao as Objecao] ?? null) : null;
  const rotulo = (d: MediaDeviceInfo, i: number) =>
    d.label || (d.deviceId === "default" ? "Padrão do Windows" : `Entrada de áudio ${i + 1}`);
  const celularNaLista = entradas.some((d) => pareceCelularPareado(d.label));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ligar para {contactName}</DialogTitle>
          <DialogDescription>{company || "Ligação de qualificação"}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* ---- antes de começar: número, áudio e o que vai acontecer ---- */}
          {(fase === "pronto" || fase === "erro") && (
            <>
              <div className="rounded-md border border-border bg-surface-elevated p-4 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  O Windows vai discar este número
                </p>
                <p className="mt-1 select-all font-mono text-3xl font-semibold tabular-nums">
                  {formatPhoneBR(phoneE164)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Ao iniciar, o Vincular ao Telefone abre e chama pelo seu celular. Fale pelo
                  headset.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="mic-ligacao"
                    className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Sua voz
                  </label>
                  <select
                    id="mic-ligacao"
                    value={micId}
                    onChange={(e) => {
                      setMicId(e.target.value);
                      gravarPreferencia(CHAVE_MIC, e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-surface-elevated p-2 text-sm"
                  >
                    {entradas.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.deviceId === "communications"
                          ? "Headset da chamada (o que o Windows usa)"
                          : rotulo(d, i)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="lead-ligacao"
                    className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Voz do lead
                  </label>
                  <select
                    id="lead-ligacao"
                    value={leadId}
                    onChange={(e) => {
                      setLeadId(e.target.value);
                      gravarPreferencia(CHAVE_LEAD, e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-surface-elevated p-2 text-sm"
                  >
                    {entradas
                      .filter((d) => pareceCelularPareado(d.label) || d.deviceId === "default")
                      .map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {pareceCelularPareado(d.label)
                            ? `Celular pareado — ${d.label}`
                            : rotulo(d, i)}
                        </option>
                      ))}
                    <option value={LEAD_SISTEMA}>Áudio do computador (pede a tela)</option>
                  </select>
                </div>
              </div>

              {!celularNaLista && (
                <p className="rounded-md border border-warning-fg/30 bg-warning-bg p-3 text-xs text-warning-fg">
                  Não achei o celular pareado nas entradas de áudio. Conecte o Bluetooth do celular
                  ao Windows antes de discar — sem ele, a voz do lead só entra pelo áudio do
                  computador, e o navegador vai pedir para compartilhar a tela (marque
                  “Compartilhar áudio”).
                </p>
              )}
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
                  // "Calar" tem desenho PRÓPRIO, e isso não é enfeite: a frase
                  // "Silêncio. Deixe ele responder." desenhada como as outras
                  // seria lida em voz alta na frente do dono. A cor e o rótulo
                  // mudarem juntos é o que faz o SDR perceber de relance que
                  // esta não é uma frase para dizer.
                  calando
                    ? "border-warning-fg/40 bg-warning-bg"
                    : sugestao
                      ? "border-accent-500/50 bg-accent-500/10"
                      : "border-dashed border-border bg-surface-elevated",
                )}
              >
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {calando ? (
                    <>
                      <HandPalm size={14} weight="duotone" aria-hidden />
                      Não fale
                    </>
                  ) : (
                    <>
                      <Lightbulb size={14} weight="duotone" aria-hidden />
                      Fale agora
                    </>
                  )}
                  {/* Em que ponto do roteiro a ligação está. Calculada do
                      checklist, então ela nunca discorda das caixinhas logo
                      abaixo nem anda para trás — era o que acontecia quando o
                      modelo respondia a fase junto com a sugestão. */}
                  {etapa && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">
                      {CALL_PHASE_LABELS[etapa]}
                    </span>
                  )}
                  {/* O degrau da dor. Só aparece quando o copiloto está nela —
                      fora disso não há etapa a mostrar, e um rótulo permanente
                      viraria ruído no elemento mais lido da tela. */}
                  {degrau && (
                    <span className="rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-foreground">
                      {DEGRAU_LABELS[degrau]}
                    </span>
                  )}
                  {/* A palavra-eixo travada. Ela fica na tela do momento em que
                      a dor aparece até o fim da ligação — é o lembrete de que
                      todas as frases seguintes falam DESTA palavra. */}
                  {rotuloEixo && (
                    <span className="rounded-full border border-accent-500/50 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-700 dark:text-accent-300">
                      eixo: {rotuloEixo}
                    </span>
                  )}
                  {/* Qual resposta pronta está na tela. Sem isto o SDR vê um
                      parágrafo aparecer do nada e não sabe que é script. */}
                  {rotuloObjecao && (
                    <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-warning-fg">
                      {rotuloObjecao}
                    </span>
                  )}
                </p>
                <p
                  className={cn(
                    "mt-1 font-semibold leading-snug",
                    // Script de objeção é longo por natureza. No corpo de 20px
                    // ele estoura a janela e empurra o checklist para fora da
                    // tela — o SDR perde as duas coisas de uma vez.
                    sugestao && sugestao.length > 120 ? "text-base" : "text-xl",
                  )}
                >
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
                    {itensDoChecklist.map(([chave, texto]) => {
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
                            {texto}
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

              {/* estado da captura: um medidor por voz */}
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

                <Medidor titulo="Você" valor={nivelMic} />
                <Medidor titulo="Lead" valor={nivelLead} inativo={temVozDoLead === false} />

                {temVozDoLead === false && (
                  <p className="rounded-md border border-warning-fg/30 bg-warning-bg p-2 text-xs text-warning-fg">
                    A voz do lead não está entrando em trilha própria. Ela só será gravada se a
                    chamada estiver no viva-voz perto do microfone.
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
              <Phone size={16} weight="bold" aria-hidden />
              <span>Ligar e gravar</span>
            </Button>
          ) : null}

          {gravando && (
            <>
              {/* O Windows pode engolir a primeira chamada (o app ainda abrindo,
                  ou o aviso "Abrir Vincular ao Telefone?" esperando resposta).
                  Este botão disca de novo SEM reiniciar a gravação — recomeçar
                  perderia o que já foi transcrito. */}
              <Button variant="outline" onClick={discar}>
                <Phone size={16} weight="bold" aria-hidden />
                <span>Discar de novo</span>
              </Button>
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

/**
 * Uma barra por voz.
 *
 * Duas barras e não uma porque o modo de falha mais caro desta ferramenta é
 * silencioso: metade da conversa não entra, e só se descobre lendo a análise
 * depois. Com dois medidores o SDR vê no primeiro "alô" que um dos lados está
 * mudo — e ainda dá tempo de consertar.
 */
function Medidor({
  titulo,
  valor,
  inativo = false,
}: {
  titulo: string;
  valor: number;
  inativo?: boolean;
}) {
  const pct = Math.round(valor * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Microphone size={12} weight="bold" aria-hidden />
          {titulo}
        </span>
        {inativo && <span>sem trilha própria</span>}
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-border"
        role="meter"
        aria-label={`Nível de ${titulo}`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-75",
            inativo ? "bg-muted-foreground/40" : "bg-accent-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
