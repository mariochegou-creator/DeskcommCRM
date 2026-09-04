"use client";
import { useCallback, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiClient } from "@/lib/api/client";
import type { Aviso, Tela } from "@/lib/copiloto/avisos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Robot, X } from "@/lib/ui/icons";

/**
 * O copiloto: um botão fixo no canto que lê a tela em que você está e aponta o
 * que importa nela agora.
 *
 * ⚠️ ELE FALA COM VOCÊ, NUNCA COM O CLIENTE. Nenhuma ação daqui envia mensagem:
 * o botão de cada aviso leva à tela certa e o enviar continua sendo humano. É a
 * mesma linha do modo copiloto por número — a IA lê, organiza e sugere.
 *
 * ⚠️ SÓ APARECE ONDE TEM REGRA. Fora das telas mapeadas o componente não
 * renderiza nada, em vez de mostrar um botão que abre um painel vazio — botão
 * que não responde ensina a ignorar o botão.
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

/**
 * "Depois" silencia o aviso até o dia seguinte, e a memória é do navegador de
 * propósito: é preferência de quem está olhando, não dado da empresa. Tabela
 * nova para isso seria migration, RLS e limpeza — para guardar "não me mostra
 * de novo hoje".
 */
const GUARDA = "copiloto:dispensados";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function lerDispensados(): Record<string, string> {
  // Roda também no servidor, na primeira renderização. Sem armazenamento a
  // resposta é "nada dispensado" — e como o componente não desenha nada até a
  // consulta voltar, servidor e navegador produzem a mesma tela.
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(GUARDA) ?? "{}") as Record<string, string>;
  } catch {
    return {};
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
  // para desligar um booleano. Painel do inbox aberto por cima do kanban
  // mostraria aviso de uma tela que não está mais na frente.
  const [abertoEm, setAbertoEm] = useState<Tela | null>(null);
  const aberto = abertoEm !== null && abertoEm === tela;
  const [dispensados, setDispensados] = useState<Record<string, string>>(lerDispensados);

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

  const dispensar = useCallback((id: string) => {
    setDispensados((antes) => {
      const novo = { ...antes, [id]: hojeISO() };
      try {
        localStorage.setItem(GUARDA, JSON.stringify(novo));
      } catch {
        // navegador sem armazenamento: some nesta sessão e volta na próxima
      }
      return novo;
    });
  }, []);

  if (!tela || avisos.length === 0) return null;

  const acionaveis = avisos.filter((a) => a.peso !== "ok");
  const primeiro = acionaveis[0] ?? avisos[0]!;

  return (
    <>
      {/* O balão é o copiloto falando sem ser aberto — é o que faz o botão valer
          a pena antes do primeiro clique. Some assim que o painel abre. */}
      {!aberto && (
        <div className="pointer-events-none fixed bottom-[5.5rem] right-4 z-40 hidden max-w-[17rem] rounded-xl rounded-br-sm border border-border bg-card p-3 text-xs leading-snug shadow-lg md:bottom-6 md:right-[4.75rem] md:block">
          <span className="font-medium">{primeiro.titulo}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAbertoEm(aberto ? null : tela)}
        aria-label={aberto ? "Fechar o copiloto" : `Abrir o copiloto — ${avisos.length} avisos`}
        aria-expanded={aberto}
        className="fixed bottom-[4.5rem] right-4 z-40 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:bottom-6"
      >
        <Robot size={22} aria-hidden />
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
            className="fixed bottom-[4.5rem] right-4 z-50 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl md:bottom-20"
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
              Lido do seu banco. Nenhuma mensagem é enviada por aqui.
            </p>
          </aside>
        </>
      )}
    </>
  );
}
