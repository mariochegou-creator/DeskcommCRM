"use client";
import { useMemo, useState } from "react";

import { ListaDeTarefas } from "@/components/tarefas/ListaDeTarefas";
import { TarefaDialog } from "@/components/tarefas/TarefaDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonoLabel } from "@/components/ui/mono-label";
import { StatCard } from "@/components/ui/stat-card";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useTarefas, type FiltroDeStatus, type Tarefa } from "@/hooks/tarefas/useTarefas";
import type { EscopoDeTarefa } from "@/lib/schemas/tarefas";
import { estadoDoPrazo, mesmoDia } from "@/lib/tarefas/tarefa";
import { cn } from "@/lib/utils";

const ESCOPOS: Array<{ id: EscopoDeTarefa; rotulo: string; ajuda: string }> = [
  { id: "minhas", rotulo: "Minhas", ajuda: "o que eu tenho de fazer" },
  { id: "criadas", rotulo: "Que eu pedi", ajuda: "o que eu combinei com alguém" },
  { id: "equipe", rotulo: "Da equipe", ajuda: "tudo que está combinado na organização" },
];

const STATUS: Array<{ id: FiltroDeStatus; rotulo: string }> = [
  { id: "abertas", rotulo: "Abertas" },
  { id: "feitas", rotulo: "Resolvidas" },
];

function Chip({
  ativo,
  children,
  onClick,
}: {
  ativo: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "rounded-pill border px-3 py-1 text-xs transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
        ativo
          ? "border-transparent bg-accent text-accent-foreground"
          : "border-border text-text-muted hover:border-border-strong hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A aba Tarefas.
 *
 * Três recortes, e o do meio é o que justifica a tela existir: "que eu pedi"
 * é a única vista que responde se o combinado com a outra pessoa aconteceu.
 * Sem ela, quem delega descobre que a ligação não foi feita pelo silêncio do
 * lead — que é tarde.
 *
 * Os grupos são por PRAZO, não por tipo nem por lead: a pergunta ao abrir esta
 * tela é sempre "o que está estourando", e ordenar por qualquer outra coisa
 * esconde a resposta atrás de uma rolagem.
 */
export function TarefasClient() {
  const [escopo, setEscopo] = useState<EscopoDeTarefa>("minhas");
  const [status, setStatus] = useState<FiltroDeStatus>("abertas");
  const [novaAberta, setNovaAberta] = useState(false);

  const membros = useAssignableMembers(true);
  const lista = useTarefas({ escopo, status });

  // Um instante para a tela inteira: os contadores e as etiquetas de prazo têm
  // de concordar sobre onde está a virada do dia (mesma regra do Painel).
  const agora = useMemo(() => new Date(), []);

  const tarefas = useMemo(() => lista.data ?? [], [lista.data]);

  const grupos = useMemo(() => {
    const atrasadas: Tarefa[] = [];
    const hoje: Tarefa[] = [];
    const proximas: Tarefa[] = [];
    const resolvidas: Tarefa[] = [];

    for (const t of tarefas) {
      if (t.status !== "pending") {
        resolvidas.push(t);
        continue;
      }
      const prazo = new Date(t.due_at);
      const estado = estadoDoPrazo(prazo, agora);
      if (estado === "atrasada") atrasadas.push(t);
      else if (estado === "agora" || mesmoDia(prazo, agora)) hoje.push(t);
      else proximas.push(t);
    }
    return { atrasadas, hoje, proximas, resolvidas };
  }, [tarefas, agora]);

  const carregando = lista.isLoading;
  const erro = lista.isError;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <MonoLabel>tarefas</MonoLabel>
          <p className="text-xs text-text-subtle">
            O que foi combinado com cada lead — com dono, hora e o recado junto.
          </p>
        </div>
        <Button onClick={() => setNovaAberta(true)}>Nova tarefa</Button>
      </div>

      {status === "abertas" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Atrasadas"
            value={carregando ? "—" : grupos.atrasadas.length.toLocaleString("pt-BR")}
            hint="o prazo já passou e ninguém resolveu"
          />
          <StatCard
            label="Para hoje"
            value={carregando ? "—" : grupos.hoje.length.toLocaleString("pt-BR")}
            hint="vencem ainda hoje"
          />
          <StatCard
            label="Próximas"
            value={carregando ? "—" : grupos.proximas.length.toLocaleString("pt-BR")}
            hint="combinadas para depois de hoje"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {ESCOPOS.map((e) => (
            <Chip key={e.id} ativo={escopo === e.id} onClick={() => setEscopo(e.id)}>
              {e.rotulo}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS.map((s) => (
            <Chip key={s.id} ativo={status === s.id} onClick={() => setStatus(s.id)}>
              {s.rotulo}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-text-subtle">
          {ESCOPOS.find((e) => e.id === escopo)?.ajuda}
        </p>
      </div>

      {status === "feitas" ? (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-semibold text-text">Resolvidas</h2>
          <ListaDeTarefas
            tarefas={grupos.resolvidas}
            carregando={carregando}
            erro={erro}
            membros={membros.data ?? []}
            agora={agora}
            vazio="Nada resolvido ainda neste recorte."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Secao
            titulo="Atrasadas"
            tarefas={grupos.atrasadas}
            carregando={carregando}
            erro={erro}
            membros={membros.data ?? []}
            agora={agora}
            vazio="Nada atrasado. "
            destaque
          />
          <Secao
            titulo="Hoje"
            tarefas={grupos.hoje}
            carregando={carregando}
            erro={erro}
            membros={membros.data ?? []}
            agora={agora}
            vazio="Nada marcado para hoje."
          />
          <Secao
            titulo="Próximas"
            tarefas={grupos.proximas}
            carregando={carregando}
            erro={erro}
            membros={membros.data ?? []}
            agora={agora}
            vazio="Nada combinado para depois de hoje."
          />
        </div>
      )}

      <TarefaDialog open={novaAberta} onOpenChange={setNovaAberta} />
    </div>
  );
}

function Secao({
  titulo,
  tarefas,
  carregando,
  erro,
  membros,
  agora,
  vazio,
  destaque = false,
}: {
  titulo: string;
  tarefas: Tarefa[];
  carregando: boolean;
  erro: boolean;
  membros: Array<{ user_id: string; role: string; full_name: string | null }>;
  agora: Date;
  vazio: string;
  destaque?: boolean;
}) {
  // Seção vazia continua na tela: sumir com "Atrasadas" quando não há atraso
  // faz a lista pular de lugar a cada conclusão, e o "nada atrasado" é uma
  // informação que a pessoa veio buscar.
  return (
    <Card className={cn("flex flex-col gap-3 p-5", destaque && tarefas.length > 0 && "border-destructive/40")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">{titulo}</h2>
        <span className="text-xs text-text-subtle">
          {carregando ? "…" : tarefas.length.toLocaleString("pt-BR")}
        </span>
      </div>
      <ListaDeTarefas
        tarefas={tarefas}
        carregando={carregando}
        erro={erro}
        membros={membros}
        agora={agora}
        vazio={vazio}
      />
    </Card>
  );
}
