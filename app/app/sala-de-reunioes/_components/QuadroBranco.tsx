"use client";
/**
 * O QUADRO BRANCO — a tela que se COMPARTILHA com o cliente na call, no estilo
 * "iPad do consultor": desenhar à mão livre, escrever grande, e carimbar a
 * conta da dor na frente dele. Diagnóstico mostrado gera valor; falado, não.
 *
 * O DESENHO É DO EXCALIDRAW (ver `QuadroExcalidraw.tsx`), não nosso. A primeira
 * versão desenhava em `<canvas>` escrito à mão e ficou pobre de usar justamente
 * onde esta tela precisa ser boa: na frente de um cliente pagante.
 *
 * O QUE CONTINUA SENDO NOSSO É A CONTA. Ela é um formulário ao lado, não um
 * desenho, porque número errado na frente do cliente é o pior defeito possível
 * desta tela — quem multiplica é o código, e o quadro só recebe o resultado já
 * fechado. Foi por isso que a troca de biblioteca não a tocou.
 *
 * O que se salva no card é TEXTO (a conta e o que foi escrito) — é o que o
 * preparo da próxima reunião consegue reler. O desenho sai por "Baixar imagem".
 */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonoLabel } from "@/components/ui/mono-label";
import { useSalvarGuia, type MeetingListItem } from "@/hooks/sala-reunioes/useMeetings";
import type { ProximaReuniao } from "@/hooks/sala-reunioes/usePreparo";
import { CaretLeft, CornersOut, DownloadSimple } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { SeletorDeDestino, destinoInicial, lerDestino } from "./SeletorDeDestino";

// ssr:false é obrigatório: o Excalidraw toca em `window` no import.
const QuadroExcalidraw = dynamic(() => import("./QuadroExcalidraw"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-text-muted">
      Abrindo o quadro…
    </div>
  ),
});

/**
 * O contrato mínimo que este arquivo usa da API do Excalidraw. Declarado aqui
 * em vez de importado do pacote: o mapa de tipos dele obriga a apontar para
 * caminhos internos de `dist`, e amarrar a tela a isso quebraria em qualquer
 * reorganização do pacote. Quatro métodos é tudo o que precisamos.
 */
interface ApiDoQuadro {
  updateScene: (cena: { elements: unknown[] }) => void;
  getSceneElements: () => readonly unknown[];
  getFiles: () => unknown;
  scrollToContent: (alvo?: unknown, opcoes?: unknown) => void;
}

interface Conta {
  qtd: string;
  rotulo: string;
  valor: string;
}

const CONTA_VAZIA: Conta = { qtd: "", rotulo: "clientes perdidos/mês", valor: "" };
const CHAVE_DO_RASCUNHO = "sala-quadro-rascunho-v2";
/** Tamanho da fonte do carimbo, em unidades de cena: grande para ler na call. */
const FONTE_DO_CARIMBO = 36;

interface Rascunho {
  elements: readonly unknown[];
  conta: Conta;
}

function carregarRascunho(): Rascunho {
  if (typeof window === "undefined") return { elements: [], conta: CONTA_VAZIA };
  try {
    const cru = window.localStorage.getItem(CHAVE_DO_RASCUNHO);
    if (!cru) return { elements: [], conta: CONTA_VAZIA };
    const dado = JSON.parse(cru) as Partial<Rascunho>;
    return {
      elements: Array.isArray(dado.elements) ? dado.elements : [],
      conta: { ...CONTA_VAZIA, ...dado.conta },
    };
  } catch {
    return { elements: [], conta: CONTA_VAZIA };
  }
}

