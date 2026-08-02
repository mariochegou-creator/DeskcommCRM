# Guias in-app (Configurações › Guias)

Os arquivos `.md` desta pasta são a **fonte da verdade** dos guias que o CRM
publica em `/app/settings/guias`. Quem edita não precisa saber React: edita o
markdown e roda o gerador.

## Fluxo de edição

```bash
# 1. edite o guia
$EDITOR docs/guias/crm-completo.md

# 2. regenere o módulo que o app importa
pnpm guides:build

# 3. confira que nada quebrou (o teste falha se o guia virar casca)
pnpm vitest run tests/unit/guides-markdown.test.ts tests/unit/guide-reader.test.tsx
```

O passo 2 **não é opcional**: o app importa `lib/guides/content/generated.ts`, não
o `.md`. Editar o markdown e não regerar deixa a tela mostrando a versão antiga —
e nada avisa.

## Por que gerar em vez de ler o arquivo

`fs.readFileSync` num Server Component depende de o `.md` ser copiado para o
bundle de produção, e o `output: standalone` do Next só rastreia o que enxerga
estaticamente. O guia funcionaria em dev e sumiria em produção — o pior modo de
falha possível. Módulo gerado é importado como código: se está no build, está lá.

## Publicar um guia novo

1. Crie `docs/guias/<slug>.md`.
2. Adicione a entrada em `CATALOG`, no topo de `scripts/build-guides.mjs`
   (`slug`, `title`, `description`, `audience`, `minutes`).
   **Guia fora do catálogo não é publicado** — a decisão é explícita de propósito.
3. `pnpm guides:build`.

O hub (`/app/settings/guias`) lista sozinho o que estiver no catálogo.

## Markdown suportado

O renderizador é próprio (`lib/guides/markdown.ts`), sem dependência de runtime
nova. Suporta:

- `#`, `##`, `###` — `#` é o título do arquivo; `#` seguinte abre uma **parte** e
  `##` abre uma **seção** (os dois níveis do índice lateral). `###` fica dentro da
  seção.
- parágrafo, lista `-`, lista numerada
- tabela GFM **com linha de separação** (`|---|:--:|`) — sem ela não vira tabela
- citação `>` (logo abaixo do título vira a apresentação do guia)
- bloco de código cercado
- inline: `` `código` ``, `**negrito**`, `[texto](destino)` — destino começando
  com `/` navega dentro do app; o resto abre em nova aba

**Não suportado** (evite): HTML cru, imagem, lista aninhada, tabela sem
cabeçalho, ênfase com `_underline_`.

## Quem vê

Todo usuário autenticado, de `viewer` a `admin`. Guia é material de uso —
esconder o manual de quem só tem leitura seria entregar o carro sem o manual
porque a pessoa não dirige.
