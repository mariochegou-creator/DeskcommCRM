"use client";

import { useState, useTransition } from "react";

import { acaoLimpar, acaoPreencher, type Resultado } from "./acoes";
import type { Contagem } from "@/lib/nexo-demo/seed";

export function Botoes({ inicial }: { inicial: Contagem }) {
  const [contagem, setContagem] = useState(inicial);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pendente, iniciar] = useTransition();

  const preenchido = contagem.negocios > 0;

  const rodar = (acao: () => Promise<Resultado>) =>
    iniciar(async () => {
      setResultado(null);
      const r = await acao();
      setResultado(r);
      if (r.contagem) setContagem(r.contagem);
    });

  return (
    <div className="flex flex-col gap-5">
      {/* Estado atual */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <span
          className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
            preenchido ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
          aria-hidden
        />
        <span className="text-sm font-medium">
          {preenchido ? "Demonstração ativa" : "Demonstração desligada"}
        </span>
        {preenchido && (
          <span className="text-sm text-muted-foreground">
            {contagem.negocios} negócios · {contagem.contatos} contatos ·{" "}
            {contagem.atividades} registros de histórico · {contagem.conversas} conversa
          </span>
        )}
      </div>

      {/* Botões */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => rodar(acaoPreencher)}
          disabled={pendente}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          {pendente ? "Trabalhando…" : preenchido ? "Preencher de novo" : "Preencher o CRM"}
        </button>

        <button
          type="button"
          onClick={() => rodar(acaoLimpar)}
          disabled={pendente || !preenchido}
          className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          Limpar
        </button>
      </div>

      {/* Retorno */}
      {resultado && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            resultado.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {resultado.mensagem}
        </div>
      )}

      {resultado?.ok && (
        <div className="flex flex-wrap gap-3 text-sm">
          <a href="/app/kanban" className="font-medium text-primary underline-offset-4 hover:underline">
            Ver o funil →
          </a>
          <a href="/app/radar" className="font-medium text-primary underline-offset-4 hover:underline">
            Ver o radar de risco →
          </a>
          <a href="/app/inbox" className="font-medium text-primary underline-offset-4 hover:underline">
            Ver a conversa →
          </a>
        </div>
      )}
    </div>
  );
}
