"use client";
import { useMemo } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAplicarTagsNoCliente, useClientTags } from "@/hooks/tags/useClientTags";
import {
  CLASSE_DA_BOLINHA,
  chaveDaTag,
  type TagDoCliente,
} from "@/lib/tags/cores";
import { Check, Gear, Plus } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { ChipsDeTag } from "./ChipsDeTag";

interface Props {
  /** Sem contato não há onde gravar — o negócio importado sem número é o caso. */
  contactId: string | null | undefined;
  /** O que está aplicado agora (`contacts.tags`). */
  tags: string[] | null | undefined;
  /** Escrita é agent+; viewer vê os chips e não o botão. */
  podeEditar?: boolean;
}

/**
 * Marcar e desmarcar as tags do cliente (0105), a partir do catálogo.
 *
 * NÃO tem campo de texto livre, e essa é a diferença que justifica a peça
 * existir ao lado do `TagsEditor` genérico: tag digitada na hora é como as três
 * listas antigas viraram vocabulário particular de cada um (e sem cor). Aqui a
 * lista é a de Configurações, e o atalho para editá-la fica no rodapé do
 * popover — perto de onde a falta é sentida.
 *
 * O conjunto vai INTEIRO no PATCH (ver `aplicarTagsDoClienteSchema`): o clique
 * calcula o estado final e manda. Um verbo incremental precisaria de ordenação
 * entre requisições para dois cliques rápidos não perderem um.
 *
 * **Preserva o que não é do catálogo.** `contacts.tags` recebia texto livre
 * antes da 0105 (e ainda recebe da importação de prospecção). O que não está no
 * catálogo é mantido intocado a cada escrita — sem isso, marcar uma tag apagaria
 * em silêncio as marcas que vieram da lista importada.
 */
export function SeletorDeTagsDoCliente({ contactId, tags, podeEditar = true }: Props) {
  const { data: catalogo, isLoading } = useClientTags();
  const aplicar = useAplicarTagsNoCliente();

  const aplicadas = useMemo(() => (tags ?? []).filter((t) => t.trim().length > 0), [tags]);
  const chaves = useMemo(() => new Set(aplicadas.map(chaveDaTag)), [aplicadas]);

  /** As que estão no contato e não no catálogo — texto livre e importação. */
  const forasteiras = useMemo(() => {
    const doCatalogo = new Set((catalogo ?? []).map((t) => chaveDaTag(t.name)));
    return aplicadas.filter((t) => !doCatalogo.has(chaveDaTag(t)));
  }, [aplicadas, catalogo]);

  function alternar(tag: TagDoCliente) {
    if (!contactId) return;
    const marcada = chaves.has(chaveDaTag(tag.name));
    const doCatalogo = (catalogo ?? [])
      .filter((t) =>
        chaveDaTag(t.name) === chaveDaTag(tag.name)
          ? !marcada
          : chaves.has(chaveDaTag(t.name)),
      )
      .map((t) => t.name);
    aplicar.mutate({ contactId, tags: [...doCatalogo, ...forasteiras] });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {aplicadas.length > 0 ? (
        <ChipsDeTag nomes={aplicadas} max={99} tamanho="sm" />
      ) : (
        <span className="text-xs text-text-muted">Sem tag.</span>
      )}

      {podeEditar && contactId && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-5 gap-1 px-1.5 text-[11px]"
              disabled={aplicar.isPending}
              aria-label="Escolher tags do cliente"
            >
              <Plus size={11} weight="bold" aria-hidden />
              Tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 p-1">
            <div className="max-h-64 overflow-y-auto">
              {isLoading ? (
                <p className="px-2 py-3 text-xs text-text-muted">Carregando…</p>
              ) : (catalogo ?? []).length === 0 ? (
                <p className="px-2 py-3 text-xs text-text-muted">
                  Nenhuma tag configurada ainda.
                </p>
              ) : (
                (catalogo ?? []).map((t) => {
                  const marcada = chaves.has(chaveDaTag(t.name));
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => alternar(t)}
                      disabled={aplicar.isPending}
                      aria-pressed={marcada}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                        "hover:bg-surface-elevated disabled:opacity-50",
                      )}
                    >
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", CLASSE_DA_BOLINHA[t.color])}
                        aria-hidden
                      />
                      <span className="flex-1 truncate">{t.name}</span>
                      {marcada && <Check size={12} weight="bold" aria-hidden />}
                    </button>
                  );
                })
              )}
            </div>
            <div className="mt-1 border-t border-border pt-1">
              <Link
                href="/app/settings/tags"
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-text-muted hover:bg-surface-elevated hover:text-text"
              >
                <Gear size={12} aria-hidden />
                Configurar tags
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
