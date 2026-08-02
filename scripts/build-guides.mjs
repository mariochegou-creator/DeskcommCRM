#!/usr/bin/env node
/**
 * Gera `lib/guides/content/generated.ts` a partir de `docs/guias/*.md`.
 *
 * POR QUE GERAR EM VEZ DE LER O ARQUIVO EM RUNTIME: `fs.readFileSync` num Server
 * Component depende de o `.md` ser copiado para o bundle de produção — e o
 * `output: standalone` do Next só rastreia o que ele consegue enxergar
 * estaticamente. O guia sumiria em produção e apareceria em dev, que é o pior
 * modo de falha possível. Módulo gerado é importado como código: se está no
 * build, está lá.
 *
 * POR QUE NÃO COLAR O MARKDOWN À MÃO NUM `.ts`: o guia é cheio de crase (código
 * inline), e template literal exige escapar cada uma. Escapar à mão é erro
 * garantido; o gerador escapa sempre.
 *
 * Uso: `node scripts/build-guides.mjs` (roda de novo sempre que editar um guia).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "docs", "guias");
const outFile = join(root, "lib", "guides", "content", "generated.ts");

/** Metadados por arquivo. Guia sem entrada aqui não é publicado — decisão explícita. */
const CATALOG = {
  "crm-completo.md": {
    slug: "crm-completo",
    title: "Guia completo do CRM",
    description:
      "Do zero à operação com IA: a ideia, cada tela passo a passo, a rotina do dia a dia e os problemas comuns.",
    audience: "Todo o time",
    minutes: 45,
  },
};

function escapeForTemplate(text) {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const files = readdirSync(sourceDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort();

const entries = [];
for (const file of files) {
  const meta = CATALOG[file];
  if (!meta) {
    console.warn(`[build-guides] ignorado (fora do catálogo): ${file}`);
    continue;
  }
  const raw = readFileSync(join(sourceDir, file), "utf8");
  entries.push({ meta, source: raw, file });
}

if (entries.length === 0) {
  console.error("[build-guides] nenhum guia gerado — o catálogo está vazio?");
  process.exit(1);
}

const body = entries
  .map(
    ({ meta, source, file }) => `  {
    slug: ${JSON.stringify(meta.slug)},
    title: ${JSON.stringify(meta.title)},
    description: ${JSON.stringify(meta.description)},
    audience: ${JSON.stringify(meta.audience)},
    minutes: ${meta.minutes},
    sourceFile: ${JSON.stringify(`docs/guias/${basename(file)}`)},
    source: \`${escapeForTemplate(source)}\`,
  },`,
  )
  .join("\n");

const out = `// GERADO POR scripts/build-guides.mjs — NÃO EDITAR À MÃO.
// Fonte da verdade: docs/guias/*.md. Editou o guia? rode \`node scripts/build-guides.mjs\`.

export interface RawGuide {
  slug: string;
  title: string;
  description: string;
  audience: string;
  minutes: number;
  sourceFile: string;
  source: string;
}

export const RAW_GUIDES: RawGuide[] = [
${body}
];
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out, "utf8");
console.log(
  `[build-guides] ${entries.length} guia(s) → lib/guides/content/generated.ts (${(out.length / 1024).toFixed(1)} kB)`,
);
