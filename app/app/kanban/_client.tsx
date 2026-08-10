"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { Trash } from "@/lib/ui/icons";

/**
 * A lista de funis do Kanban, com o "excluir" que faltava.
 *
 * ⚠️ EXCLUIR AQUI É ARQUIVAR NO BANCO, e o texto da tela não finge o contrário:
 * a FK dos negócios é `ON DELETE RESTRICT` (funil com negócio não pode ser
 * apagado) e a das etapas é `ON DELETE CASCADE` (apagar levaria as colunas e o
 * mapeamento do agente junto). O funil sai de todas as listas; os negócios
 * continuam existindo, invisíveis, e voltam inteiros no "Desfazer".
 *
 * ⚠️ AS REGRAS SÃO DA API; AQUI SÓ HÁ REFLEXO. Quem decide se pode excluir é
 * `DELETE /api/v1/pipelines/[id]` — a tela não recalcula "é o último funil?"
 * nem conta negócio por conta própria (a contagem do servidor é a do mesmo
 * instante da escrita; a da tela seria de quando a página carregou). O primeiro
 * clique PERGUNTA sem `confirmar`, e é a recusa 422 que traz os números para o
 * aviso vermelho — o segundo clique confirma com eles na tela.
 */

export interface FunilDaLista {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
  description: string | null;
}

/** O que a recusa do servidor ensina: o que está em jogo neste funil. */
interface EmJogo {
  negocios: number;
  abertos: number;
  formularios: number;
}

function mensagemDeErro(err: unknown, padrao: string): string {
  if (err instanceof ApiError) return err.message || padrao;
  if (err instanceof Error) return err.message || padrao;
  return padrao;
}

function leEmJogo(details: Record<string, unknown> | undefined): EmJogo | null {
  if (!details || details.precisa_confirmar !== true) return null;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    negocios: n(details.negocios),
    abertos: n(details.abertos),
    formularios: n(details.formularios),
  };
}

function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`;
}

export function FunisClient({
  funis,
  podeExcluir,
}: {
  funis: FunilDaLista[];
  /** Excluir funil é manager+ (a rota recusa o resto). */
  podeExcluir: boolean;
}) {
  const router = useRouter();
  const [alvo, setAlvo] = useState<FunilDaLista | null>(null);
  const [emJogo, setEmJogo] = useState<EmJogo | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const desfazer = useCallback(
    async (funil: FunilDaLista) => {
      try {
        await apiClient.patch<unknown>(
          `/api/v1/pipelines/${encodeURIComponent(funil.id)}`,
          { arquivado: false },
        );
        toast.success(`«${funil.name}» voltou para o Kanban.`);
        router.refresh();
      } catch (err) {
        toast.error(mensagemDeErro(err, "Não consegui trazer o funil de volta."));
      }
    },
    [router],
  );

  const excluir = useCallback(
    async (funil: FunilDaLista, confirmado: boolean) => {
      setOcupado(true);
      try {
        const res = await apiClient.delete<{
          data: { novo_padrao: { id: string; name: string } | null };
        }>(
          `/api/v1/pipelines/${encodeURIComponent(funil.id)}${confirmado ? "?confirmar=1" : ""}`,
        );
        setAlvo(null);
        setEmJogo(null);
        const virouPadrao = res.data.novo_padrao;
        toast.success(`«${funil.name}» saiu do Kanban.`, {
          description: virouPadrao
            ? `Era o funil padrão — «${virouPadrao.name}» assumiu o lugar.`
            : "Os negócios não foram apagados: eles voltam junto se você desfizer.",
          // 20s porque desfazer é a única saída pela tela — quem clicou errado
          // precisa de tempo para ler o que aconteceu antes de decidir.
          duration: 20_000,
          action: { label: "Desfazer", onClick: () => void desfazer(funil) },
        });
        router.refresh();
      } catch (err) {
        // 422 com a contagem não é erro de verdade: é a pergunta que faltava.
        const pendente = err instanceof ApiError ? leEmJogo(err.details) : null;
        if (pendente) {
          setEmJogo(pendente);
          return;
        }
        toast.error(mensagemDeErro(err, "Não consegui excluir este funil."));
      } finally {
        setOcupado(false);
      }
    },
    [desfazer, router],
  );

  return (
    <>
      <ul className="flex flex-col gap-2">
        {funis.map((p) => (
          <li key={p.id} className="flex items-stretch gap-1">
            <Link
              href={`/app/pipelines/${p.id}`}
              className="flex flex-1 items-center justify-between rounded-md border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.is_default && (
                    <Badge variant="secondary" className="text-[10px]">
                      Padrão
                    </Badge>
                  )}
                </div>
                {p.description && (
                  <span className="text-xs text-muted-foreground">{p.description}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">/{p.slug}</span>
            </Link>

            {/* FORA do Link, não dentro: botão aninhado em âncora navega e
                exclui no mesmo clique em quem usa teclado. */}
            {podeExcluir && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="self-center text-error-fg"
                aria-label={`Excluir o funil ${p.name}`}
                title="Excluir funil"
                onClick={() => {
                  setEmJogo(null);
                  setAlvo(p);
                }}
              >
                <Trash size={16} aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog
        open={!!alvo}
        onOpenChange={(aberto) => {
          if (!aberto && !ocupado) {
            setAlvo(null);
            setEmJogo(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir o funil {alvo ? `«${alvo.name}»` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O funil sai do Kanban, das configurações e do seletor de quem cria negócio.
              Nada é apagado: as colunas, os negócios e o histórico continuam guardados, e
              voltam inteiros se você clicar em &ldquo;Desfazer&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* O que só o servidor sabe, e só depois do primeiro clique. Sem estes
              números, "excluir" parece de graça num funil com 200 negócios
              dentro. */}
          {emJogo && (
            <div className="rounded-md border border-error bg-error-bg p-3 text-sm text-error-fg">
              <p className="font-medium">Atenção: este funil não está vazio.</p>
              {emJogo.negocios > 0 && (
                <p className="mt-1">
                  {plural(emJogo.negocios, "negócio", "negócios")} some
                  {emJogo.negocios === 1 ? "" : "m"} da tela junto com ele
                  {emJogo.abertos > 0
                    ? ` — ${plural(emJogo.abertos, "está aberto", "estão abertos")} agora.`
                    : "."}
                </p>
              )}
              {emJogo.formularios > 0 && (
                <p className="mt-1">
                  {plural(emJogo.formularios, "formulário aponta", "formulários apontam")}{" "}
                  para este funil. Quem preencher continua virando negócio aqui — e você não
                  vai ver.
                </p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={ocupado}
              onClick={(e) => {
                e.preventDefault(); // fecha só depois que o servidor confirmar
                if (alvo) void excluir(alvo, emJogo !== null);
              }}
            >
              {ocupado ? "Excluindo…" : emJogo ? "Excluir mesmo assim" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
