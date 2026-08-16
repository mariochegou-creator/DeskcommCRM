import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { branding } from "@/lib/branding";
import { ThemeProvider } from "@/lib/theme";
import { Providers } from "./providers";
import { PublicEnvScript } from "./public-env-script";
import "./globals.css";

/**
 * As DUAS fontes do nexoialocal.com.br, na mesma combinação que o site serve:
 *   <link href="…family=Inter:wght@300..900&family=JetBrains+Mono:wght@400..600">
 *
 * Inter carrega até o 800 porque ela é corpo E display — o site não usa Space
 * Grotesk (nem nenhuma outra de display), então título de página e valor de KPI
 * saem do próprio Inter em peso alto. Sem o 800 aqui o navegador sintetizaria
 * um bold falso e o KPI ficaria borrado.
 *
 * `variable` (e não `className` direto) porque o Tailwind lê estas duas via
 * `fontFamily.sans`/`.mono` em tailwind.config.ts.
 */
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
});

/**
 * Metadata dinâmica (não `export const metadata`) para a marca ser lida em RUNTIME.
 * Constante seria resolvida durante o `next build`, e a imagem self-host — que é
 * pré-buildada — carregaria a nossa marca para sempre. Ver `lib/branding.ts`.
 *
 * O `template` é o que faz a marca existir em UM lugar só: as páginas filhas
 * declaram apenas o próprio nome ("Entrar") e herdam o sufixo daqui.
 */
export function generateMetadata(): Metadata {
  const { name, logoUrl } = branding();
  return {
    // Ícone da aba. Sem isto o navegador desenha o globo genérico. Quem
    // white-labela a instalação (APP_LOGO_URL) recebe o próprio logo aqui
    // também — pelo mesmo motivo do nome: a marca dele não pode depender de
    // editar código. Ver lib/branding.ts.
    icons: { icon: logoUrl ?? "/icon.svg", apple: logoUrl ?? "/icon.svg" },
    title: {
      default: `${name} — atendimento e vendas por WhatsApp com agentes de IA`,
      template: `%s · ${name}`,
    },
    description:
      "Centralize o atendimento por WhatsApp num funil só. Agentes de IA resolvem o que dá pra resolver e passam para o time humano o que importa — com tudo registrado. Multi-tenant, LGPD-nativo, feito para operações brasileiras.",
    applicationName: name,
    authors: [{ name }],
    keywords: [
      "CRM",
      "atendimento",
      "WhatsApp",
      "IA conversacional",
      "LGPD",
      "multi-tenant",
    ],
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
    { media: "(prefers-color-scheme: dark)", color: "#17181a" },
  ],
};

/**
 * Inline FOUC-prevention. Conteúdo é string literal estática (zero input do
 * usuário), portanto seguro. Lê localStorage + prefers-color-scheme antes do
 * primeiro paint.
 *
 * O CLARO É O PADRÃO — é o tema do redesign 2026-08 (a chave de storage é a
 * `deskcomm-theme-v2` de `lib/theme.tsx`: a antiga guardava `dark` para todo
 * mundo e esconderia o visual novo). A regra tem três ramos e ela precisa ser
 * LETRA POR LETRA a de `readStoredTheme`/`getSystemTheme` em `lib/theme.tsx` e
 * a do `data-theme` do <html> abaixo: divergir entre os três produz um flash
 * do tema errado, que é justamente o que este script existe para impedir.
 *   1. NADA salvo          → claro (o produto decide, não o SO);
 *   2. 'light' ou 'dark'   → o que a pessoa escolheu, sempre;
 *   3. 'system' explícito  → o SO, porque aí a escolha FOI seguir o SO.
 * No `catch` (localStorage bloqueado) o fallback é claro, não escuro.
 */
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('deskcomm-theme-v2');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(s==='light'||s==='dark')?s:(s==='system'?(d?'dark':'light'):'light');document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      data-theme="light"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Config pública do Supabase em runtime (imagem genérica self-host). */}
        <PublicEnvScript />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-sans text-text antialiased">
        <Providers>
          <ThemeProvider>{children}</ThemeProvider>
          <Toaster
            position="top-right"
            richColors
            closeButton
            duration={4000}
          />
        </Providers>
      </body>
    </html>
  );
}
