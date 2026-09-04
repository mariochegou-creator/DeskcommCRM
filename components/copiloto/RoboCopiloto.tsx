"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiClient } from "@/lib/api/client";
import type { Aviso, Tela } from "@/lib/copiloto/avisos";
import {
  ancoraDoPainel,
  foiArraste,
  grudarNaTela,
  posicaoPadrao,
  TAMANHO_DO_ROBO,
  type Ponto,
} from "@/lib/copiloto/posicao";
import { tocarAviso } from "./som";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Robot, X } from "@/lib/ui/icons";

/**
 * O copiloto: uma bolinha solta na tela que lê onde você está e aponta o que
 * importa ali agora.
 *
 * ⚠️ ELE FALA COM VOCÊ, NUNCA COM O CLIENTE. Nenhuma ação daqui envia mensagem:
 * o botão de cada aviso leva à tela certa e o enviar continua sendo humano. É a
 * mesma linha do modo copiloto por número — a IA lê, organiza e sugere.
 *
 * ⚠️ SÓ APARECE ONDE TEM REGRA. Fora das telas mapeadas o componente não
 * renderiza nada, em vez de mostrar um botão que abre um painel vazio — botão
 * que não responde ensina a ignorar o botão.
 *
 * ⚠️ SOLTO, e não preso num canto: o canto certo depende da tela. No kanban a
 * direita de baixo é onde ficam os cards do fim do funil; no inbox é onde fica o
 * campo de resposta. Em vez de escolher um canto que atrapalha metade das telas,
 * quem arrasta é quem usa — e a posição fica guardada.
 */

const POR_ROTA: { prefixo: string; tela: Tela }[] = [
  { prefixo: "/app/inbox", tela: "inbox" },
  { prefixo: "/app/kanban", tela: "kanban" },
  { prefixo: "/app/connections", tela: "conexoes" },
  { prefixo: "/app/tarefas", tela: "tarefas" },
];

function telaDaRota(pathname: string | null): Tela | null {
  if (!pathname) return null;
  return POR_ROTA.find((r) => pathname.startsWith(r.prefixo))?.tela ?? null;
}

const GUARDA_DISPENSA = "copiloto:dispensados";
const GUARDA_POSICAO = "copiloto:posicao";
const LARGURA_DO_PAINEL = 340;
const ALTURA_DO_PAINEL = 400;

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Depois" silencia o aviso até o dia seguinte, e a memória é do navegador de
 * propósito: é preferência de quem está olhando, não dado da empresa. Tabela
 * nova para isso seria migration, RLS e limpeza — para guardar "não me mostra
 * de novo hoje". Vale o mesmo para onde a bolinha foi largada.
 */
function lerGuardado<T>(chave: string, padrao: T): T {
  if (typeof localStorage === "undefined") return padrao;
  try {
    const cru = localStorage.getItem(chave);
    return cru ? (JSON.parse(cru) as T) : padrao;
  } catch {
    return padrao;
  }
}

function guardar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // navegador sem armazenamento: vale só nesta sessão
  }
}

const ESTILO: Record<Aviso["peso"], { caixa: string; etiqueta: string }> = {
  agir: { caixa: "border-error", etiqueta: "bg-error-bg text-error-fg" },
  atencao: { caixa: "border-warning", etiqueta: "bg-warning-bg text-warning-fg" },
  nota: { caixa: "border-border", etiqueta: "bg-muted text-muted-foreground" },
  ok: { caixa: "border-success", etiqueta: "bg-success-bg text-success-fg" },
};

