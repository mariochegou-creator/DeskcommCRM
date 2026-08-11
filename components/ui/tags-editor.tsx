"use client";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus } from "@/lib/ui/icons";

interface TagsEditorProps {
  /** As tags de agora. O componente NÃO guarda cópia — quem manda é o dono. */
  tags: string[];
  /** Recebe a lista inteira já pronta (adicionada ou removida). */
  onChange: (proximas: string[]) => void;
  /** Sugestões de um clique; as que já estão aplicadas somem sozinhas. */
  sugestoes?: string[];
  disabled?: boolean;
  /** O que aparece quando não há nenhuma. */
  vazio?: string;
  placeholder?: string;
  /** Completa os rótulos de acessibilidade: "Adicionar tag ao negócio". */
  alvo: string;
  /** Normalização extra além do trim — a conversa usa minúsculas (espelha o Zod). */
  normalizar?: (t: string) => string;
  max?: number;
  maxLen?: number;
}

/**
 * Chips + campo + sugestões: a peça de mexer em tags, sem saber de onde elas
 * vêm nem para onde vão.
 *
 * Puro de I/O de propósito. Nasceu do editor de tags da conversa quando o
 * painel do inbox ganhou as tags do NEGÓCIO: dois editores lado a lado, na
 * mesma coluna de 320px, com comportamentos que divergissem no primeiro ajuste
 * seriam lidos como dois controles diferentes para a mesma ideia.
 */
export function TagsEditor({
  tags,
  onChange,
  sugestoes,
  disabled,
  vazio = "Sem tags.",
  placeholder = "Nova tag…",
  alvo,
  normalizar,
  max = 20,
  maxLen = 40,
}: TagsEditorProps) {
  const [draft, setDraft] = useState("");
  const cheio = tags.length >= max;

  function add(bruto: string) {
    const base = bruto.trim().slice(0, maxLen);
    const tag = normalizar ? normalizar(base) : base;
    if (!tag || tags.includes(tag) || cheio) return;
    onChange([...tags, tag]);
    setDraft("");
  }

  const disponiveis = (sugestoes ?? []).filter((t) => !tags.includes(t)).slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {tags.length > 0 ? (
          tags.map((t) => (
            <Badge key={t} variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
              {t}
              <button
                type="button"
                onClick={() => onChange(tags.filter((x) => x !== t))}
                disabled={disabled}
                aria-label={`Remover tag ${t}`}
                className="rounded-sm hover:text-destructive"
              >
                <X size={10} weight="bold" aria-hidden />
              </button>
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{vazio}</span>
        )}
      </div>

      <div className="mt-2 flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder={placeholder}
          maxLength={maxLen}
          disabled={disabled || cheio}
          className="h-7 text-xs"
          aria-label={`Adicionar tag ${alvo}`}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => add(draft)}
          disabled={disabled || !draft.trim() || cheio}
          aria-label="Adicionar tag"
        >
          <Plus size={12} weight="regular" aria-hidden />
        </Button>
      </div>

      {disponiveis.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {disponiveis.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              disabled={disabled || cheio}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground disabled:opacity-50"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
