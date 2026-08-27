"use client";
/**
 * O popup da ligação — copiloto, não gravador.
 *
 * O SDR clica em Ligar, o Windows disca pelo Vincular ao Telefone (o `tel:` do
 * navegador cai nele) e a chamada acontece no headset. O CRM ouve os dois lados,
 * transcreve em blocos, sopra a próxima frase e marca sozinho o que o roteiro já
 * cobriu. A análise completa sai segundos depois de desligar.
 *
 * DE ONDE VEM O ÁUDIO — UMA ENTRADA SÓ, e é o microfone do computador.
 *
 * A chamada fica no VIVA-VOZ do celular. A voz do lead sai pelo alto-falante do
 * aparelho e entra pelo mesmo microfone que já pega a voz do SDR: um fluxo,
 * dois lados, nada para parear nem compartilhar.
 *
 * Isso é uma VOLTA, não uma novidade. O desenho original (10/08/2026) era esse.
 * Depois vieram duas entradas separadas — o celular pareado exposto como
 * microfone "Hands-Free", e o áudio do sistema via `getDisplayMedia` — e o
 * resultado medido em 25/08 foi que a segunda entrada quase nunca existia: as
 * oito ligações do dia gravaram só a voz do SDR e as oito análises saíram como
 * "não atendeu". Uma fonte que funciona ganha de duas que dependem de o SDR
 * acertar dois seletores e uma janela de compartilhamento com o lead na linha.
 *
 * O microfone é pedido CRU (`echoCancellation`, `noiseSuppression` e
 * `autoGainControl` desligados). Ligados, o navegador trata a voz que vem do
 * alto-falante como eco a cancelar — que é exatamente a voz que precisamos.
 *
 * COMO DISCAR é escolha do SDR, não do código. Ver `lib/calls/formatos-discagem.ts`:
 * o mesmo número completa ou não conforme o formato, e quem sabe qual a linha
 * aceita é quem está com o telefone na mão.
 *
 * AS TRÊS DECISÕES QUE MANDAM NO LAYOUT:
 *
 *  - A SUGESTÃO É O MAIOR ELEMENTO DA TELA. Uma frase, grande, sempre no mesmo
 *    lugar. O SDR está com o telefone no ouvido: ele tem meio segundo de olhada,
 *    não tem leitura. Todo o resto é secundário por construção.
 *  - O CHECKLIST NÃO DESMARCA. Item que acendeu fica aceso (a mescla acontece no
 *    servidor). Uma caixinha que apaga sozinha faria o SDR achar que a ligação
 *    andou para trás no meio da conversa.
 *  - O MEDIDOR CONTINUA SENDO A PROVA. Um só agora, mas ele responde a mesma
 *    pergunta de antes: está entrando som? Se a barra não mexe quando o lead
 *    fala, o viva-voz está desligado — e dá para consertar durante a chamada.
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
import {
  enviarBlocoAoVivo,
  salvarNotasDaLigacao,
  uploadCallAudio,
  useSaveCallNotes,
  useStartCall,
} from "@/hooks/calls/useCalls";
import { useAcompanharLigacao } from "@/components/calls/LigacoesEmVoo";
import {
  CALL_PHASE_LABELS,
  COBERTURA_LABELS_CURTOS,
  COBERTURA_VAZIA,
  LIVE_CHUNK_SECONDS,
  OBJECAO_LABELS,
  type CallPhase,
  type CoberturaKey,
  type Objecao,
} from "@/lib/calls/live-schema";
import {
  opcaoEscolhida,
  opcoesDeDiscagem,
  type FormatoDiscagem,
} from "@/lib/calls/formatos-discagem";
import { rotuloDoEixo } from "@/lib/calls/palavras-eixo";
import {
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

/**
 * `acompanhando` SAIU. Era o estado em que o popup ficava mostrando "Analisando…"
 * depois de o áudio subir — e era exatamente ele que prendia o SDR na tela por
 * uma tarefa que roda no servidor. Agora o acompanhamento é a pílula do topo
 * (`components/calls/LigacoesEmVoo.tsx`), e o popup fecha ao desligar.
 */
