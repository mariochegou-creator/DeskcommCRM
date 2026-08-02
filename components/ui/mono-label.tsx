import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * MonoLabel — a assinatura da marca Nexo IA: `// pipeline` em JetBrains Mono,
 * minúsculas, com as duas barras em ciano.
 *
 * Vem direto de nexoialocal.com.br, que usa exatamente este rótulo para abrir
 * seção. É o ÚNICO lugar do CRM onde texto pequeno pode ser ciano.
 *
 * USAR COM MODERAÇÃO — no máximo um por bloco de conteúdo. Repetido a cada
 * subtítulo ele deixa de assinar e vira textura: quando tudo é marca, nada é.
 *
 * As barras são `aria-hidden` e não fazem parte do texto acessível: para quem
 * ouve a tela, "barra barra pipeline" é ruído. O leitor recebe "pipeline".
 */
export interface MonoLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** O texto do rótulo. Sai em minúsculas — é assim que o site escreve. */
  children: React.ReactNode;
  /** Renderiza sem o prefixo `//` (raro: quando já há um no mesmo bloco). */
  bare?: boolean;
}

export function MonoLabel({
  children,
  bare = false,
  className,
  ...props
}: MonoLabelProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-xs font-medium lowercase",
        "tracking-[0.02em] text-text-muted",
        className,
      )}
      {...props}
    >
      {!bare && (
        <span aria-hidden className="text-accent">
          //
        </span>
      )}
      {children}
    </span>
  );
}
