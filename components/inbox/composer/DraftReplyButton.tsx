"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sparkle, X } from "@/lib/ui/icons";
import { useDraftReply, type RascunhoDaIa } from "@/hooks/inbox/useDraftReply";

interface Props {
  conversationId: string;
  onDraft: (text: string) => void;
  /** Há algo escrito no campo? Muda o rótulo do botão — substituir é diferente de preencher. */
  campoOcupado: boolean;
  disabled?: boolean;
}

/**
 * "Sugerir resposta": pede três opções ao agente publicado e deixa o vendedor
 * escolher. Não envia nada.
 *
 * ⚠️ O QUE MUDOU E POR QUÊ. Antes o botão trocava o conteúdo do campo pela
 * sugestão, direto — quem tinha começado a escrever perdia o que escreveu e não
 * tinha como voltar. Clicar num botão de ajuda não pode destruir trabalho: agora
 * as opções aparecem numa lista, o campo só muda quando uma é escolhida, e o
 * rótulo avisa quando a escolha vai substituir algo.
 *
 * ⚠️ AS FONTES FICAM À MOSTRA. Sem elas, conferir a sugestão exige reler a
 * conversa inteira — que é o trabalho que o botão prometia poupar. É o mesmo
 * caminho de Zendesk e Intercom, e é o que separa sugestão de chute.
 */
export function DraftReplyButton({ conversationId, onDraft, campoOcupado, disabled }: Props) {
  const mutation = useDraftReply();
  const [rascunho, setRascunho] = useState<RascunhoDaIa | null>(null);

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-9 w-9 shrink-0"
        aria-label="Sugerir resposta"
        aria-busy={mutation.isPending}
        disabled={disabled || mutation.isPending}
        onClick={() => {
          if (rascunho) {
            setRascunho(null);
            return;
          }
          mutation.mutate(conversationId, {
            onSuccess: (res) => setRascunho(res.data),
          });
        }}
      >
        <Sparkle size={18} weight={mutation.isPending || rascunho ? "duotone" : "regular"} aria-hidden />
      </Button>

      {rascunho && rascunho.sugestoes.length > 0 && (
        <div
          className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-card p-2.5 shadow-xl"
          role="group"
          aria-label="Sugestões da IA"
        >
          <div className="mb-2 flex items-center gap-2">
            <Sparkle size={15} className="text-primary" aria-hidden />
            <p className="flex-1 text-xs font-semibold">
              {rascunho.sugestoes.length === 1
                ? "Uma sugestão"
                : `${rascunho.sugestoes.length} jeitos de responder`}
            </p>
            <button
              type="button"
              onClick={() => setRascunho(null)}
              aria-label="Fechar sugestões"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-fg"
            >
              <X size={14} aria-hidden />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {rascunho.sugestoes.map((s, i) => (
              <div key={`${s.angulo}-${i}`} className="rounded-lg border border-border p-2.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {s.angulo}
                </span>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{s.texto}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-[11px]"
                  onClick={() => {
                    onDraft(s.texto);
                    setRascunho(null);
                  }}
                >
                  {campoOcupado ? "Substituir pelo texto" : "Usar esta"}
                </Button>
              </div>
            ))}
          </div>

          {rascunho.fontes.length > 0 && (
            <p className="mt-2 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
              Escrito a partir de {rascunho.fontes.join(", ")}. Confira antes de enviar.
            </p>
          )}
        </div>
      )}
    </>
  );
}
