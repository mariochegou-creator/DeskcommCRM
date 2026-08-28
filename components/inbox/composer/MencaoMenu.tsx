"use client";
import type { AssignableMember } from "@/hooks/inbox/useAssignableMembers";
import { contemBusca } from "@/lib/busca/termo";

/**
 * O menu que abre ao digitar `@` numa nota interna (0110). Irmão do
 * TemplateMenu — mesma caixa, mesma posição, mesmo comportamento de clique.
 *
 * Só vale em NOTA. Num `@` dentro da resposta ao cliente o menu seria ruído: o
 * cliente não é membro do time e não há ninguém para marcar.
 *
 * Quem não tem nome cadastrado não aparece: sem nome não há o que digitar
 * depois do `@`, e um item "Sem nome" na lista é um clique que grava uma
 * menção que ninguém consegue reproduzir escrevendo.
 */
export function filtrarMembros(membros: AssignableMember[], query: string): AssignableMember[] {
  return membros.filter((m) => m.full_name && contemBusca(query, m.full_name));
}

interface Props {
  open: boolean;
  query: string;
  membros: AssignableMember[];
  onPick: (m: AssignableMember) => void;
}

export function MencaoMenu({ open, query, membros, onPick }: Props) {
  if (!open) return null;
  const filtrados = filtrarMembros(membros, query);
  return (
    <div
      className="absolute bottom-14 left-3 z-20 max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
      role="listbox"
      aria-label="Marcar alguém do time"
    >
      {filtrados.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">Ninguém com esse nome.</div>
      ) : (
        filtrados.map((m) => (
          <button
            key={m.user_id}
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left hover:bg-muted"
            onClick={() => onPick(m)}
          >
            <span className="text-sm font-medium">{m.full_name}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{m.role}</span>
          </button>
        ))
      )}
    </div>
  );
}
