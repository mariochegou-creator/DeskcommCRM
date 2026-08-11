"use client";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useAssignableMembers, type AssignableMember } from "@/hooks/inbox/useAssignableMembers";
import { useCriarTarefa, useTarefas } from "@/hooks/tarefas/useTarefas";
import { Clock } from "@/lib/ui/icons";
import {
  MAX_NOTA,
  MAX_TITULO,
  ROTULO_DO_TIPO,
  TIPOS_DE_TAREFA,
  atalhosDePrazo,
  instanteParaInputLocal,
  inputLocalParaInstante,
  tituloSugerido,
  type TipoDeTarefa,
} from "@/lib/tarefas/tarefa";
import { cn } from "@/lib/utils";

import { ListaDeTarefas } from "./ListaDeTarefas";

interface Adiar {
  ativoAte: string | null;
  pendente: boolean;
  onAdiar: (horas: 1 | 3 | 24) => void;
  onCancelar: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** O que a tarefa vai apontar. Tudo opcional — tarefa solta é legítima. */
  conversationId?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  /** Nome do lead, só para sugerir o título ("Ligar para Fulano"). */
  nomeDoLead?: string | null;
  /** Instante ISO da reunião marcada, se houver — vira os atalhos "5h antes". */
  reuniaoEm?: string | null;
  /** Bloco de adiar a conversa. Ausente = o dialog é só de tarefas. */
  adiar?: Adiar;
}

const HORAS_DE_ADIAR: Array<{ horas: 1 | 3 | 24; rotulo: string }> = [
  { horas: 1, rotulo: "1 hora" },
  { horas: 3, rotulo: "3 horas" },
  { horas: 24, rotulo: "24 horas" },
];

