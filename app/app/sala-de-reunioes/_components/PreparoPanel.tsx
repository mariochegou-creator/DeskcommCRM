"use client";
/**
 * O preparo de uma reunião MARCADA — o painel que abre ao clicar numa próxima.
 *
 * A ordem das seções é a ordem em que a cabeça pergunta, minutos antes da sala
 * abrir: (1) o que falta fazer, (2) o que o time já escreveu sobre este lead,
 * (3) o que ficou combinado como tarefa, (4) com que frase se abre a conversa,
 * (5) o que a prospecção levantou do negócio, (6) como foi a reunião anterior.
 *
 * Não repete a linha do tempo do negócio: ela existe inteira no dossiê do lead
 * e caberia mal aqui — este painel é lido em pé, e uma tela que rola sem fim é
 * uma tela que ninguém termina. No lugar dela vai um link para o negócio.
 */
import Link from "next/link";

import { LeadExtrasList } from "@/components/leads/LeadExtrasList";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePreparo,
  useToggleItemPreparo,
  type NotaDoPreparo,
  type Preparo,
  type ReuniaoAnterior,
  type TarefaDoPreparo,
} from "@/hooks/sala-reunioes/usePreparo";
import { ROTULO_DO_TIPO } from "@/lib/agendamento/reuniao";
import { whatsappLink } from "@/lib/contacts/whatsapp";
import { extractExtras, extractGanchos } from "@/lib/leads/ganchos";
import {
  montarChecklist,
  quandoDaReuniao,
  resumoDoChecklist,
  type ItemDoChecklist,
} from "@/lib/sala-reunioes/preparo";
import {
  MEETING_OUTCOME_LABELS,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
} from "@/lib/sala-reunioes/vocabulary";
import { formatarPrazo, ROTULO_DO_TIPO as ROTULO_DA_TAREFA, ehTipoDeTarefa } from "@/lib/tarefas/tarefa";
import { ChatCircle, Check, Kanban, WhatsappLogo } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  leadId: string;
  agora: Date;
}

