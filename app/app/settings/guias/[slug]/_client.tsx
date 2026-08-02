"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowRight, CaretLeft, ListBullets, MagnifyingGlass } from "@/lib/ui/icons";
import type { Block, Guide, GuideSection, Inline } from "@/lib/guides";
import { normalizeForSearch } from "@/lib/guides/markdown";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ inline */

function InlineText({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((node, index) => {
        switch (node.kind) {
          case "strong":
            return (
              <strong key={index} className="font-semibold text-text">
                {node.text}
              </strong>
            );
          case "code":
            return (
              <code
                key={index}
                className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[0.85em] text-text"
              >
                {node.text}
              </code>
            );
          case "link":
            // Link interno navega no app; externo abre fora e avisa o leitor de tela.
            return node.href.startsWith("/") ? (
              <Link key={index} href={node.href} className="text-accent underline-offset-2 hover:underline">
                {node.text}
              </Link>
            ) : (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                {node.text}
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            );
          default:
            return <span key={index}>{node.text}</span>;
        }
      })}
    </>
  );
}

/* ------------------------------------------------------------------- blocos */

const ALIGN_CLASS = { left: "text-left", center: "text-center", right: "text-right" } as const;

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      // h1/h2 já viraram cabeçalho de seção; aqui só sobra h3.
      return (
        <h3 id={block.id} className="scroll-mt-24 pt-2 text-sm font-semibold text-text">
          {block.text}
        </h3>
      );

    case "paragraph":
      return (
        <p className="max-w-[72ch] text-sm leading-relaxed text-text-muted">
          <InlineText content={block.content} />
        </p>
      );

    case "list":
      return block.ordered ? (
        <ol className="max-w-[72ch] space-y-2">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-sm leading-relaxed text-text-muted">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold tabular-nums text-accent">
                {index + 1}
              </span>
              <span>
                <InlineText content={item} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="max-w-[72ch] space-y-1.5">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 text-sm leading-relaxed text-text-muted">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>
                <InlineText content={item} />
              </span>
            </li>
          ))}
        </ul>
      );

    case "table":
      // A rolagem horizontal fica DENTRO do contêiner: a página nunca rola de lado,
      // nem com a matriz de permissões (5 colunas) em 320px.
      return (
        <div className="w-full overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {block.head.map((cell, index) => (
                  <TableHead
                    key={index}
                    scope="col"
                    className={cn("whitespace-nowrap", ALIGN_CLASS[block.align[index] ?? "left"])}
                  >
                    <InlineText content={cell} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell
                      key={cellIndex}
                      className={cn(
                        "align-top text-sm",
                        ALIGN_CLASS[block.align[cellIndex] ?? "left"],
                        cellIndex === 0 && "font-medium text-text",
                      )}
                    >
                      <InlineText content={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );

    case "quote":
      return (
        <div className="max-w-[72ch] rounded-md border-l-2 border-accent bg-accent-soft/40 px-4 py-3">
          {block.content.map((paragraph, index) => (
            <p key={index} className="text-sm leading-relaxed text-text">
              <InlineText content={paragraph} />
            </p>
          ))}
        </div>
      );

    case "code":
      return (
        <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-surface-elevated p-3">
          <code className="font-mono text-xs leading-relaxed text-text">{block.text}</code>
        </pre>
      );

    case "divider":
      return null;
  }
}

/* ------------------------------------------------------------------- seções */

function SectionView({ section }: { section: GuideSection }) {
  const isPart = section.level === 1;

  return (
    <section id={section.id} className="scroll-mt-20">
      {isPart ? (
        <div className="mb-2 mt-8 flex items-center gap-3 border-t border-border pt-8 first:mt-0 first:border-0 first:pt-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">
            {section.title}
          </h2>
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
      ) : (
        <h2 className="mb-3 mt-6 text-lg font-semibold tracking-tight text-text">{section.title}</h2>
      )}
      <div className="space-y-3">
        {section.blocks.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- tela */

export function GuideReader({ guide }: { guide: Guide }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(guide.sections[0]?.id ?? "");
  const [indexOpen, setIndexOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const needle = normalizeForSearch(query.trim());

  const sections = useMemo(() => {
    if (needle.length < 2) return guide.sections;
    // Uma parte (h1) só permanece se alguma seção dela sobreviveu ao filtro —
    // senão o índice ficaria cheio de cabeçalho sem conteúdo embaixo.
    const matched = guide.sections.filter(
      (section) => section.level === 1 || section.searchText.includes(needle),
    );
    return matched.filter((section, index) => {
      if (section.level !== 1) return true;
      const next = matched[index + 1];
      return Boolean(next && next.level !== 1);
    });
  }, [guide.sections, needle]);

  const isFiltering = needle.length >= 2;

  // Destaque do índice conforme a rolagem. rootMargin recorta a faixa de decisão
  // para o topo da área de leitura: sem isso, a seção "ativa" seria sempre a que
  // está saindo por baixo da tela.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>("section[id]"));
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-border p-6 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/app/settings/guias"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-text"
          >
            <CaretLeft size={12} aria-hidden />
            Guias
          </Link>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{guide.title}</h1>
          <Badge variant="neutral">{guide.minutes} min</Badge>
        </div>

        {guide.intro[0] && (
          <p className="max-w-[72ch] text-sm text-muted-foreground">
            <InlineText content={guide.intro[0]} />
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <MagnifyingGlass
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar no guia (ex.: publicar agente, soneca, LGPD)"
              aria-label="Buscar no guia"
              className="pl-8"
            />
          </div>
          <button
            type="button"
            onClick={() => setIndexOpen((open) => !open)}
            aria-expanded={indexOpen}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-text lg:hidden"
          >
            <ListBullets size={14} aria-hidden />
            Índice
          </button>
          {isFiltering && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {sections.filter((section) => section.level !== 1).length} seção(ões)
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 overflow-hidden p-6 pt-4">
        {/* Índice: coluna fixa no desktop, gaveta empilhada no mobile. */}
        <nav
          aria-label="Índice do guia"
          className={cn(
            "w-64 shrink-0 overflow-y-auto pr-2 lg:block",
            indexOpen ? "block" : "hidden",
          )}
        >
          <ol className="space-y-0.5">
            {sections.map((section) =>
              section.level === 1 ? (
                <li
                  key={section.id}
                  className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {section.title}
                </li>
              ) : (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    onClick={() => setIndexOpen(false)}
                    aria-current={activeId === section.id ? "location" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-xs leading-snug transition-colors",
                      activeId === section.id
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-muted-foreground hover:bg-surface-elevated hover:text-text",
                    )}
                  >
                    {section.title}
                  </a>
                </li>
              ),
            )}
          </ol>
        </nav>

        <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto pb-24">
          {sections.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nada encontrado para <strong className="text-text">{query}</strong>.
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                Limpar a busca
                <ArrowRight size={12} aria-hidden />
              </button>
            </div>
          ) : (
            sections.map((section) => <SectionView key={section.id} section={section} />)
          )}
        </div>
      </div>
    </div>
  );
}
