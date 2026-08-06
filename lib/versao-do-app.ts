/**
 * Qual código está rodando AQUI.
 *
 * Existe para responder uma pergunta que não tinha resposta: "o que estou vendo
 * no domínio é o mesmo que vi no localhost?". Antes disso, os dois lugares eram
 * indistinguíveis por fora — o único jeito de saber era abrir a tela e procurar
 * a mudança a olho, o que falha exatamente quando a mudança é invisível (uma
 * regra de fluxo, um parser, um schema).
 *
 * Em PRODUÇÃO o valor vem de `APP_GIT_SHA`, gravado na imagem no build
 * (Dockerfile, estágio runner). Em DESENVOLVIMENTO não há build, então o commit
 * é lido do próprio .git — e aí entra a parte que importa mais:
 *
 * ⚠️ EM DEV, `limpo` DIZ MAIS QUE O SHA. O working tree quase sempre tem
 * mudança não commitada, e é justamente ela que NÃO EXISTE em lugar nenhum além
 * desta máquina. Um SHA igual dos dois lados com `limpo: false` de um lado não é
 * paridade: é o mesmo commit mais alterações que ninguém mais tem. Por isso os
 * dois campos andam juntos, e quem compara tem que olhar os dois.
 */
import { execFileSync } from "node:child_process";

export interface VersaoDoApp {
  /** Commit curto (7 chars) ou 'desconhecido' quando não dá para saber. */
  commit: string;
  /** Onde o valor foi obtido — 'imagem' (build) ou 'git' (dev). */
  origem: "imagem" | "git" | "desconhecida";
  /**
   * Só em dev: `false` = há mudança não commitada, então este código NÃO existe
   * no GitHub e não pode chegar à VPS. Em produção é sempre `true` (uma imagem
   * é, por construção, um estado congelado).
   */
  limpo: boolean;
}

/** Roda git sem herdar stdio (um repo ausente não pode poluir o log do servidor). */
function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim();
  } catch {
    return null; // sem git, sem repo, ou timeout: quem chama decide o fallback
  }
}

export function versaoDoApp(): VersaoDoApp {
  const carimbo = process.env.APP_GIT_SHA?.trim();
  if (carimbo && carimbo !== "desconhecido") {
    return { commit: carimbo.slice(0, 7), origem: "imagem", limpo: true };
  }

  // Sem carimbo: ou é dev (não houve build), ou alguém buildou sem passar o
  // --build-arg. Os dois casos caem no git; em produção ele não existe na
  // imagem e o resultado é 'desconhecido' — que é a resposta honesta.
  const commit = git(["rev-parse", "--short=7", "HEAD"]);
  if (!commit) return { commit: "desconhecido", origem: "desconhecida", limpo: false };

  // `--porcelain` vazio = nada modificado. Inclui arquivo novo não rastreado,
  // e isso é de propósito: um arquivo que só existe aqui é a diferença mais
  // fácil de esquecer.
  const sujo = git(["status", "--porcelain"]);
  return { commit, origem: "git", limpo: sujo === "" };
}