export function PreparoPanel({ leadId, agora }: Props) {
  const query = usePreparo(leadId);
  const toggle = useToggleItemPreparo(leadId);

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-error-fg">Não foi possível carregar o preparo.</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }

  const preparo = query.data.data;
  const reuniao = preparo.reuniao;

  // A reunião pode ter sido desmarcada entre o carregamento da lista e o
  // clique. Dizer isso é melhor que renderizar um checklist órfão.
  if (!reuniao) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm text-text-muted">
          Este negócio não tem mais reunião marcada.
        </p>
      </Card>
    );
  }

  const itens = montarChecklist(reuniao, agora);
  const resumo = resumoDoChecklist(itens);
  const ganchos = extractGanchos(preparo.lead.custom_fields);
  const extras = extractExtras(preparo.lead.custom_fields);
  const abertas = preparo.tarefas.filter((t) => t.status === "pending");

  return (
    <div className="flex flex-col gap-4">
      <Cabecalho
        preparo={preparo}
        reuniao={reuniao}
        quando={quandoDaReuniao(reuniao, agora)}
      />

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-text">O que falta antes da reunião</h3>
          <span className="text-xs text-text-muted">
            {resumo.feitos} de {resumo.total} prontos
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {itens.map((item) => (
            <LinhaDoChecklist
              key={item.id}
              item={item}
              salvando={toggle.isPending && toggle.variables?.item === item.id}
              onToggle={() => toggle.mutate({ item: item.id, feito: !item.feito })}
            />
          ))}
        </ul>
        {toggle.isError && (
          <p className="text-xs text-error-fg">
            Não deu para gravar essa marcação. Tente de novo.
          </p>
        )}
      </Card>

      <NotasDoTime notas={preparo.notas} />

      {abertas.length > 0 && <TarefasAbertas tarefas={abertas} agora={agora} />}

      {ganchos.length > 0 && (
        <Card className="flex flex-col gap-2 p-5">
          <h3 className="text-sm font-semibold text-text">Gancho de abertura</h3>
          <ul className="flex flex-col gap-2">
            {ganchos.map((g) => (
              <li
                key={g}
                className="whitespace-pre-wrap break-words rounded-md border border-warning/40 bg-warning-bg p-3 text-sm leading-relaxed text-warning-fg"
              >
                {g}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {preparo.reunioes_anteriores.length > 0 && (
        <ReunioesAnteriores reunioes={preparo.reunioes_anteriores} />
      )}

      {extras.length > 0 && (
        <Card className="flex flex-col gap-2 p-5">
          <h3 className="text-sm font-semibold text-text">O que sabemos do negócio</h3>
          <LeadExtrasList extras={extras} />
        </Card>
      )}
    </div>
  );
}

function Cabecalho({
  preparo,
  reuniao,
  quando,
}: {
  preparo: Preparo;
  // A reunião vem por fora, e não de `preparo.reuniao`: quem chama já provou
  // que ela existe, e repetir a prova aqui com `!` seria abrir mão do tipo
  // justamente onde ele estava certo.
  reuniao: NonNullable<Preparo["reuniao"]>;
  quando: string;
}) {
  const whatsapp = whatsappLink(preparo.contato?.telefone);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold text-text">
          {preparo.lead.title ?? "Negócio sem nome"}
        </h2>
        <p className="text-sm font-medium text-text">
          {ROTULO_DO_TIPO[reuniao.tipo]} · {quando}
        </p>
        <p className="text-sm text-text-muted">
          {[preparo.contato?.nome, preparo.lead.etapa].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>

      {/* Os três caminhos que se toma DAQUI: falar agora, ler a conversa
          inteira, ou abrir o negócio. Cada um só aparece quando existe — botão
          que às vezes não leva a lugar nenhum treina a pessoa a não clicar. */}
      <div className="flex flex-wrap gap-2">
        {preparo.conversa ? (
          <Button asChild variant="secondary" size="sm" className="gap-2">
            <Link href={`/app/inbox?id=${preparo.conversa.id}`}>
              <ChatCircle size={16} weight="fill" />
              Abrir a conversa
            </Link>
          </Button>
        ) : (
          whatsapp && (
            <Button asChild variant="secondary" size="sm" className="gap-2">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <WhatsappLogo size={16} weight="fill" />
                Chamar no WhatsApp
              </a>
            </Button>
          )
        )}
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href={`/app/leads/${preparo.lead.id}`}>
            <Kanban size={16} />
            Ver o negócio
          </Link>
        </Button>
        {reuniao.gcal_link && (
          <Button asChild variant="outline" size="sm">
            <a href={reuniao.gcal_link} target="_blank" rel="noopener noreferrer">
              Abrir na agenda
            </a>
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Uma linha do checklist.
 *
 * O item automático NÃO é um botão: ele relata um fato do banco (o lembrete
 * saiu, o evento entrou na agenda). Deixar clicar seria permitir marcar como
 * feito algo que o sistema sabe que não aconteceu — e um checklist que aceita
 * mentira para de ser consultado.
 */
function LinhaDoChecklist({
  item,
  salvando,
  onToggle,
}: {
  item: ItemDoChecklist;
  salvando: boolean;
  onToggle: () => void;
}) {
  const caixa = (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-control border",
        item.feito
          ? "border-success-fg bg-success-fg text-white"
          : "border-border bg-surface-elevated",
      )}
    >
      {item.feito && <Check size={13} weight="bold" />}
    </span>
  );

  const corpo = (
    <span className="min-w-0 flex-1 text-left">
      <span
        className={cn(
          "block text-sm",
          item.feito ? "text-text-muted line-through" : "font-medium text-text",
        )}
      >
        {item.rotulo}
      </span>
      {item.detalhe && <span className="block text-xs text-text-subtle">{item.detalhe}</span>}
    </span>
  );

  if (item.origem === "automatico") {
    return (
      <li className="flex items-start gap-3 rounded-control px-1 py-2">
        {caixa}
        {corpo}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={salvando}
        aria-pressed={item.feito}
        className={cn(
          "flex w-full items-start gap-3 rounded-control px-1 py-2 text-left transition-colors",
          "hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
          salvando && "opacity-60",
        )}
      >
        {caixa}
        {corpo}
      </button>
    </li>
  );
}

/**
 * As notas internas da conversa — o recado que o SDR deixou.
 *
 * Estado vazio COM texto, ao contrário do resto do painel: aqui a ausência
 * informa. "Ninguém anotou nada" é uma resposta útil para quem vai entrar na
 * reunião, e é diferente de a seção nem existir.
 */
function NotasDoTime({ notas }: { notas: NotaDoPreparo[] }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold text-text">Notas do time sobre este lead</h3>
      {notas.length === 0 ? (
        <p className="text-sm text-text-muted">
          Ninguém anotou nada nesta conversa ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {notas.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
                {n.body}
              </p>
              <p className="text-xs text-text-subtle">
                {n.created_by_name ?? "Sistema"} ·{" "}
                {new Date(n.created_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TarefasAbertas({ tarefas, agora }: { tarefas: TarefaDoPreparo[]; agora: Date }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold text-text">Tarefas abertas deste negócio</h3>
      <ul className="flex flex-col gap-2">
        {tarefas.map((t) => {
          const prazo = new Date(t.due_at);
          const atrasada = prazo.getTime() <= agora.getTime();
          return (
            <li key={t.id} className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-text">{t.title}</p>
              <p className={cn("text-xs", atrasada ? "text-error-fg" : "text-text-muted")}>
                {ehTipoDeTarefa(t.kind) ? ROTULO_DA_TAREFA[t.kind] : t.kind} ·{" "}
                {formatarPrazo(prazo, agora)}
              </p>
              {t.notes && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-muted">
                  {t.notes}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** A R1 anterior é o insumo da R2 — nota, desfecho e resumo do que o cliente disse. */
function ReunioesAnteriores({ reunioes }: { reunioes: ReuniaoAnterior[] }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold text-text">Reuniões anteriores com este lead</h3>
      <ul className="flex flex-col gap-3">
        {reunioes.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-text">
                {MEETING_TYPE_LABELS[r.meeting_type]}
              </span>
              <span className="text-xs text-text-muted">
                {new Date(r.started_at).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                })}
                {" · "}
                {MEETING_STATUS_LABELS[r.status]}
                {r.outcome && ` · ${MEETING_OUTCOME_LABELS[r.outcome]}`}
                {r.score !== null &&
                  ` · nota ${Number.isInteger(r.score) ? r.score : r.score.toFixed(1)}`}
              </span>
            </div>
            {r.summary && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                {r.summary}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
