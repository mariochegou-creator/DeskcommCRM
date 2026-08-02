import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button — identidade Nexo IA.
 *
 * Forma: `rounded-control` (12px, o mesmo raio de botão do site) e altura 40px
 * no tamanho padrão. Sem sombra — no escuro os tokens `shadow-*` resolvem para
 * `none` (ver app/globals.css), então a separação vem da cor.
 *
 * O CIANO É ESCASSO. Só `primary` o usa preenchido, e ele é o único botão de
 * ação principal por tela; `secondary`/`outline`/`ghost` existem justamente
 * para que o resto não dispute com ele. Dois botões ciano lado a lado = um dos
 * dois está errado.
 *
 * Variants:
 *   - primary (default): fundo ciano, texto navy — a CTA da tela
 *   - secondary: surface-elevated com borda, ação neutra
 *   - ghost: transparente, para barra de ferramentas (ver nota no variant)
 *   - destructive: error fill (delete/cancel destrutivo)
 *   - outline: secondary com fundo transparente (compat shadcn)
 *   - link: texto ciano sem fundo
 *   - default: alias de primary (compat shadcn)
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-control font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform]",
    "duration-fast ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "active:translate-y-px",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-foreground hover:bg-accent-hover",
        default:
          "bg-accent text-accent-foreground hover:bg-accent-hover",
        secondary:
          "bg-surface-elevated text-text border border-border hover:border-border-strong",
        outline:
          "bg-transparent text-text border border-border hover:border-border-strong",
        // Hover em `surface-elevated`, não em `accent-soft`: ghost é o botão de
        // barra de ferramentas e aparece EM SÉRIE (⋯, ordenar, filtro, fechar).
        // Tingir cada um de ciano ao passar o mouse espalha o accent pela tela,
        // que é exatamente o que a regra do ciano escasso proíbe.
        ghost:
          "bg-transparent text-text-muted hover:bg-surface-elevated hover:text-text",
        destructive:
          "bg-error text-white hover:brightness-95",
        link:
          "bg-transparent text-accent underline underline-offset-4 decoration-1 hover:decoration-2 h-auto p-0",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-10 px-4 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-6 text-sm",
        icon: "h-10 w-10",
        // Ícone REDONDO — a "assinatura do layout": o ↗ no canto do card e os
        // controles da topbar. `rounded-pill` sobrescreve o `rounded-control`
        // da base porque aqui o círculo é o ponto, não o quadrado macio.
        "icon-round": "h-9 w-9 rounded-pill",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
