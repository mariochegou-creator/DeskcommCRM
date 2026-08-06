#!/usr/bin/env node
/**
 * "O que eu vi no localhost é o que está no ar?" — em um comando.
 *
 *   pnpm versao
 *
 * Compara os TRÊS lugares onde o código pode estar, na ordem em que ele viaja:
 *
 *   1. sua máquina  — o working tree (o que o localhost serve)
 *   2. GitHub       — o branch nexo-ia (o que a VPS consegue puxar)
 *   3. VPS          — o commit que virou a imagem no ar (lido do /api/v1/health)
 *
 * Cada elo só pode conter o que o anterior já tem. Mudança não commitada não
 * está no GitHub; commit não pushado não chega na VPS. O script diz em qual elo
 * a corrente arrebentou e o que fazer, em vez de só imprimir três hashes.
 *
 * Só LÊ. Não commita, não faz push, não toca na VPS.
 */

import { execFileSync } from "node:child_process";

const DOMINIO = process.env.CRM_URL ?? "https://crm.nexoialocal.com.br";
const BRANCH = process.env.CRM_BRANCH ?? "nexo-ia";
const REMOTO = process.env.CRM_REMOTE ?? "nexo";

const cor = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  alerta: (s) => `\x1b[33m${s}\x1b[0m`,
  erro: (s) => `\x1b[31m${s}\x1b[0m`,
  fraco: (s) => `\x1b[2m${s}\x1b[0m`,
  forte: (s) => `\x1b[1m${s}\x1b[0m`,
};

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    }).trim();
  } catch {
    return null;
  }
}

/** O que a sua máquina tem. */
function lerLocal() {
  const commit = git(["rev-parse", "--short=7", "HEAD"]);
  if (!commit) return null;
  const sujo = git(["status", "--porcelain"]);
  const arquivos = sujo ? sujo.split("\n").filter(Boolean) : [];
  return {
    commit,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "?",
    limpo: arquivos.length === 0,
    arquivos,
  };
}

/**
 * O que o GitHub tem. `ls-remote` pergunta ao servidor sem baixar nada e sem
 * mexer no working tree — de propósito: um `fetch` aqui mudaria o estado do
 * repo durante um comando que promete só ler.
 */
function lerGitHub() {
  const linha = git(["ls-remote", REMOTO, `refs/heads/${BRANCH}`]);
  if (!linha) return null;
  const sha = linha.split(/\s+/)[0];
  return sha ? { commit: sha.slice(0, 7) } : null;
}

/** O que está no ar. */
async function lerVPS() {
  try {
    const res = await fetch(`${DOMINIO}/api/v1/health`, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });
    // 503 é resposta VÁLIDA aqui: o app respondeu (logo, sei a versão dele) e
    // só sinalizou que uma dependência caiu. Tratar como falha esconderia
    // justamente a informação que vim buscar.
    const corpo = await res.json();
    const codigo = corpo?.data?.codigo;
    if (!codigo) {
      return { antigo: true, saude: corpo?.data?.status ?? "?" };
    }
    return { ...codigo, saude: corpo?.data?.status ?? "?" };
  } catch (err) {
    return { erro: err instanceof Error ? err.message : String(err) };
  }
}

async function principal() {
  const local = lerLocal();
  if (!local) {
    console.error(cor.erro("Não consegui ler o git daqui. Está no diretório do CRM?"));
    process.exit(1);
  }

  console.log(`\n${cor.forte("De onde o código sai até chegar no ar")}\n`);

  const marcaLocal = local.limpo ? cor.ok("✓") : cor.alerta("!");
  console.log(`${marcaLocal} sua máquina   ${cor.forte(local.commit)}  ${cor.fraco(`branch ${local.branch}`)}`);
  if (!local.limpo) {
    const amostra = local.arquivos.slice(0, 5).map((l) => `      ${l}`).join("\n");
    const resto = local.arquivos.length > 5 ? `\n      ${cor.fraco(`... e mais ${local.arquivos.length - 5}`)}` : "";
    console.log(cor.alerta(`      ${local.arquivos.length} arquivo(s) sem commit — só existem AQUI:`));
    console.log(cor.fraco(amostra + resto));
  }

  const github = lerGitHub();
  if (!github) {
    console.log(`${cor.erro("✗")} GitHub        ${cor.fraco(`não consegui falar com o remoto "${REMOTO}"`)}`);
  } else {
    const igual = github.commit === local.commit;
    console.log(
      `${igual ? cor.ok("✓") : cor.alerta("!")} GitHub        ${cor.forte(github.commit)}  ${cor.fraco(`${REMOTO}/${BRANCH}`)}`,
    );
  }

  const vps = await lerVPS();
  if (vps.erro) {
    console.log(`${cor.erro("✗")} no ar         ${cor.fraco(vps.erro)}`);
  } else if (vps.antigo) {
    console.log(`${cor.alerta("!")} no ar         ${cor.fraco("versão antiga: não sabe dizer qual commit está rodando")}`);
  } else {
    const igual = vps.commit === local.commit;
    console.log(
      `${igual ? cor.ok("✓") : cor.alerta("!")} no ar         ${cor.forte(vps.commit)}  ${cor.fraco(`${DOMINIO} · ${vps.saude}`)}`,
    );
  }

  // --- veredito: onde a corrente arrebentou, e só isso ---
  console.log("");
  const passos = [];
  if (!local.limpo) {
    passos.push("commitar o que está solto:  git add -A && git commit -m \"...\"");
  }
  if (github && github.commit !== local.commit) {
    passos.push(`mandar pro GitHub:          git push ${REMOTO} ${local.branch}`);
  }
  if (!vps.erro && !vps.antigo && vps.commit !== local.commit) {
    passos.push("publicar na VPS:            docs/deploy-nexo/PUBLICAR.md");
  }
  if (vps.antigo) {
    passos.push("publicar na VPS uma vez pra ela passar a se identificar: docs/deploy-nexo/PUBLICAR.md");
  }

  if (passos.length === 0 && local.limpo) {
    console.log(cor.ok("Tudo igual. O que você vê no localhost é o que está no ar."));
  } else {
    console.log(cor.forte("Para ficarem iguais, nesta ordem:"));
    for (const [i, p] of passos.entries()) console.log(`  ${i + 1}. ${p}`);
  }
  console.log("");
}

principal().catch((err) => {
  console.error(cor.erro(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
