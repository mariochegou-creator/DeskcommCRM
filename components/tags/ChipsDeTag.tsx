"use client";
import { useMemo } from "react";

import { useClientTags } from "@/hooks/tags/useClientTags";
import {
  CLASSE_DO_CHIP,
  COR_PADRAO,
  chaveDaTag,
  indexaPorNome,
} from "@/lib/tags/cores";
import { cn } from "@/lib/utils";

interface Props {
  /** O que está aplicado no cliente — `contacts.tags`, como veio do banco. */
  nomes: string[] | null | undefined;
  /** Quantos chips cabem antes do "+N". A lista do inbox é estreita. */
  max?: number;
  /** `xs` para a lista do inbox e o card do Kanban; `sm` para painel e dossiê. */
  tamanho?: "xs" | "sm";
  className?: string;
}

/**
 * As tags do cliente, coloridas (0105).
 *
 * A cor vem do CATÁLOGO, casada por nome normalizado. Tag aplicada que não está
 * no catálogo aparece mesmo assim, em cinza: as tags de `contacts.tags` nasciam
 * de texto livre e da importação de prospecção muito antes de existir catálogo,
 * e esconder o que não casa faria o histórico sumir da tela sem aviso — o
 * mesmo defeito que "arrumar o vocabulário" não deveria causar.
 *
 * Enquanto o catálogo carrega, os chips saem cinza e NÃO somem: o layout da
 * lista do inbox não pode dançar a cada scroll. Como a query tem `staleTime` de
 * 5 min e chave única no app, isso só acontece uma vez por sessão.
 */
export function ChipsDeTag({ nomes, max = 2, tamanho = "xs", className }: Props) {
  const { data: catalogo } = useClientTags();
  const porNome = useMemo(() => indexaPorNome(catalogo ?? []), [catalogo]);

  const lista = (nomes ?? []).filter((n) => n.trim().length > 0);
  if (lista.length === 0) return null;

  const visiveis = lista.slice(0, max);
  const sobra = lista.length - visiveis.length;

  return (
    <>
      {visiveis.map((nome) => {
        const doCatalogo = porNome.get(chaveDaTag(nome));
        return (
          <span
            key={nome}
            className={cn(
              "inline-flex max-w-[10rem] items-center truncate rounded-full font-medium",
              tamanho === "xs" ? "h-4 px-1.5 text-[10px]" : "h-5 px-2 text-[11px]",
              CLASSE_DO_CHIP[doCatalogo?.color ?? COR_PADRAO],
              className,
            )}
            title={nome}
          >
            {doCatalogo?.name ?? nome}
          </span>
        );
      })}
      {sobra > 0 && (
        <span
          className={cn("text-text-muted", tamanho === "xs" ? "text-[10px]" : "text-[11px]")}
          title={lista.slice(max).join(", ")}
        >
          +{sobra}
        </span>
      )}
    </>
  );
}
