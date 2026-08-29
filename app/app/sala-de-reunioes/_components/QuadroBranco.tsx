"use client";
/**
 * O QUADRO BRANCO — a tela que se COMPARTILHA com o cliente na call, no estilo
 * "iPad do consultor": desenhar à mão livre, escrever grande, e carimbar a
 * conta da dor na frente dele. Diagnóstico mostrado gera valor; falado, não.
 *
 * DECISÕES DE FORMA:
 * - O quadro vive num espaço lógico fixo (1600×900) e o CSS só escala. Todo
 *   traço e texto fica em coordenada lógica — é o que faz o desenho
 *   sobreviver a resize, tela cheia e export de PNG sem matemática espalhada.
 * - Traços ficam em estado (lista), e o canvas é REDESENHADO do estado. Mais
 *   caro que pintar e esquecer, mas é o que dá desfazer, rascunho no
 *   localStorage e PNG de graça.
 * - A CONTA é um formulário ao lado, não desenho: número errado na frente do
 *   cliente é o pior defeito possível desta tela — quem multiplica é o código.
 * - Texto vira <div> por cima do canvas (editável no clique); só no export ele
 *   é pintado no bitmap.
 *
 * O que se salva no card é TEXTO (a conta e o que foi escrito) — é o que o
 * preparo da próxima reunião consegue reler. O desenho em si sai por
 * "Baixar imagem" quando o Mario quiser guardar ou mandar no WhatsApp.
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonoLabel } from "@/components/ui/mono-label";
import { useSalvarGuia, type MeetingListItem } from "@/hooks/sala-reunioes/useMeetings";
import type { ProximaReuniao } from "@/hooks/sala-reunioes/usePreparo";
import { randomId } from "@/lib/random-id";
import {
  ArrowCounterClockwise,
  CaretLeft,
  CornersOut,
  DownloadSimple,
  Eraser,
  PencilSimple,
  TextT,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { SeletorDeDestino, destinoInicial, lerDestino } from "./SeletorDeDestino";

/** O espaço lógico do quadro. 16:9 — a proporção da tela compartilhada. */
const LARGURA = 1600;
const ALTURA = 900;
/** Fonte lógica dos textos: grande de propósito, é para ler do outro lado da call. */
const FONTE = 44;

const CORES = [
  { valor: "#111827", nome: "preto" },
  { valor: "#0285ff", nome: "azul" },
  { valor: "#dc2626", nome: "vermelho" },
] as const;

interface Traco {
  cor: string;
  largura: number;
  /** Pontos achatados [x0, y0, x1, y1, …] — metade do JSON de uma lista de objetos. */
  pontos: number[];
}

interface TextoItem {
  id: string;
  x: number;
  y: number;
  texto: string;
  cor: string;
}

interface Conta {
  qtd: string;
  rotulo: string;
  valor: string;
}

type Ferramenta = "caneta" | "borracha" | "texto";

const CONTA_VAZIA: Conta = { qtd: "", rotulo: "clientes perdidos/mês", valor: "" };
const CHAVE_DO_RASCUNHO = "sala-quadro-rascunho";

interface Rascunho {
  tracos: Traco[];
  textos: TextoItem[];
  conta: Conta;
}

function carregarRascunho(): Rascunho {
  if (typeof window === "undefined") return { tracos: [], textos: [], conta: CONTA_VAZIA };
  try {
    const cru = window.localStorage.getItem(CHAVE_DO_RASCUNHO);
    if (!cru) return { tracos: [], textos: [], conta: CONTA_VAZIA };
    const dado = JSON.parse(cru) as Partial<Rascunho>;
    return {
      tracos: Array.isArray(dado.tracos) ? dado.tracos : [],
      textos: Array.isArray(dado.textos) ? dado.textos : [],
      conta: { ...CONTA_VAZIA, ...dado.conta },
    };
  } catch {
    return { tracos: [], textos: [], conta: CONTA_VAZIA };
  }
}

function desenharTraco(ctx: CanvasRenderingContext2D, t: Traco) {
  if (t.pontos.length < 4) return;
  ctx.strokeStyle = t.cor;
  ctx.lineWidth = t.largura;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(t.pontos[0]!, t.pontos[1]!);
  for (let i = 2; i < t.pontos.length; i += 2) ctx.lineTo(t.pontos[i]!, t.pontos[i + 1]!);
  ctx.stroke();
}

