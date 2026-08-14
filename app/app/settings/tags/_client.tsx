"use client";
import { useState } from "react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApagarClientTag,
  useClientTags,
  useCriarClientTag,
  useEditarClientTag,
} from "@/hooks/tags/useClientTags";
import {
  CLASSE_DA_BOLINHA,
  CLASSE_DO_CHIP,
  CORES_DE_TAG,
  COR_PADRAO,
  ROTULO_DA_COR,
  type CorDeTag,
  type TagDoCliente,
} from "@/lib/tags/cores";
import { MAX_NOME_DE_TAG } from "@/lib/schemas/client-tags";
import { Plus, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/** As 8 bolinhas da paleta. Fora de linha para o form e a linha usarem a MESMA. */
function EscolhaDeCor({
  valor,
  onEscolher,
  disabled,
}: {
  valor: CorDeTag;
  onEscolher: (cor: CorDeTag) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Cor da tag">
      {CORES_DE_TAG.map((cor) => (
        <button
          key={cor}
          type="button"
          disabled={disabled}
          onClick={() => onEscolher(cor)}
          aria-label={ROTULO_DA_COR[cor]}
          aria-pressed={valor === cor}
          title={ROTULO_DA_COR[cor]}
          className={cn(
            "h-5 w-5 rounded-full border-2 transition-transform disabled:opacity-50",
            CLASSE_DA_BOLINHA[cor],
            valor === cor ? "scale-110 border-text" : "border-transparent hover:scale-105",
          )}
        />
      ))}
    </div>
  );
}

/**
 * Uma linha do catálogo — nome editável, cor clicável, lixeira.
 *
 * O nome grava no BLUR e no Enter, não a cada tecla: um PATCH por tecla faria
 * a cascata que reescreve `contacts.tags` (0105) rodar dez vezes para uma
 * renomeação. A cor grava no clique porque clique é a intenção inteira.
 */
function LinhaDaTag({ tag }: { tag: TagDoCliente }) {
  const editar = useEditarClientTag();
  const apagar = useApagarClientTag();
  const [nome, setNome] = useState(tag.name);
  const [confirmando, setConfirmando] = useState(false);

  const salvarNome = () => {
    const limpo = nome.trim();
    if (!limpo || limpo === tag.name) {
      setNome(tag.name);
      return;
    }
    editar.mutate(
      { id: tag.id, name: limpo },
      {
        onSuccess: (res) => {
          const mexidos = (res as { data?: { clientes_atualizados?: number | null } }).data
            ?.clientes_atualizados;
          toast.success(
            mexidos
              ? `«${limpo}» renomeada em ${mexidos} ${mexidos === 1 ? "cliente" : "clientes"}.`
              : `«${limpo}» renomeada.`,
          );
        },
        // O servidor recusou (nome repetido): a caixa volta ao que o banco tem,
        // senão a tela ficaria mostrando um nome que não existe.
        onError: () => setNome(tag.name),
      },
    );
  };

  return (
    <>
      <li className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
            CLASSE_DO_CHIP[tag.color],
          )}
        >
          {tag.name}
        </span>

        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onBlur={salvarNome}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setNome(tag.name);
          }}
          maxLength={MAX_NOME_DE_TAG}
          disabled={editar.isPending}
          aria-label={`Nome da tag ${tag.name}`}
          className="h-7 flex-1 text-xs"
        />

        <EscolhaDeCor
          valor={tag.color}
          disabled={editar.isPending}
          onEscolher={(cor) => {
            if (cor === tag.color) return;
            editar.mutate({ id: tag.id, color: cor });
          }}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-error-fg"
          aria-label={`Apagar a tag ${tag.name}`}
          disabled={apagar.isPending}
          onClick={() => setConfirmando(true)}
        >
          <Trash size={14} aria-hidden />
        </Button>
      </li>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar a tag «{tag.name}»?</AlertDialogTitle>
            {/* O que a tela NÃO pode esconder: apagar aqui tira a marca de todo
                mundo que a tinha. Sem esta frase, "apagar do catálogo" parece
                uma limpeza de lista — e leva junto a informação de quem marcou
                cliente por cliente, sem volta. */}
            <AlertDialogDescription>
              Ela some da lista e sai também de todos os clientes que estavam marcados
              com ela. Isso não pode ser desfeito — para marcar de novo seria um
              cliente por vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apagar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={apagar.isPending}
              onClick={(e) => {
                e.preventDefault();
                apagar.mutate(tag.id, {
                  onSuccess: (res) => {
                    setConfirmando(false);
                    const mexidos =
                      (res as { data?: { clientes_atualizados?: number } }).data
                        ?.clientes_atualizados ?? 0;
                    toast.success(
                      mexidos
                        ? `«${tag.name}» apagada e removida de ${mexidos} ${mexidos === 1 ? "cliente" : "clientes"}.`
                        : `«${tag.name}» apagada.`,
                    );
                  },
                });
              }}
            >
              {apagar.isPending ? "Apagando…" : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function TagsDoClienteClient() {
  const { data: tags, isLoading } = useClientTags();
  const criar = useCriarClientTag();
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState<CorDeTag>(COR_PADRAO);

  const adicionar = () => {
    const limpo = nome.trim();
    if (!limpo) return;
    criar.mutate(
      { name: limpo, color: cor },
      {
        onSuccess: () => {
          setNome("");
          setCor(COR_PADRAO);
          toast.success(`«${limpo}» entrou na lista.`);
        },
      },
    );
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionar();
            }
          }}
          placeholder="Nome da tag (ex.: Cliente VIP)"
          maxLength={MAX_NOME_DE_TAG}
          disabled={criar.isPending}
          aria-label="Nome da nova tag"
          className="h-8 min-w-52 flex-1 text-sm"
        />
        <EscolhaDeCor valor={cor} onEscolher={setCor} disabled={criar.isPending} />
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={adicionar}
          disabled={criar.isPending || !nome.trim()}
        >
          <Plus size={14} className="mr-1" weight="bold" aria-hidden />
          {criar.isPending ? "Criando…" : "Criar tag"}
        </Button>
      </Card>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : (tags ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma tag ainda. Crie a primeira acima — ela aparece na hora no Kanban e no
          inbox.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(tags ?? []).map((t) => (
            <LinhaDaTag key={t.id} tag={t} />
          ))}
        </ul>
      )}
    </div>
  );
}
