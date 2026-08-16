"use client";
import * as React from "react";

import { cn } from "@/lib/utils";

interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /**
   * "Alguns, não todos" — o traço do header de tabela. É propriedade de DOM,
   * não atributo, por isso entra via efeito e não direto no JSX.
   */
  indeterminate?: boolean;
}

/**
 * Checkbox custom sobre `<input>` nativo (sem Radix: a dependência não existe
 * no projeto e um input estilizado cobre tudo que a tabela precisa, incluindo
 * teclado e leitores de tela de graça).
 *
 * O input É a caixa (`appearance-none` + borda + fundo). O check e o traço são
 * irmãos DEPOIS do input, ligados por `peer-checked`/`peer-indeterminate` —
 * dentro do input não pode haver filhos, e como irmãos o CSS alcança os dois
 * estados sem JavaScript.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);

    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)}>
        <input
          ref={inner}
          type="checkbox"
          className={cn(
            "peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-sm",
            "border border-border-strong bg-surface transition-colors duration-fast",
            "checked:border-accent checked:bg-accent",
            "indeterminate:border-accent indeterminate:bg-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          {...props}
        />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto hidden h-3 w-3 text-accent-fg peer-checked:block"
        >
          <path d="m5 12 4 4L19 6" />
        </svg>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto hidden h-0.5 w-2 rounded-full bg-accent-fg peer-indeterminate:block"
        />
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
