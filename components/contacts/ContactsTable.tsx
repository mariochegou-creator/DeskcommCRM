"use client";
import Link from "next/link";
import { formatRelative } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChipsDeTag } from "@/components/tags/ChipsDeTag";
import type { Contact } from "@/lib/types/contacts";

interface Props {
  contacts: Contact[];
}

function displayName(c: Contact): string {
  return c.display_name?.trim() || c.name?.trim() || "—";
}

export function ContactsTable({ contacts }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nome</TableHead>
          {/* No celular sobram Nome, Telefone e Status: é com isso que se
              reconhece e liga. O resto volta a partir de `md`. */}
          <TableHead className="hidden md:table-cell">Email</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead className="hidden lg:table-cell">Tags</TableHead>
          <TableHead className="hidden md:table-cell">Última atividade</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((c) => (
          <TableRow key={c.id} className="cursor-pointer">
            <TableCell className="font-medium">
              <Link href={`/app/contacts/${c.id}`} className="hover:underline">
                {displayName(c)}
              </Link>
            </TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">
              {c.email ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {c.phone_number ?? "—"}
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              {/* ChipsDeTag no lugar do Badge cru: a mesma cor do catálogo
                  que o inbox e o kanban já usam — aqui era o único lugar em
                  que a tag saía sem a cor configurada. */}
              <div className="flex flex-wrap items-center gap-1">
                {c.tags.length === 0 ? (
                  <span className="text-muted-foreground text-xs">—</span>
                ) : (
                  <ChipsDeTag nomes={c.tags} max={3} tamanho="sm" />
                )}
              </div>
            </TableCell>
            <TableCell className="hidden text-muted-foreground text-sm md:table-cell">
              {c.last_activity_at
                ? formatRelative(new Date(c.last_activity_at), new Date(), { locale: ptBR })
                : "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.is_anonymized && <Badge variant="destructive">Anonimizado</Badge>}
                {c.is_blocked && <Badge variant="warning">Bloqueado</Badge>}
                {!c.is_anonymized && !c.is_blocked && (
                  <Badge variant="success">Ativo</Badge>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