function real(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

interface Props {
  aoVivo: MeetingListItem | null;
  proximas: ProximaReuniao[];
  onVoltar: () => void;
}

/** Botão da barra de ferramentas — fora do componente para não renascer a cada render. */
function Botao({
  ativa,
  onClick,
  children,
  rotulo,
}: {
  ativa?: boolean;
  onClick: () => void;
  children: ReactNode;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={ativa}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-control border px-3 text-sm transition-colors",
        ativa
          ? "border-accent bg-accent-soft font-medium text-text"
          : "border-border bg-surface-elevated text-text hover:border-border-strong",
      )}
    >
      {children}
    </button>
  );
}

export function QuadroBranco({ aoVivo, proximas, onVoltar }: Props) {
  // Três inicializadores relendo o mesmo rascunho: mais barato que sincronizar
  // um objeto só entre três estados, e `carregarRascunho` é puro e local.
  const [tracos, setTracos] = useState<Traco[]>(() => carregarRascunho().tracos);
  const [textos, setTextos] = useState<TextoItem[]>(() => carregarRascunho().textos);
  const [conta, setConta] = useState<Conta>(() => carregarRascunho().conta);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("caneta");
  const [cor, setCor] = useState<string>(CORES[0].valor);
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmaLimpar, setConfirmaLimpar] = useState(false);
  const [destino, setDestino] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [escala, setEscala] = useState(1);

  const moldura = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracoAtual = useRef<Traco | null>(null);
  const salvar = useSalvarGuia();

  // ── rascunho no navegador ──────────────────────────────────────────────────
  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHAVE_DO_RASCUNHO,
        JSON.stringify({ tracos, textos, conta } satisfies Rascunho),
      );
    } catch {
      // storage cheio: o quadro segue funcionando, só sem rascunho
    }
  }, [tracos, textos, conta]);

  useEffect(() => {
    setDestino((atual) => (atual === "" ? destinoInicial(aoVivo, proximas) : atual));
  }, [aoVivo, proximas]);

  // ── escala CSS→lógica, medida de verdade (resize, tela cheia) ─────────────
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const medir = () => setEscala(el.clientWidth / LARGURA);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── redesenho a partir do estado ──────────────────────────────────────────
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LARGURA, ALTURA);
    for (const t of tracos) desenharTraco(ctx, t);
  }, [tracos]);

  const pontoLogico = (e: ReactPointerEvent): { x: number; y: number } => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * LARGURA),
      y: Math.round(((e.clientY - rect.top) / rect.height) * ALTURA),
    };
  };

  const aoApertar = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = pontoLogico(e);
    if (ferramenta === "texto") {
      const novo: TextoItem = { id: randomId(), x: p.x, y: p.y, texto: "", cor };
      setTextos((v) => [...v, novo]);
      setEditando(novo.id);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    tracoAtual.current = {
      cor: ferramenta === "borracha" ? "#ffffff" : cor,
      largura: ferramenta === "borracha" ? 36 : 5,
      pontos: [p.x, p.y],
    };
  };

  const aoArrastar = (e: ReactPointerEvent) => {
    const t = tracoAtual.current;
    const ctx = canvas.current?.getContext("2d");
    if (!t || !ctx) return;
    const p = pontoLogico(e);
    t.pontos.push(p.x, p.y);
    // Pinta só o segmento novo — o redesenho completo fica para o commit.
    const n = t.pontos.length;
    ctx.strokeStyle = t.cor;
    ctx.lineWidth = t.largura;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(t.pontos[n - 4]!, t.pontos[n - 3]!);
    ctx.lineTo(t.pontos[n - 2]!, t.pontos[n - 1]!);
    ctx.stroke();
  };

  const aoSoltar = () => {
    const t = tracoAtual.current;
    tracoAtual.current = null;
    if (t && t.pontos.length >= 4) setTracos((v) => [...v, t]);
  };

  // ── a conta, fechada em código ────────────────────────────────────────────
  const qtd = Number(conta.qtd.replace(",", "."));
  const valor = Number(conta.valor.replace(",", "."));
  const porMes = qtd > 0 && valor > 0 ? Math.round(qtd * valor) : null;

  const carimbarConta = () => {
    if (porMes === null) return;
    setTextos((v) => [
      ...v,
      {
        id: randomId(),
        x: 120,
        y: ALTURA - 160,
        texto: `${real(qtd)} ${conta.rotulo} × R$ ${real(valor)} = R$ ${real(porMes)}/mês (R$ ${real(porMes * 12)}/ano)`,
        cor: "#dc2626",
      },
    ]);
  };

  // ── exportar PNG (traços + textos pintados no bitmap) ─────────────────────
  const baixarImagem = () => {
    const alvo = document.createElement("canvas");
    alvo.width = LARGURA;
    alvo.height = ALTURA;
    const ctx = alvo.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, LARGURA, ALTURA);
    for (const t of tracos) desenharTraco(ctx, t);
    ctx.font = `bold ${FONTE}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    for (const t of textos) {
      if (!t.texto.trim()) continue;
      ctx.fillStyle = t.cor;
      ctx.fillText(t.texto, t.x, t.y);
    }
    const a = document.createElement("a");
    a.href = alvo.toDataURL("image/png");
    a.download = `quadro-reuniao-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };

  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void moldura.current?.requestFullscreen();
  };

  // ── salvar no card: o que dá para RELER — a conta e os textos ─────────────
  const aoSalvar = () => {
    const alvo = lerDestino(destino);
    if (!alvo) {
      setAviso("Escolha onde salvar, ali em cima.");
      return;
    }
    const linhas: string[] = [];
    if (porMes !== null) {
      linhas.push(
        `Conta feita na frente do cliente: ${real(qtd)} ${conta.rotulo} × R$ ${real(valor)} = R$ ${real(porMes)}/mês (R$ ${real(porMes * 12)}/ano)`,
      );
    }
    const escritos = textos.map((t) => t.texto.trim()).filter(Boolean);
    if (escritos.length > 0) {
      linhas.push("Escrito no quadro:", ...escritos.map((t) => `- ${t}`));
    }
    if (linhas.length === 0) {
      setAviso("O quadro ainda não tem conta nem texto — desenho puro sai pelo “Baixar imagem”.");
      return;
    }
    salvar.mutate(
      {
        ...alvo,
        headline:
          porMes !== null
            ? `Quadro branco: R$ ${real(porMes)}/mês na mesa`
            : "Quadro branco da reunião",
        body: linhas.join("\n"),
      },
      {
        onSuccess: () => setAviso("Salvo no card ✓"),
        onError: () => setAviso("Não deu para salvar. Tente de novo."),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onVoltar} className="gap-1">
            <CaretLeft size={16} />
            Voltar
          </Button>
          <div className="flex flex-col">
            <MonoLabel>quadro branco</MonoLabel>
            <p className="text-sm text-text-muted">
              Compartilhe ESTA janela na call e desenhe na frente dele.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SeletorDeDestino
            aoVivo={aoVivo}
            proximas={proximas}
            value={destino}
            onChange={setDestino}
          />
          <Button onClick={aoSalvar} disabled={salvar.isPending}>
            Salvar no card
          </Button>
        </div>
      </div>

      {aviso && (
        <p
          className={cn(
            "text-sm font-medium",
            aviso.endsWith("✓") ? "text-success-fg" : "text-warning-fg",
          )}
        >
          {aviso}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div ref={moldura} className="flex flex-col gap-2 bg-bg">
          <div className="flex flex-wrap items-center gap-2">
            <Botao ativa={ferramenta === "caneta"} onClick={() => setFerramenta("caneta")} rotulo="Caneta">
              <PencilSimple size={16} />
              Caneta
            </Botao>
            <Botao ativa={ferramenta === "texto"} onClick={() => setFerramenta("texto")} rotulo="Texto — clique no quadro para escrever">
              <TextT size={16} />
              Texto
            </Botao>
            <Botao ativa={ferramenta === "borracha"} onClick={() => setFerramenta("borracha")} rotulo="Borracha">
              <Eraser size={16} />
              Borracha
            </Botao>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            {CORES.map((c) => (
              <button
                key={c.valor}
                type="button"
                title={c.nome}
                aria-label={`Cor ${c.nome}`}
                aria-pressed={cor === c.valor}
                onClick={() => setCor(c.valor)}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-transform",
                  cor === c.valor ? "scale-110 border-text" : "border-border",
                )}
                style={{ backgroundColor: c.valor }}
              />
            ))}
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Botao onClick={() => setTracos((v) => v.slice(0, -1))} rotulo="Desfazer o último traço">
              <ArrowCounterClockwise size={16} />
            </Botao>
            <Botao
              ativa={confirmaLimpar}
              onClick={() => {
                if (!confirmaLimpar) {
                  setConfirmaLimpar(true);
                  return;
                }
                setTracos([]);
                setTextos([]);
                setConfirmaLimpar(false);
              }}
              rotulo="Limpar o quadro inteiro"
            >
              {confirmaLimpar ? "Apagar tudo?" : "Limpar"}
            </Botao>
            <Botao onClick={baixarImagem} rotulo="Baixar como imagem PNG">
              <DownloadSimple size={16} />
            </Botao>
            <Botao onClick={telaCheia} rotulo="Tela cheia">
              <CornersOut size={16} />
            </Botao>
          </div>

          <div
            ref={area}
            className="relative w-full overflow-hidden rounded-control border border-border bg-white"
            style={{ aspectRatio: `${LARGURA} / ${ALTURA}` }}
          >
            <canvas
              ref={canvas}
              width={LARGURA}
              height={ALTURA}
              className="block h-full w-full"
              style={{ touchAction: "none", cursor: ferramenta === "texto" ? "text" : "crosshair" }}
              onPointerDown={aoApertar}
              onPointerMove={aoArrastar}
              onPointerUp={aoSoltar}
              onPointerCancel={aoSoltar}
            />
            {textos.map((t) =>
              editando === t.id ? (
                <input
                  key={t.id}
                  autoFocus
                  defaultValue={t.texto}
                  onBlur={(e) => {
                    const texto = e.target.value.trim();
                    setEditando(null);
                    setTextos((v) =>
                      texto === ""
                        ? v.filter((x) => x.id !== t.id)
                        : v.map((x) => (x.id === t.id ? { ...x, texto } : x)),
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                  }}
                  className="absolute border-b-2 border-dashed border-accent bg-transparent font-bold outline-none"
                  style={{
                    left: t.x * escala,
                    top: t.y * escala,
                    color: t.cor,
                    fontSize: FONTE * escala,
                    width: `${Math.max(200, (LARGURA - t.x) * escala - 16)}px`,
                  }}
                />
              ) : (
                t.texto.trim() !== "" && (
                  <button
                    key={t.id}
                    type="button"
                    title="Clique para editar"
                    onClick={() => setEditando(t.id)}
                    className="absolute whitespace-nowrap text-left font-bold leading-tight"
                    style={{
                      left: t.x * escala,
                      top: t.y * escala,
                      color: t.cor,
                      fontSize: FONTE * escala,
                    }}
                  >
                    {t.texto}
                  </button>
                )
              ),
            )}
          </div>
        </div>

        <Card className="flex h-fit flex-col gap-3 p-5">
          <h3 className="text-sm font-semibold text-text">A conta da dor</h3>
          <p className="text-xs text-text-muted">
            Você digita, o sistema multiplica — número errado na frente do cliente não existe.
          </p>
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric"
              value={conta.qtd}
              onChange={(e) => setConta((v) => ({ ...v, qtd: e.target.value }))}
              placeholder="20"
              className="h-10 w-20 rounded-control border border-border bg-surface px-2 text-center text-lg font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            />
            <input
              value={conta.rotulo}
              onChange={(e) => setConta((v) => ({ ...v, rotulo: e.target.value }))}
              className="h-10 min-w-0 flex-1 rounded-control border border-border bg-surface px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-text">×</span>
            <span className="text-sm text-text-muted">R$</span>
            <input
              inputMode="numeric"
              value={conta.valor}
              onChange={(e) => setConta((v) => ({ ...v, valor: e.target.value }))}
              placeholder="300"
              className="h-10 w-28 rounded-control border border-border bg-surface px-2 text-center text-lg font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            />
            <span className="text-sm text-text-muted">por cliente</span>
          </div>
          {porMes !== null && (
            <div className="flex flex-col gap-0.5 rounded-control bg-error-bg p-3">
              <span className="text-2xl font-bold text-error-fg">
                R$ {real(porMes)}/mês
              </span>
              <span className="text-sm font-medium text-error-fg">
                R$ {real(porMes * 12)} por ano indo embora
              </span>
            </div>
          )}
          <Button variant="secondary" disabled={porMes === null} onClick={carimbarConta}>
            Carimbar a conta no quadro
          </Button>
        </Card>
      </div>
    </div>
  );
}