export function RoboCopiloto() {
  const pathname = usePathname();
  const tela = telaDaRota(pathname);

  // Guarda a TELA em que o painel foi aberto, não um sim/não. Assim a troca de
  // rota fecha o painel sozinha, por derivação — sem efeito que observa a rota
  // para desligar um booleano.
  const [abertoEm, setAbertoEm] = useState<Tela | null>(null);
  const aberto = abertoEm !== null && abertoEm === tela;
  const [dispensados, setDispensados] = useState<Record<string, string>>(() =>
    lerGuardado(GUARDA_DISPENSA, {}),
  );

  const [posicao, setPosicao] = useState<Ponto | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const arrasto = useRef<{ inicio: Ponto; offset: Ponto; moveu: boolean } | null>(null);
  const arrastouAgora = useRef(false);

  /** Contador de chamadas. Cresce a cada aviso novo e é a `key` que remonta a animação. */
  const [chamadas, setChamadas] = useState(0);
  const jaVistos = useRef<Set<string> | null>(null);

  const { data } = useQuery({
    queryKey: ["copiloto", tela],
    enabled: Boolean(tela),
    // 2 min: o copiloto responde "como está agora", não "o que mudou neste
    // segundo". Refetch curto aqui é varredura no banco a cada respiração.
    staleTime: 120_000,
    refetchInterval: 300_000,
    retry: false,
    queryFn: async () => {
      const res = await apiClient.get<{ data: { avisos: Aviso[] } }>(
        `/api/v1/copiloto/avisos?tela=${tela}`,
      );
      return res.data.avisos;
    },
  });

  const avisos = useMemo(() => {
    const hoje = hojeISO();
    return (data ?? []).filter((a) => dispensados[a.id] !== hoje);
  }, [data, dispensados]);

  // Nasce onde a mão alcança e volta pra dentro se a janela encolher — robô
  // largado fora da tela não tem como voltar pelo próprio robô.
  useEffect(() => {
    const ajustar = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setPosicao((antes) =>
        grudarNaTela(antes ?? lerGuardado(GUARDA_POSICAO, posicaoPadrao(vw, vh, vw < 768)), vw, vh),
      );
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  /**
   * Toca e balança só quando aparece um aviso que ainda não estava lá.
   *
   * ⚠️ A PRIMEIRA CARGA NÃO TOCA. Abrir a tela e levar um bip por avisos que já
   * existiam ontem é barulho, não notificação — e barulho é o caminho mais curto
   * para a pessoa desligar o som. `jaVistos` começa nulo justamente para
   * distinguir "primeira vez que vi esta lista" de "chegou coisa nova".
   */
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.filter((a) => a.peso !== "ok").map((a) => a.id));
    if (jaVistos.current === null) {
      jaVistos.current = ids;
      return;
    }
    const novos = [...ids].filter((id) => !jaVistos.current!.has(id));
    jaVistos.current = ids;
    if (novos.length === 0) return;
    setChamadas((n) => n + 1);
    tocarAviso();
  }, [data]);

  // Troca de tela recomeça a contagem: os avisos do kanban são outros, e sem
  // isso a primeira carga de cada tela tocaria como se fosse novidade.
  useEffect(() => {
    jaVistos.current = null;
  }, [tela]);

  const dispensar = useCallback((id: string) => {
    setDispensados((antes) => {
      const novo = { ...antes, [id]: hojeISO() };
      guardar(GUARDA_DISPENSA, novo);
      return novo;
    });
  }, []);

  const aoPegar = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!posicao) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      arrasto.current = {
        inicio: { x: e.clientX, y: e.clientY },
        offset: { x: e.clientX - posicao.x, y: e.clientY - posicao.y },
        moveu: false,
      };
    },
    [posicao],
  );

  const aoMover = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const a = arrasto.current;
    if (!a) return;
    if (!a.moveu && foiArraste(a.inicio, { x: e.clientX, y: e.clientY })) {
      a.moveu = true;
      setArrastando(true);
      setAbertoEm(null); // painel aberto não acompanha bem o arrasto: fecha
    }
    if (!a.moveu) return;
    setPosicao(
      grudarNaTela(
        { x: e.clientX - a.offset.x, y: e.clientY - a.offset.y },
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, []);

  const aoSoltar = useCallback(() => {
    const a = arrasto.current;
    arrasto.current = null;
    setArrastando(false);
    if (a?.moveu) {
      if (posicao) guardar(GUARDA_POSICAO, posicao);
      // O navegador dispara `click` depois do `pointerup` mesmo quando o
      // ponteiro andou. Sem esta trava, largar o robô abriria o painel junto.
      arrastouAgora.current = true;
    }
  }, [posicao]);

  /**
   * Abrir e fechar mora no `click`, e não no `pointerup`, porque `click` é o
   * único evento que o teclado também dispara — Enter e Espaço num <button>.
   * Tratar só ponteiro deixaria a bolinha inalcançável para quem não usa mouse.
   */
  const aoClicar = useCallback(() => {
    if (arrastouAgora.current) {
      arrastouAgora.current = false;
      return;
    }
    setAbertoEm(aberto ? null : tela);
  }, [aberto, tela]);

  if (!tela || avisos.length === 0 || !posicao) return null;

  const acionaveis = avisos.filter((a) => a.peso !== "ok");
  const primeiro = acionaveis[0] ?? avisos[0]!;
  const ancora =
    typeof window === "undefined"
      ? { left: 0, top: 0 }
      : ancoraDoPainel(
          posicao,
          window.innerWidth,
          window.innerHeight,
          LARGURA_DO_PAINEL,
          ALTURA_DO_PAINEL,
        );
  // O balão fica do lado em que sobra tela, senão ele nasce fora da janela
  // quando o robô está encostado na direita.
  const balaoNaEsquerda = posicao.x + TAMANHO_DO_ROBO / 2 > window.innerWidth / 2;

  return (
    <>
      {!aberto && !arrastando && (
        <div
          className="pointer-events-none fixed z-40 hidden max-w-[16rem] rounded-xl border border-border bg-card p-2.5 text-xs font-medium leading-snug shadow-lg md:block"
          style={{
            top: posicao.y + 4,
            left: balaoNaEsquerda ? undefined : posicao.x + TAMANHO_DO_ROBO + 10,
            right: balaoNaEsquerda
              ? window.innerWidth - posicao.x + 10
              : undefined,
          }}
        >
          {primeiro.titulo}
        </div>
      )}

      <button
        type="button"
        onPointerDown={aoPegar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onClick={aoClicar}
        aria-label={aberto ? "Fechar o copiloto" : `Abrir o copiloto — ${avisos.length} avisos`}
        aria-expanded={aberto}
        className={cn(
          "fixed z-40 grid place-items-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          arrastando ? "cursor-grabbing scale-110" : "cursor-grab",
          // touch-none: sem isso o navegador do celular rola a página em vez de
          // deixar arrastar, e a bolinha fica presa.
          "touch-none transition-transform",
        )}
        style={{ left: posicao.x, top: posicao.y, width: TAMANHO_DO_ROBO, height: TAMANHO_DO_ROBO }}
      >
        {/* key = contador: é a remontagem que faz a animação recomeçar a cada
            chamada. Alternar classe no mesmo nó não reinicia animação em CSS. */}
        {chamadas > 0 && (
          <span
            key={chamadas}
            className="copiloto-onda pointer-events-none absolute inset-0 rounded-full border-2 border-primary"
            aria-hidden
          />
        )}
        <span key={`corpo-${chamadas}`} className={cn(chamadas > 0 && "copiloto-chamada")}>
          <Robot size={22} aria-hidden />
        </span>
        {acionaveis.length > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-bg bg-error px-1 text-[10px] font-medium text-white">
            {acionaveis.length}
          </span>
        )}
      </button>

      {aberto && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 md:hidden"
            onClick={() => setAbertoEm(null)}
            aria-hidden
          />
          <aside
            className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
            style={{
              left: ancora.left,
              top: ancora.top,
              width: Math.min(LARGURA_DO_PAINEL, window.innerWidth - 24),
              maxHeight: ALTURA_DO_PAINEL,
            }}
            aria-label="Copiloto"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Robot size={17} className="text-primary" aria-hidden />
              <h2 className="flex-1 text-sm font-semibold">O que importa aqui agora</h2>
              <button
                type="button"
                onClick={() => setAbertoEm(null)}
                aria-label="Fechar"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-fg"
              >
                <X size={15} aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto p-2.5">
              {avisos.map((a) => (
                <div key={a.id} className={cn("rounded-lg border p-2.5 text-xs", ESTILO[a.peso].caixa)}>
                  <span
                    className={cn(
                      "inline-block rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
                      ESTILO[a.peso].etiqueta,
                    )}
                  >
                    {a.etiqueta}
                  </span>
                  <p className="mt-1.5 text-[13px] font-semibold leading-snug">{a.titulo}</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">{a.texto}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.acao && (
                      <Button asChild size="sm" className="h-7 text-[11px]">
                        <Link href={a.acao.href} onClick={() => setAbertoEm(null)}>
                          {a.acao.rotulo}
                        </Link>
                      </Button>
                    )}
                    {a.peso !== "ok" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => dispensar(a.id)}
                      >
                        Depois
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
              Arraste o robô para onde quiser. Nenhuma mensagem é enviada por aqui.
            </p>
          </aside>
        </>
      )}
    </>
  );
}