function Chip({
  ativo,
  destaque = false,
  children,
  onClick,
}: {
  ativo: boolean;
  destaque?: boolean;
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
          : destaque
            ? "border-warning/50 bg-warning-bg text-warning-fg hover:border-warning"
            : "border-border text-text-muted hover:border-border-strong hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/**
 * O que o relógio do cabeçalho da conversa abre.
 *
 * Antes ali havia um menu com três durações: adiar a conversa por 1, 3 ou 24
 * horas. Isso continua existindo — é o bloco de cima, e resolve "essa conversa
 * volta pra minha fila depois". O que faltava é o resto: marcar reunião com um
 * lead e sair de lá com *ligar 5h antes*, *ligar 2h antes* e *o recado que o
 * closer precisa ler*, cada um com dono e hora.
 *
 * As duas coisas moram no mesmo lugar porque a pessoa chega aqui pela mesma
 * pergunta ("e depois?") e só descobre qual das duas quer depois de ver as
 * opções. Separar em dois botões obrigaria a escolher antes de pensar.
 *
 * O CORPO é um componente à parte, montado só com o dialog aberto: assim o
 * formulário nasce zerado a cada abertura sem um `useEffect` de reset. O estado
 * que não podia vazar entre aberturas é o RESPONSÁVEL — criar três tarefas
 * seguidas e mandar todas para a mesma pessoa sem perceber.
 */
export function TarefaDialog(props: Props) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tarefa e lembrete</DialogTitle>
          <DialogDescription>
            Combine o próximo passo com hora e dono. Quem recebe e quem pediu são avisados no CRM
            quando o prazo chega.
          </DialogDescription>
        </DialogHeader>
        {open && <CorpoDoDialog {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function CorpoDoDialog({
  conversationId = null,
  contactId = null,
  leadId = null,
  nomeDoLead = null,
  reuniaoEm = null,
  adiar,
}: Props) {
  const { user } = useAuth();
  const criar = useCriarTarefa();
  const membros = useAssignableMembers(true);
  const daConversa = useTarefas({
    escopo: "equipe",
    status: "abertas",
    conversationId,
    enabled: !!conversationId,
  });

  const reuniao = useMemo(() => {
    if (!reuniaoEm) return null;
    const d = new Date(reuniaoEm);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [reuniaoEm]);

  /**
   * O instante congela na ABERTURA (o componente monta com o dialog): os
   * atalhos saem dele, e recalculá-los a cada tecla digitada no título faria
   * "em 1 hora" escorregar debaixo do dedo de quem está prestes a clicar.
   */
  const [agora] = useState<Date>(() => new Date());
  const atalhos = useMemo(() => atalhosDePrazo(agora, reuniao), [agora, reuniao]);

  const [tipo, setTipo] = useState<TipoDeTarefa>("ligar");
  const [titulo, setTitulo] = useState(() => tituloSugerido("ligar", nomeDoLead));
  const [tituloTocado, setTituloTocado] = useState(false);
  const [quandoId, setQuandoId] = useState<string>(() => atalhos[0]?.id ?? "manual");
  const [quandoManual, setQuandoManual] = useState<string>(() =>
    instanteParaInputLocal(new Date(agora.getTime() + 60 * 60 * 1000)),
  );
  const [dono, setDono] = useState<string>(user.id);
  const [nota, setNota] = useState("");

  function trocarTipo(novo: TipoDeTarefa) {
    setTipo(novo);
    // O título só é reescrito enquanto ninguém mexeu nele — depois disso o
    // texto é da pessoa, e sobrescrever seria apagar o que ela digitou.
    if (!tituloTocado) setTitulo(tituloSugerido(novo, nomeDoLead));
  }

  const prazoEscolhido = useMemo(() => {
    if (quandoId === "manual") return inputLocalParaInstante(quandoManual);
    return atalhos.find((a) => a.id === quandoId)?.em ?? null;
  }, [quandoId, quandoManual, atalhos]);

  const tituloLimpo = titulo.trim();
  const podeCriar = tituloLimpo.length > 0 && prazoEscolhido !== null && !criar.isPending;

  function criarTarefa() {
    if (!prazoEscolhido || tituloLimpo.length === 0) return;
    criar.mutate(
      {
        title: tituloLimpo,
        kind: tipo,
        notes: nota.trim() || undefined,
        due_at: prazoEscolhido.toISOString(),
        assigned_to_user_id: dono,
        conversation_id: conversationId ?? undefined,
        contact_id: contactId ?? undefined,
        lead_id: leadId ?? undefined,
      },
      {
        onSuccess: () => {
          // O dialog NÃO fecha: o caso que motivou a tela é criar duas ou três
          // de uma vez ("5h antes" e "2h antes"). Só o que muda de uma para a
          // outra é zerado — dono e tipo continuam onde estavam.
          setNota("");
          setTituloTocado(false);
          setTitulo(tituloSugerido(tipo, nomeDoLead));
        },
      },
    );
  }

  const opcoesDeDono: AssignableMember[] = membros.data ?? [];
  const adiado =
    adiar?.ativoAte != null && new Date(adiar.ativoAte).getTime() > agora.getTime();

  return (
    <>
      {adiar && (
        <>
          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Adiar esta conversa
            </Label>
            {adiado && adiar.ativoAte ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock size={12} weight="regular" aria-hidden />
                  Volta para a fila em{" "}
                  {new Date(adiar.ativoAte).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={adiar.pendente}
                  onClick={adiar.onCancelar}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {HORAS_DE_ADIAR.map((h) => (
                  <Button
                    key={h.horas}
                    size="sm"
                    variant="outline"
                    disabled={adiar.pendente}
                    onClick={() => adiar.onAdiar(h.horas)}
                  >
                    {h.rotulo}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Adiar tira a conversa da fila e devolve depois. Não cria tarefa nem avisa ninguém.
            </p>
          </section>
          <Separator />
        </>
      )}

      <section className="space-y-4">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Nova tarefa
        </Label>

        <div className="space-y-1.5">
          <Label>O que fazer</Label>
          <div className="flex flex-wrap gap-1.5">
            {TIPOS_DE_TAREFA.map((t) => (
              <Chip key={t} ativo={tipo === t} onClick={() => trocarTipo(t)}>
                {ROTULO_DO_TIPO[t]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tarefa-titulo">Título</Label>
          <Input
            id="tarefa-titulo"
            value={titulo}
            maxLength={MAX_TITULO}
            placeholder="Ex.: Ligar antes da reunião"
            onChange={(e) => {
              setTitulo(e.target.value);
              setTituloTocado(true);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Quando</Label>
          {reuniao && atalhos.some((a) => a.daReuniao) && (
            <p className="text-[11px] text-muted-foreground">
              Reunião marcada para{" "}
              {reuniao.toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              .
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {atalhos.map((a) => (
              <Chip
                key={a.id}
                ativo={quandoId === a.id}
                destaque={a.daReuniao}
                onClick={() => setQuandoId(a.id)}
              >
                {a.rotulo}
              </Chip>
            ))}
            <Chip ativo={quandoId === "manual"} onClick={() => setQuandoId("manual")}>
              Outro horário
            </Chip>
          </div>
          {quandoId === "manual" && (
            <Input
              type="datetime-local"
              aria-label="Data e hora da tarefa"
              value={quandoManual}
              onChange={(e) => setQuandoManual(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tarefa-dono">Para quem</Label>
          <Select value={dono} onValueChange={setDono}>
            <SelectTrigger id="tarefa-dono" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={user.id}>
                Eu{user.full_name ? ` · ${user.full_name}` : ""}
              </SelectItem>
              {opcoesDeDono
                .filter((m) => m.user_id !== user.id)
                .map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name ?? `Atendente ${m.user_id.slice(0, 8)}`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tarefa-nota">Informação junto (opcional)</Label>
          <Textarea
            id="tarefa-nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={MAX_NOTA}
            rows={3}
            placeholder="Ex.: o sócio é quem decide, pergunte por ele. Só atende depois das 18h."
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {dono === user.id
              ? "Só você é avisado."
              : "Vocês dois são avisados: quem faz e quem pediu."}
          </p>
          <Button disabled={!podeCriar} onClick={criarTarefa}>
            {criar.isPending ? "Criando…" : "Criar tarefa"}
          </Button>
        </div>
      </section>

      {conversationId && (
        <>
          <Separator />
          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Tarefas deste lead
            </Label>
            <ListaDeTarefas
              tarefas={daConversa.data ?? []}
              carregando={daConversa.isLoading}
              erro={daConversa.isError}
              membros={opcoesDeDono}
              agora={agora}
              vazio="Nenhuma tarefa aberta para este lead."
              compacta
            />
          </section>
        </>
      )}
    </>
  );
}
