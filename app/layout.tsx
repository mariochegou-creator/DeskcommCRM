import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { branding } from "@/lib/branding";
import { ThemeProvider } from "@/lib/theme";
import { Providers } from "./providers";
import { PublicEnvScript } from "./public-env-script";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-atkinson",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
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
  const { name } = branding();
  return {
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
    { media: "(prefers-color-scheme: light)", color: "#eef3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#050e1f" },
  ],
};

/**
 * Inline FOUC-prevention. Conteúdo é string literal estática (zero input do
 * usuário), portanto seguro. Lê localStorage + prefers-color-scheme antes do
 * primeiro paint.
 *
 * O ESCURO É O PADRÃO — é o tema da identidade da Nexo IA. A regra tem três
 * ramos e ela precisa ser LETRA POR LETRA a de `readStoredTheme`/`getSystemTheme`
 * em `lib/theme.tsx` e a do `data-theme` do <html> abaixo: divergir entre os
 * três produz um flash do tema errado, que é justamente o que este script
 * existe para impedir.
 *   1. NADA salvo          → escuro (a marca decide, não o SO);
 *   2. 'light' ou 'dark'   → o que a pessoa escolheu, sempre;
 *   3. 'system' explícito  → o SO, porque aí a escolha FOI seguir o SO.
 * No `catch` (localStorage bloqueado) o fallback é escuro, não claro.
 */
const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('deskcomm-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(s==='light'||s==='dark')?s:(s==='system'?(d?'dark':'light'):'dark');document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      suppressHydrationWarning
      className={`${atkinson.variable} ${plexMono.variable}`}
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
