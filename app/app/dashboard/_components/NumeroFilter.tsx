"use client";
import { CaretDown, WhatsappLogo } from "@/lib/ui/icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SEM_CONVERSA, TODOS_OS_NUMEROS } from "@/lib/dashboard/numeros";
import type { NumeroDoPainel } from "@/hooks/metrics/useLeadChannels";

/**
 * "Todos os números" — o seletor de linha de WhatsApp do Painel.
 *
 * Mora ao lado do seletor de período e governa a MESMA metade da tela que ele:
 * os KPIs, as barras e o donut. A seção de prospecção lá embaixo agrega no
 * banco e continua somando todas as linhas (o DashboardClient avisa isso na
 * tela quando há filtro ligado) — mostrar o filtro sem avisar seria pior que
 * não ter filtro.
 *
 * Cada opção carrega a CONTAGEM ao lado. É o que transforma o seletor em
 * resposta: dá para comparar as linhas sem trocar de opção quatro vezes.
 */
interface Props {
  numeros: NumeroDoPainel[];
  semConversa: number;
  total: number;
  valor: string;
  onChange: (valor: string) => void;
}

export function NumeroFilter({ numeros, semConversa, total, valor, onChange }: Props) {
  const atual =
    valor === TODOS_OS_NUMEROS
      ? "Todos os números"
      : valor === SEM_CONVERSA
        ? "Ainda sem conversa"
        : (numeros.find((n) => n.id === valor)?.nome ?? "Todos os números");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="h-9 gap-2">
          <WhatsappLogo size={16} aria-hidden />
          <span className="max-w-[220px] truncate">{atual}</span>
          <CaretDown size={14} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[280px]">
        <Opcao
          rotulo="Todos os números"
          contagem={total}
          id={TODOS_OS_NUMEROS}
          valor={valor}
          onChange={onChange}
        />
        {numeros.map((n) => (
          <Opcao
            key={n.id}
            rotulo={n.nome}
            contagem={n.leads}
            id={n.id}
            valor={valor}
            onChange={onChange}
          />
        ))}
        {semConversa > 0 && (
          <Opcao
            rotulo="Ainda sem conversa"
            contagem={semConversa}
            id={SEM_CONVERSA}
            valor={valor}
            onChange={onChange}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Opcao({
  rotulo,
  contagem,
  id,
  valor,
  onChange,
}: {
  rotulo: string;
  contagem: number;
  id: string;
  valor: string;
  onChange: (valor: string) => void;
}) {
  return (
    <DropdownMenuItem onClick={() => onChange(id)} disabled={id === valor}>
      <span className="min-w-0 flex-1 truncate">{rotulo}</span>
      <span className="ml-3 shrink-0 text-xs text-text-subtle tabular">
        {contagem.toLocaleString("pt-BR")}
      </span>
    </DropdownMenuItem>
  );
}
