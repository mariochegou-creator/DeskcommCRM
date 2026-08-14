import type { Config } from "tailwindcss";

const config: Config = {
  // Strategy: attribute selector to allow runtime swap via <html data-theme="dark">.
  darkMode: ["class", "[data-theme='dark']"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // Foundation
        bg: "var(--color-bg)",
        surface: {
          DEFAULT: "var(--color-surface)",
          elevated: "var(--color-surface-elevated)",
        },
        overlay: "var(--color-overlay)",
        text: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-text-muted)",
          subtle: "var(--color-text-subtle)",
        },

        // Accent — Sage scale
        accent: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-accent-fg)",
          // Par secundário PARA USO SOBRE O ACCENT sólido (card de destaque).
          // Não confundir com `text-muted`: aquele é calibrado contra o navy.
          "foreground-muted": "var(--color-accent-fg-muted)",
          "foreground-soft": "var(--color-accent-fg-soft)",
          soft: "var(--color-accent-soft)",
          hover: "var(--color-accent-hover)",
          50: "var(--color-accent-50)",
          100: "var(--color-accent-100)",
          200: "var(--color-accent-200)",
          300: "var(--color-accent-300)",
          400: "var(--color-accent-400)",
          500: "var(--color-accent-500)",
          600: "var(--color-accent-600)",
          700: "var(--color-accent-700)",
          800: "var(--color-accent-800)",
          900: "var(--color-accent-900)",
          950: "var(--color-accent-950)",
        },

        // Neutrals — greige
        neutral: {
          50: "var(--color-neutral-50)",
          100: "var(--color-neutral-100)",
          200: "var(--color-neutral-200)",
          300: "var(--color-neutral-300)",
          400: "var(--color-neutral-400)",
          500: "var(--color-neutral-500)",
          600: "var(--color-neutral-600)",
          700: "var(--color-neutral-700)",
          800: "var(--color-neutral-800)",
          900: "var(--color-neutral-900)",
          950: "var(--color-neutral-950)",
        },

        // States
        success: {
          DEFAULT: "var(--color-success)",
          bg: "var(--color-success-bg)",
          fg: "var(--color-success-fg)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          bg: "var(--color-warning-bg)",
          fg: "var(--color-warning-fg)",
        },
        error: {
          DEFAULT: "var(--color-error)",
          bg: "var(--color-error-bg)",
          fg: "var(--color-error-fg)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          bg: "var(--color-info-bg)",
          fg: "var(--color-info-fg)",
        },

        // shadcn aliases (compat com componentes ainda não migrados)
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
        input: "var(--color-border)",
        ring: "var(--color-accent-500)",
        background: "var(--color-bg)",
        foreground: "var(--color-text)",
        primary: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-accent-fg)",
        },
        secondary: {
          DEFAULT: "var(--color-surface-elevated)",
          foreground: "var(--color-text)",
        },
        destructive: {
          DEFAULT: "var(--color-error)",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "var(--color-surface-elevated)",
          foreground: "var(--color-text-muted)",
        },
        popover: {
          DEFAULT: "var(--color-surface)",
          foreground: "var(--color-text)",
        },
        card: {
          DEFAULT: "var(--color-surface)",
          foreground: "var(--color-text)",
        },

        // Séries de gráfico — ordem fixa (ciano, azul, âmbar, vermelho, verde).
        // A MESMA série mantém a MESMA cor ao alternar tema; só o stop muda.
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
          grid: "var(--chart-grid)",
        },

        // Etapas do funil — pill da tabela e header do card de resumo leem
        // daqui, então a cor de uma etapa é uma decisão só.
        stage: {
          entrada: "var(--stage-entrada)",
          r1: "var(--stage-r1)",
          proposta: "var(--stage-proposta)",
          fechado: "var(--stage-fechado)",
          perdido: "var(--stage-perdido)",
        },

        // Tags do cliente (0105) — paleta fechada, escolhida em Configurações.
        // Mesma decisão do `stage`: a cor de uma tag é uma decisão só, lida por
        // três telas (Configurações, card do Kanban, lista do inbox).
        tag: {
          cinza: "var(--tag-cinza)",
          azul: "var(--tag-azul)",
          ciano: "var(--tag-ciano)",
          verde: "var(--tag-verde)",
          ambar: "var(--tag-ambar)",
          vermelho: "var(--tag-vermelho)",
          roxo: "var(--tag-roxo)",
          rosa: "var(--tag-rosa)",
        },
      },
      fontFamily: {
        // Inter e JetBrains Mono são as duas fontes servidas por
        // nexoialocal.com.br. `display` aponta para a MESMA família de
        // propósito: o site não carrega fonte de display separada, então
        // título e KPI se distinguem por PESO (800) e tracking, não por
        // família. O alias existe para o dia em que houver uma — aí muda aqui,
        // num lugar só, em vez de em cada `<h1>`.
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      spacing: {
        0: "var(--space-0)",
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        8: "var(--space-8)",
        10: "var(--space-10)",
        12: "var(--space-12)",
        16: "var(--space-16)",
        20: "var(--space-20)",
        24: "var(--space-24)",
        32: "var(--space-32)",
      },
      borderRadius: {
        none: "var(--radius-none)",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        // Papéis semânticos do redesign — preferir estes a `lg`/`xl` em
        // superfície nova. Ver a nota no bloco Radius de app/globals.css.
        card: "var(--radius-card)",
        control: "var(--radius-control)",
        pill: "var(--radius-pill)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        // Glow ciano/laranja do guia da Nexo IA — para botão primário e métrica
        // de alerta. Atenuado no tema claro (ver app/globals.css).
        glow: "var(--shadow-glow)",
        "glow-warning": "var(--shadow-glow-warning)",
        none: "none",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      zIndex: {
        base: "0",
        raised: "10",
        dropdown: "20",
        sticky: "30",
        modal: "40",
        toast: "50",
      },
    },
  },
  plugins: [],
};

export default config;