type Fase = "pronto" | "gravando" | "pausado" | "enviando" | "erro";

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

/**
 * O formato de discagem também mora aqui, e pela mesma razão: ele descreve a
 * LINHA de quem liga (operadora, plano, DDD de origem), não o contato. O mesmo
 * lead discado do celular do Mario e do celular do David pode precisar de
 * formatos diferentes.
 *
 * Guardamos o ÚLTIMO USADO, não "o que funcionou" — o navegador não tem como
 * saber se a chamada completou. Na prática dá no mesmo: se não chamou, o SDR
 * clica em outro, e é esse outro que fica.
 */
const CHAVE_FORMATO = "nexo.ligacao.formato";

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
  const [erro, setErro] = useState<string | null>(null);

  const [entradas, setEntradas] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  /** O formato usado por último nesta máquina. Null = ninguém escolheu ainda. */
  const [formato, setFormato] = useState<FormatoDiscagem | null>(null);

  const [transcricao, setTranscricao] = useState("");
  const [sugestao, setSugestao] = useState<string | null>(null);
  /**
   * Em que etapa do ROTEIRO a ligação está — nada a ver com `fase` acima, que é
   * o estado do gravador (pronto/gravando/enviando). Vem calculada do checklist
   * no servidor, não da opinião do modelo: ver `faseDaCobertura`.
   */
  const [etapa, setEtapa] = useState<CallPhase | null>(null);
  /** "calar" quando a coisa certa é esperar — a regra da aula 03 do caderno. */
  const [tipo, setTipo] = useState<string>("falar");
  /** A palavra-eixo travada. Uma vez escolhida, ela fica na tela até o fim. */
  const [eixo, setEixo] = useState<string | null>(null);
  /** Qual resposta pronta está na tela, quando o dono soltou uma objeção. */
  const [objecao, setObjecao] = useState<string | null>(null);
  const [alerta, setAlerta] = useState<string | null>(null);
  const [cobertura, setCobertura] = useState<Record<string, boolean>>(COBERTURA_VAZIA);
  /** A anotação cresce enquanto ele digita e volta a encolher ao sair. */
  const [anotando, setAnotando] = useState(false);
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
  const acompanhar = useAcompanharLigacao();

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

    // O formato vem junto por carona: não depende de dispositivo nenhum, mas
    // precisa do mesmo gatilho (o popup abrindo) e um efeito a menos é um
    // ciclo de render a menos numa tela que já abre com o telefone na mão.
    const salvoFormato = lerPreferencia(CHAVE_FORMATO);
    setFormato(
      salvoFormato === "interurbano" ||
        salvoFormato === "nacional" ||
        salvoFormato === "internacional"
        ? salvoFormato
        : null,
    );
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
   *
   * Recebe o formato em vez de ler o estado: durante a chamada o SDR troca de
   * formato e disca no mesmo clique, e um `discar()` que dependesse do estado
   * mandaria o formato ANTIGO — o React ainda não teria re-renderizado.
   */
  const discar = useCallback(
    (escolhido: FormatoDiscagem | null) => {
      const opcao = opcaoEscolhida(opcoesDeDiscagem(phoneE164), escolhido, phoneE164);
      const link = document.createElement("a");
      link.href = `tel:${opcao.discar}`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [phoneE164],
  );

  /** Guarda a escolha e disca. É o que cada botão de formato faz. */
  const escolherEDiscar = useCallback(
    (escolhido: FormatoDiscagem) => {
      setFormato(escolhido);
      gravarPreferencia(CHAVE_FORMATO, escolhido);
      discar(escolhido);
    },
    [discar],
  );

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
   * O medidor do microfone — a prova de que está entrando som.
   *
   * O analisador NÃO é ligado à saída do contexto: ligar devolveria o áudio da
   * ligação pelos alto-falantes do computador, que o microfone captaria de
   * volta — realimentação em cima de uma ligação real.
   *
   * Com uma entrada só, a barra passou a responder pelos DOIS lados: se ela
   * mexe quando o lead fala, o viva-voz está chegando. É a mesma pergunta que
   * os dois medidores antigos respondiam, com metade da tela.
   */
  const iniciarMedidor = useCallback((ctx: AudioContext, fonte: AudioNode) => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    fonte.connect(analyser);
    // `new ArrayBuffer(n)` em vez de `new Uint8Array(n)`: a assinatura de
    // `getByteTimeDomainData` exige um Uint8Array respaldado por ArrayBuffer,
    // e o construtor por tamanho devolve o tipo genérico (que aceitaria um
    // SharedArrayBuffer).
    const buffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

    // RMS em torno do silêncio (128) — responde ao volume de fala, não a picos
    // isolados, então a barra não pisca com um clique de teclado.
    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let soma = 0;
      for (const v of buffer) {
        const d = (v - 128) / 128;
        soma += d * d;
      }
      setNivelMic(Math.min(1, Math.sqrt(soma / buffer.length) * 4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const iniciarGravacao = useCallback(
    async (escolhido: FormatoDiscagem) => {
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

      // ---- 1. as duas vozes, pelo microfone do computador ----
      // A do lead entra junto porque a chamada está no viva-voz. Não existe
      // segunda captura: ver o cabeçalho do arquivo.
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

      // ---- 2. registrar a tentativa ----
      // Antes de gravar: se o servidor recusar (contato anonimizado, sem telefone),
      // é melhor descobrir agora que depois de cinco minutos de áudio sem para
      // onde ir.
      let novoCallId: string;
      try {
        const r = await startCall.mutateAsync(origin);
        novoCallId = r.data.call_id;
      } catch {
        mic.getTracks().forEach((t) => t.stop());
        setErro("Não foi possível registrar a ligação. Tente novamente.");
        setFase("erro");
        return;
      }

      // ---- 3. o contexto de áudio ----
      // Continua existindo com uma fonte só: é dele que saem o medidor e a trilha
      // que o MediaRecorder grava, e trocar isso por gravar o `mic` direto tiraria
      // o medidor sem devolver nada.
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const destino = ctx.createMediaStreamDestination();
      const fonteMic = ctx.createMediaStreamSource(mic);
      fonteMic.connect(destino);

      fontesRef.current = [mic];
      mixadoRef.current = destino.stream;
      chunksRef.current = [];

      setCallId(novoCallId);
      callIdRef.current = novoCallId;
      setTranscricao("");
      setSugestao(null);
      setEtapa(null);
      setTipo("falar");
      setEixo(null);
      setObjecao(null);
      setAlerta(null);
      setCobertura(COBERTURA_VAZIA);
      setNotas("");
      filaRef.current = Promise.resolve();

      // ---- 4. gravador da íntegra ----
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

      // ---- 5. copiloto ----
      ativoRef.current = true;
      iniciarCicloDeBlocos();

      iniciarMedidor(ctx, fonteMic);
      setSegundos(0);
      segundosRef.current = 0;
      timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      setFase("gravando");

      // ---- 6. e só então discar ----
      // Por último de propósito: quando o telefone começa a chamar, tudo que
      // precisa gravar já está gravando. Discar primeiro custaria os primeiros
      // segundos da ligação, que é onde mora a abertura.
      escolherEDiscar(escolhido);
    },
    [escolherEDiscar, iniciarCicloDeBlocos, iniciarMedidor, micId, origin, startCall],
  );

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

  /** Zera o popup e o fecha. Usado ao desligar e ao fechar na mão. */
  const fecharTudo = useCallback(() => {
    liberarRecursos();
    setFase("pronto");
    setCallId(null);
    setSegundos(0);
    setErro(null);
    setTranscricao("");
    setSugestao(null);
    setEtapa(null);
    setTipo("falar");
    setEixo(null);
    setObjecao(null);
    setAlerta(null);
    setCobertura(COBERTURA_VAZIA);
    setNotas("");
    setAvisoAoVivo(null);
    // O formato NÃO é zerado aqui de propósito: ele descreve a linha, não a
    // ligação. Esquecê-lo faria o SDR redescobrir o formato certo a cada
    // chamada — o oposto do que a lembrança existe para fazer.
    onOpenChange(false);
  }, [liberarRecursos, onOpenChange]);

  /**
   * Desligar devolve a tela NA HORA.
   *
   * Antes, tudo daqui para baixo acontecia com o popup aberto e o SDR parado:
   * esperar a fila de blocos esvaziar (até 30 s), salvar a anotação, subir o
   * áudio, e então ficar olhando "Analisando…" até fechar na mão. Nada disso
   * precisa dele — a análise roda num worker e o resultado espera na tela de
   * Ligações.
   *
   * Agora só o que é RÁPIDO e só o popup consegue fazer roda aqui: parar os
   * gravadores e fechar o arquivo em memória. O resto vira uma promessa
   * entregue ao `LigacoesEmVooProvider`, que acompanha numa pílula no topo — e
   * o popup fecha.
   *
   * A ORDEM IMPORTA: a fila precisa esvaziar ANTES do upload, porque o upload
   * dispara a análise e ela lê a transcrição que os blocos ainda estão
   * escrevendo. O que mudou é ONDE se espera, não SE se espera.
   */
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

    const mime = rec.mimeType || "audio/webm";
    const anotacao = notas;
    const fila = filaRef.current;

    acompanhar({
      callId,
      contato: contactName,
      subir: async () => {
        // O teto de 30 s existe para que um bloco preso na rede não segure a
        // ligação para sempre — passado o prazo, o worker refaz a transcrição
        // pelo áudio íntegro (ele compara a contagem de blocos com a duração;
        // ver a migration 0106).
        await Promise.race([fila, new Promise((r) => setTimeout(r, 30_000))]);

        // `salvarNotasDaLigacao` e não o hook: o popup já fechou e zerou o
        // `callId` do render, então a mutação do hook cairia no `return null` e
        // a anotação sumiria sem erro nenhum. Ver o comentário lá.
        try {
          if (anotacao.trim()) await salvarNotasDaLigacao({ callId, sdr_notes: anotacao });
        } catch {
          // Anotação perdida não pode impedir o áudio de subir.
        }

        await uploadCallAudio({
          callId,
          blob,
          filename: `ligacao.${mime.includes("mp4") ? "m4a" : "webm"}`,
          durationSeconds: duracao,
        });
      },
    });

    fecharTudo();
  }, [callId, contactName, acompanhar, fecharTudo, liberarRecursos, notas, segundos]);

  // Fechar por engano ainda perde a ligação, mas "enviando" deixou de ser um
  // estado em que a tela fica presa: ele dura o tempo de parar o gravador.
  const podeFechar = !gravando && fase !== "enviando";

  const handleOpenChange = (novo: boolean) => {
    if (!novo && !podeFechar) return; // gravando: fechar por engano perde tudo
    if (!novo) {
      fecharTudo();
      return;
    }
    onOpenChange(novo);
  };

  const itensDoChecklist = Object.entries(COBERTURA_LABELS_CURTOS) as [CoberturaKey, string][];
  // A marca acesa do trilho: a primeira ainda não feita. Sai do MESMO checklist
  // que a etapa do cabeçalho, então as duas nunca se contradizem.
  const primeiroPendente = itensDoChecklist.findIndex(([chave]) => !cobertura[chave]);
  const calando = tipo === "calar" && Boolean(sugestao);
  const rotuloEixo = rotuloDoEixo(eixo);
  const rotuloObjecao = objecao ? (OBJECAO_LABELS[objecao as Objecao] ?? null) : null;
  const rotulo = (d: MediaDeviceInfo, i: number) =>
    d.label || (d.deviceId === "default" ? "Padrão do Windows" : `Entrada de áudio ${i + 1}`);
  const opcoes = opcoesDeDiscagem(phoneE164);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ligar para {contactName}</DialogTitle>
          <DialogDescription>{company || "Ligação de qualificação"}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* ---- antes de começar: como discar, viva-voz e microfone ---- */}
          {(fase === "pronto" || fase === "erro") && (
            <>
              {/* O BOTÃO É O NÚMERO. Não existe "escolher o formato" e depois
                  "ligar": o clique no formato JÁ é a ligação. Um passo a menos
                  numa tela que o SDR abre trinta vezes por dia — e, quando a
                  primeira tentativa não completa, voltar e clicar no de baixo é
                  um gesto só. */}
              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Escolhe como discar
                </legend>
                <div className="mt-2 space-y-2">
                  {opcoes.map((o) => {
                    const ultimo = o.formato === formato;
                    return (
                      <button
                        key={o.formato}
                        type="button"
                        disabled={startCall.isPending}
                        onClick={() => void iniciarGravacao(o.formato)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors",
                          "hover:border-accent-500 disabled:opacity-60",
                          ultimo
                            ? "bg-accent-500/10 border-accent-500"
                            : "border-border bg-surface-elevated",
                        )}
                      >
                        <Phone size={18} weight="bold" aria-hidden className="shrink-0" />
                        <span className="min-w-0">
                          <span className="block font-mono text-lg font-semibold tabular-nums">
                            {o.rotulo}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {ultimo ? `o último que você usou — ${o.ajuda}` : o.ajuda}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* O aviso do viva-voz é a única instrução que sobrou, e ela vale
                  a gravação inteira: de fone, a voz do lead vai só para o ouvido
                  do SDR e o microfone não escuta. */}
              <p className="border-warning-fg/30 rounded-md border bg-warning-bg p-3 text-xs text-warning-fg">
                Põe o celular no <strong>viva-voz</strong>. É assim que a voz do lead entra na
                gravação — de fone, só a sua é gravada.
              </p>

              <div>
                <label
                  htmlFor="mic-ligacao"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Microfone
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
            </>
          )}

          {erro && (
            <p
              role="alert"
              className="border-error-fg/30 rounded-md border bg-error-bg p-3 text-sm text-error-fg"
            >
              {erro}
            </p>
          )}

          {/* ---- durante a ligação ---- */}
          {gravando && (
            <>
              {/* O TRILHO: o checklist virou régua.
                  As mesmas dez marcas de antes, na ordem da ligação, mas em
                  tracinhos com rótulo curto em vez de dez linhas de texto. Cor
                  responde "o que já foi" e "onde estou" sem leitura — que é o
                  máximo que o SDR consegue fazer com o dono na linha. As dez
                  linhas que isso devolveu foram para a frase, que é o único
                  elemento da tela que existe para ser lido. */}
              <ol
                aria-label={
                  etapa
                    ? `Roteiro da ligação — etapa atual: ${CALL_PHASE_LABELS[etapa]}`
                    : "Roteiro da ligação"
                }
                className="grid grid-cols-5 gap-x-1 gap-y-2 sm:grid-cols-10"
              >
                {itensDoChecklist.map(([chave, texto], i) => {
                  const feito = Boolean(cobertura[chave]);
                  // "Agora" é a primeira marca não feita: é para onde a próxima
                  // sugestão aponta, e nunca discorda da etapa no cabeçalho —
                  // as duas saem do mesmo checklist.
                  const agora = !feito && i === primeiroPendente;
                  return (
                    <li
                      key={chave}
                      className="flex flex-col items-center gap-1.5 text-center"
                      aria-current={agora ? "step" : undefined}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "h-1 w-full rounded-full",
                          feito
                            ? "bg-success-fg"
                            : agora
                              ? "ring-accent-500/30 bg-accent-500 ring-[3px]"
                              : "bg-border",
                        )}
                      />
                      <span
                        className={cn(
                          "text-[10px] font-semibold leading-tight",
                          feito
                            ? "text-muted-foreground"
                            : agora
                              ? "text-accent-700 dark:text-accent-300"
                              : "text-muted-foreground/50",
                        )}
                      >
                        {texto}
                      </span>
                      <span className="sr-only">{feito ? "concluído" : "pendente"}</span>
                    </li>
                  );
                })}
              </ol>

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
                  {/* NEM etapa NEM degrau viram chip aqui: o trilho acima já
                      responde as duas, e "Espelho" apareceria duas vezes na
                      mesma tela. O que sobra no cabeçalho é o que o trilho NÃO
                      consegue dizer — o eixo e a objeção. */}
                  {/* A palavra-eixo travada. Ela fica na tela do momento em que
                      a dor aparece até o fim da ligação — é o lembrete de que
                      todas as frases seguintes falam DESTA palavra. */}
                  {rotuloEixo && (
                    <span className="border-accent-500/50 rounded-full border px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-700 dark:text-accent-300">
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
                <p className="border-warning-fg/30 flex items-center gap-2 rounded-md border bg-warning-bg p-3 text-sm font-medium text-warning-fg">
                  <Warning size={16} weight="fill" aria-hidden />
                  {alerta}
                </p>
              )}

              {/* anotação do SDR — UMA LINHA, que cresce ao focar.
                  Ele escreve aqui, não lê: uma caixa de duas linhas sempre
                  aberta custava altura o tempo todo para um campo consultado
                  em nenhum momento da conversa. */}
              <textarea
                id="anotacao-ligacao"
                aria-label="Sua anotação da ligação"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={anotando ? 3 : 1}
                onFocus={() => setAnotando(true)}
                onBlur={() => setAnotando(false)}
                placeholder="Anotação: o que ficou combinado, o que ele falou fora do roteiro…"
                className="w-full resize-none rounded-md border border-border bg-surface-elevated p-2 text-sm outline-none transition-[height] focus:border-accent-500"
              />

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

                <Medidor titulo="Entrando no microfone" valor={nivelMic} />
                <p className="text-xs text-muted-foreground">
                  A barra tem que mexer quando o lead fala. Se só mexer quando você fala, o viva-voz
                  está desligado.
                </p>

                {avisoAoVivo && <p className="text-xs text-muted-foreground">{avisoAoVivo}</p>}
              </div>

              {/* A TRANSCRIÇÃO É GAVETA, e fechada. Ela é o bloco que mais rouba
                  altura e o único que o SDR disse não olhar durante a chamada —
                  serve para conferir que está capturando, o que os medidores
                  acima já respondem melhor. Fica a um clique. */}
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Transcrição
                </summary>
                <div
                  ref={transcricaoBoxRef}
                  className="mx-3 mb-3 h-32 overflow-y-auto rounded-md border border-border bg-surface-elevated p-2 text-xs leading-relaxed text-muted-foreground"
                >
                  {transcricao || "As falas aparecem aqui alguns segundos depois."}
                </div>
              </details>
            </>
          )}

          {fase === "enviando" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={16} className="animate-spin" aria-hidden />
              Fechando a gravação…
            </p>
          )}
        </div>

        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {/* Nada de "Ligar e gravar" aqui: quem liga são os botões de formato
              lá em cima, e um segundo botão de ligar só criaria a dúvida de
              qual dos dois disca em qual formato. */}

          {gravando && (
            <>
              {/* DISCAR DE NOVO, EM OUTRO FORMATO — o motivo desta fileira.
                  O Windows engole chamada (o app abrindo, o aviso "Abrir
                  Vincular ao Telefone?"), e a operadora recusa formato. Nos dois
                  casos o SDR precisa insistir SEM reiniciar a gravação, que
                  perderia o que já foi transcrito. Os formatos ficam à mão para
                  ele tentar o de baixo no mesmo número, que é como se descobre
                  qual a linha aceita. */}
              {opcoes.map((o) => (
                <Button
                  key={o.formato}
                  variant="outline"
                  size="sm"
                  onClick={() => escolherEDiscar(o.formato)}
                  title={o.ajuda}
                >
                  <Phone size={14} weight="bold" aria-hidden />
                  <span className="font-mono tabular-nums">{o.rotulo}</span>
                </Button>
              ))}
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
 * A barra do microfone.
 *
 * O modo de falha mais caro desta ferramenta é silencioso: metade da conversa
 * não entra, e só se descobre lendo a análise depois. Como agora a captura é
 * uma só, a barra responde pelos dois lados — ela mexer enquanto o LEAD fala é
 * a prova de que o viva-voz está chegando, e dá tempo de consertar na hora.
 */
function Medidor({ titulo, valor }: { titulo: string; valor: number }) {
  const pct = Math.round(valor * 100);
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Microphone size={12} weight="bold" aria-hidden />
        {titulo}
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
          className="h-full rounded-full bg-accent-500 transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
