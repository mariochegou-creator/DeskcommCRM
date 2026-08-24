"use client";
/**
 * As ligações que ainda estão subindo ou sendo analisadas, fora do caminho.
 *
 * O PROBLEMA QUE ISTO RESOLVE: o popup da ligação segurava a tela do começo ao
 * fim. Depois de desligar, ele esperava a fila de blocos esvaziar, subia o
 * áudio e ficava mostrando "Analisando…" até alguém fechar — com o SDR parado
 * olhando. Só que o trabalho todo já acontece no servidor: a análise roda num
 * worker e o resultado espera na tela de Ligações. Não havia nada para o SDR
 * fazer ali além de esperar, e esperar é o que ele não pode: o próximo lead
 * está na fila.
 *
 * COMO FICOU: o popup entrega o resto do trabalho aqui e fecha na hora. Uma
 * pílula pequena aparece no topo, acompanha até o fim, e o SDR volta a
 * trabalhar. Clicar nela leva ao resultado.
 *
 * FLUTUA, NÃO EMPURRA (`fixed`). Uma barra que ocupa altura no topo reposiciona
 * a página inteira duas vezes por ligação — aparece e some — e o clique do SDR
 * cai no lugar errado no meio de outra tarefa.
 *
 * UMA POR LIGAÇÃO, EMPILHADAS. Ligar para o próximo antes de a análise anterior
 * terminar é o fluxo normal de quem prospecta, e não o caso raro. Uma pílula só
 * faria a segunda apagar a primeira, e ninguém saberia que a análise de uma
 * ligação sumiu no meio.
 */
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useCall } from "@/hooks/calls/useCalls";
import { isTerminalCallStatus } from "@/lib/calls/analysis-schema";
import { CheckCircle, CircleNotch, Warning, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export interface LigacaoEmVoo {
  callId: string;
  /** De quem foi a ligação — a pílula não serve de nada sem o nome. */
  contato: string;
  /**
   * O que ainda falta antes de a análise começar: esvaziar a fila de blocos e
   * subir o áudio. Vem do popup porque só ele tem o arquivo gravado na memória,
   * mas roda AQUI — é a parte que segurava a tela.
   */
  subir: () => Promise<void>;
}

type Registrar = (v: LigacaoEmVoo) => void;

const Ctx = createContext<Registrar>(() => {});

/** O popup chama isto e fecha. */
export function useAcompanharLigacao(): Registrar {
  return useContext(Ctx);
}

export function LigacoesEmVooProvider({ children }: { children: ReactNode }) {
  const [emVoo, setEmVoo] = useState<LigacaoEmVoo[]>([]);

  const registrar = useCallback<Registrar>((v) => {
    setEmVoo((lista) => (lista.some((x) => x.callId === v.callId) ? lista : [...lista, v]));
  }, []);

  const dispensar = useCallback((callId: string) => {
    setEmVoo((lista) => lista.filter((x) => x.callId !== callId));
  }, []);

  return (
    <Ctx.Provider value={registrar}>
      {children}
      {emVoo.length > 0 && (
        <div
          // Abaixo do z-20 da TopBar de propósito: no celular a pílula
          // encostaria nela, e cobrir a navegação para avisar de uma tarefa de
          // fundo troca uma coisa que o SDR precisa por uma que ele só observa.
          className="pointer-events-none fixed inset-x-0 top-16 z-10 flex flex-col items-center gap-2 px-4"
          aria-live="polite"
        >
          {emVoo.map((v) => (
            <Pilula key={v.callId} ligacao={v} onDispensar={() => dispensar(v.callId)} />
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

type Etapa = "subindo" | "analisando" | "pronta" | "falhou";

/** Quanto tempo a pílula de sucesso fica antes de sair sozinha. */
const SUMIR_DEPOIS_MS = 20_000;

function Pilula({ ligacao, onDispensar }: { ligacao: LigacaoEmVoo; onDispensar: () => void }) {
  const [subiu, setSubiu] = useState(false);
  const [erroDoUpload, setErroDoUpload] = useState<string | null>(null);

  // O upload roda UMA vez, e o ref é o que garante isso: em dev o React monta o
  // componente duas vezes, e sem a trava o mesmo áudio subiria em duplicata —
  // duas análises pagas pela mesma ligação.
  const jaSubiu = useRef(false);
  useEffect(() => {
    if (jaSubiu.current) return;
    jaSubiu.current = true;
    ligacao
      .subir()
      .then(() => setSubiu(true))
      .catch((err: unknown) => {
        // Toast E pílula, e aqui a redundância é de propósito: o áudio que não
        // sobe é uma ligação PERDIDA, não um contratempo. O toast garante que o
        // SDR veja no segundo em que acontece (ele pode estar noutra tela); a
        // pílula fica, porque um toast some sozinho em cinco segundos.
        showApiError(err);
        setErroDoUpload(
          err instanceof Error ? `O áudio não subiu: ${err.message}` : "O áudio não subiu.",
        );
      });
  }, [ligacao]);

  const call = useCall(ligacao.callId, { poll: subiu && !erroDoUpload });
  const status = call.data?.data.status ?? null;

  // A ETAPA É DERIVADA, não guardada. Copiá-la para um estado próprio exigiria
  // um efeito que espelha o status do servidor — e um espelho é um lugar a mais
  // onde a tela pode discordar do que de fato aconteceu.
  const etapa: Etapa = erroDoUpload
    ? "falhou"
    : !subiu
      ? "subindo"
      : status && isTerminalCallStatus(status)
        ? status === "failed"
          ? "falhou"
          : "pronta"
        : "analisando";

  const detalhe =
    erroDoUpload ?? (status === "failed" ? (call.data?.data.error_detail ?? null) : null);

  // Sucesso sai sozinho: a análise não vai a lugar nenhum (fica na tela de
  // Ligações e na timeline do contato), então manter a pílula na tela seria
  // exatamente o entulho que ela foi criada para tirar. Falha FICA — essa
  // ninguém pode perder de vista.
  useEffect(() => {
    if (etapa !== "pronta") return;
    const t = setTimeout(onDispensar, SUMIR_DEPOIS_MS);
    return () => clearTimeout(t);
  }, [etapa, onDispensar]);

  const trabalhando = etapa === "subindo" || etapa === "analisando";
  const texto =
    etapa === "subindo"
      ? "Guardando a ligação"
      : etapa === "analisando"
        ? "Analisando a ligação"
        : etapa === "pronta"
          ? "Análise pronta"
          : "A ligação falhou";

  const corpo = (
    <>
      {trabalhando && <CircleNotch size={15} className="shrink-0 animate-spin" aria-hidden />}
      {etapa === "pronta" && (
        <CheckCircle size={15} weight="fill" className="shrink-0 text-success-fg" aria-hidden />
      )}
      {etapa === "falhou" && (
        <Warning size={15} weight="fill" className="shrink-0 text-warning-fg" aria-hidden />
      )}
      <span className="truncate">
        {texto} · <span className="font-semibold">{ligacao.contato}</span>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-[min(28rem,100%)] items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 text-xs shadow-md",
        etapa === "falhou"
          ? "border-warning-fg/40 bg-warning-bg text-warning-fg"
          : "border-border bg-surface-elevated text-fg",
      )}
      title={detalhe ?? undefined}
    >
      {/* Enquanto sobe não há o que abrir: a análise ainda não começou, e um
          link que leva a uma tela vazia ensina o SDR a não clicar mais. */}
      {etapa === "subindo" ? (
        <span className="flex min-w-0 items-center gap-2">{corpo}</span>
      ) : (
        <Link
          href="/app/calls"
          onClick={onDispensar}
          className="flex min-w-0 items-center gap-2 rounded-full outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          {corpo}
        </Link>
      )}
      <button
        type="button"
        onClick={onDispensar}
        aria-label={`Dispensar aviso da ligação de ${ligacao.contato}`}
        className="shrink-0 rounded-full p-1 text-muted-foreground outline-none hover:bg-bg focus-visible:ring-2 focus-visible:ring-accent-500"
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