function real(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

interface Props {
  aoVivo: MeetingListItem | null;
  proximas: ProximaReuniao[];
  onVoltar: () => void;
}

export function QuadroBranco({ aoVivo, proximas, onVoltar }: Props) {
  const [conta, setConta] = useState<Conta>(() => carregarRascunho().conta);
  const [destino, setDestino] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const moldura = useRef<HTMLDivElement>(null);
  const api = useRef<ApiDoQuadro | null>(null);
  const cena = useRef<readonly unknown[]>([]);
  // A cena inicial é lida UMA vez, em estado com inicializador preguiçoso:
  // passar um array novo a cada render faria o Excalidraw remontar e apagar o
  // que a pessoa acabou de desenhar.
  const [cenaInicial] = useState<readonly unknown[]>(() => carregarRascunho().elements);

  const salvar = useSalvarGuia();

  // Rascunho no navegador com folga de 1s: o Excalidraw dispara onChange a cada
  // movimento do traço, e gravar em todos travaria o desenho.
  useEffect(() => {
    const t = setInterval(() => {
      try {
        window.localStorage.setItem(
          CHAVE_DO_RASCUNHO,
          JSON.stringify({ elements: cena.current, conta } satisfies Rascunho),
        );
      } catch {
        // storage cheio: o quadro segue funcionando, só sem rascunho
      }
    }, 1_000);
    return () => clearInterval(t);
  }, [conta]);

  useEffect(() => {
    setDestino((atual) => (atual === "" ? destinoInicial(aoVivo, proximas) : atual));
  }, [aoVivo, proximas]);

  const qtd = Number(conta.qtd.replace(",", "."));
  const valor = Number(conta.valor.replace(",", "."));
  const porMes = qtd > 0 && valor > 0 ? Math.round(qtd * valor) : null;
  const fraseDaConta =
    porMes === null
      ? null
      : `${real(qtd)} ${conta.rotulo} × R$ ${real(valor)} = R$ ${real(porMes)}/mês (R$ ${real(porMes * 12)}/ano)`;

  const carimbarConta = async () => {
    if (!api.current || fraseDaConta === null) return;
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const novos = convertToExcalidrawElements([
      {
        type: "text",
        x: 120,
        y: 120,
        text: fraseDaConta,
        fontSize: FONTE_DO_CARIMBO,
        strokeColor: "#c92a2a",
      },
    ]);
    api.current.updateScene({
      elements: [...api.current.getSceneElements(), ...novos],
    });
    api.current.scrollToContent(novos, { fitToContent: true });
  };

  const baixarImagem = async () => {
    if (!api.current) return;
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({
      elements: api.current.getSceneElements() as never,
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" } as never,
      files: api.current.getFiles() as never,
      mimeType: "image/png",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quadro-reuniao-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void moldura.current?.requestFullscreen();
  };

  const aoSalvar = async () => {
    const alvo = lerDestino(destino);
    if (!alvo) {
      setAviso("Escolha onde salvar, ali em cima.");
      return;
    }

    const linhas: string[] = [];
    if (fraseDaConta) linhas.push(`Conta feita na frente do cliente: ${fraseDaConta}`);

    // O texto escrito no quadro é o que dá para reler depois; o desenho em si
    // só sai pela imagem.
    if (api.current) {
      const { getTextFromElements } = await import("@excalidraw/excalidraw");
      const escrito = getTextFromElements(api.current.getSceneElements() as never)?.trim();
      if (escrito) linhas.push("Escrito no quadro:", escrito);
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
        <div className="flex flex-wrap items-center gap-2">
          <SeletorDeDestino
            aoVivo={aoVivo}
            proximas={proximas}
            value={destino}
            onChange={setDestino}
          />
          <Button variant="secondary" size="sm" onClick={() => void baixarImagem()} className="gap-1.5">
            <DownloadSimple size={16} />
            Baixar imagem
          </Button>
          <Button variant="secondary" size="sm" onClick={telaCheia} className="gap-1.5">
            <CornersOut size={16} />
            Tela cheia
          </Button>
          <Button onClick={() => void aoSalvar()} disabled={salvar.isPending}>
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
        <div
          ref={moldura}
          className="h-[70vh] min-h-[420px] overflow-hidden rounded-control border border-border bg-white"
        >
          <QuadroExcalidraw
            initialElements={cenaInicial}
            onApi={(a) => {
              api.current = a as ApiDoQuadro;
            }}
            onChange={(elements) => {
              cena.current = elements;
            }}
          />
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
              <span className="text-2xl font-bold text-error-fg">R$ {real(porMes)}/mês</span>
              <span className="text-sm font-medium text-error-fg">
                R$ {real(porMes * 12)} por ano indo embora
              </span>
            </div>
          )}
          <Button
            variant="secondary"
            disabled={porMes === null}
            onClick={() => void carimbarConta()}
          >
            Carimbar a conta no quadro
          </Button>
        </Card>
      </div>
    </div>
  );
}
