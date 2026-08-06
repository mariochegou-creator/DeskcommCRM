"use client";

/**
 * O dossiê de prospecção em pares rótulo → valor — o miolo compartilhado das
 * três telas do lead (página, gaveta do kanban, painel do inbox).
 *
 * Só o MIOLO: quem chama decide o invólucro (Card na página, <section> na
 * gaveta e no inbox) e decide não renderizar nada quando `extras` vem vazio —
 * dossiê é enriquecimento da prospecção, a ausência não informa nada e não
 * merece um bloco vazio. Uma cópia por tela divergiria na primeira mudança;
 * este arquivo existe pelo mesmo motivo de lib/leads/ganchos.ts.
 *
 * Valor longo (Dores) vira parágrafo com as quebras preservadas; URL vira
 * link. O resto é linha de rótulo à esquerda, valor à direita — a mesma
 * hierarquia do `Field` da página de detalhe.
 */
export function LeadExtrasList({
  extras,
  dense = false,
}: {
  extras: Array<[string, string]>;
  dense?: boolean;
}) {
  const texto = dense ? "text-xs" : "text-sm";
  return (
    <dl className="flex flex-col">
      {extras.map(([chave, valor]) => {
        const url = /^https?:\/\//i.test(valor);
        const longo = !url && (valor.includes("\n") || valor.length > 80);
        return (
          <div
            key={chave}
            className={
              longo
                ? "flex flex-col gap-1 border-b border-border py-2 last:border-0"
                : "flex items-start justify-between gap-4 border-b border-border py-2 last:border-0"
            }
          >
            <dt className="shrink-0 text-xs text-text-muted">{chave}</dt>
            <dd
              className={
                longo
                  ? `whitespace-pre-line break-words ${texto} leading-relaxed text-text`
                  : `min-w-0 break-words text-right ${texto} text-text`
              }
            >
              {url ? (
                <a
                  href={valor}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all underline underline-offset-2 hover:text-text-muted"
                >
                  {valor}
                </a>
              ) : (
                valor
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
