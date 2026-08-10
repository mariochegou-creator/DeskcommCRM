"use client";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAgendarReuniao, type RespostaDoAgendamento } from "@/hooks/kanban/useAgendarReuniao";
import {
  dataCivilBahia,
  formatarReuniao,
  instanteDaReuniao,
  ROTULO_DO_TIPO,
  SLOTS_DO_CLOSER,
  type Reuniao,
  type TipoDeReuniao,
} from "@/lib/agendamento/reuniao";

interface AgendarReuniaoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadTitulo: string;
  pipelineId: string;
  /**
   * Derivado da coluna em que o card entrou. Ausente quando o dialog vem pelo
   * menu do card (que não sabe a coluna) — aí a rota deriva da etapa atual, e
   * o título fala genericamente em "reunião".
   */
  tipo?: TipoDeReuniao;
  /**
   * O que já está marcado neste card, quando há. Mostrado antes de salvar
   * porque este dialog SOBRESCREVE: sem o aviso, quem só queria conferir a
   * hora acabaria remarcando — e o lead receberia uma segunda confirmação.
   */
  reuniaoAtual?: Reuniao | null;
}

const MOTIVO_DA_CONFIRMACAO: Record<string, string> = {
  sem_contato: "este negócio não tem contato ligado — a confirmação não saiu.",
  sem_telefone: "o contato não tem telefone — a confirmação não saiu.",
  contato_bloqueado: "o contato está bloqueado — a confirmação não saiu.",
  sem_sessao: "nenhum número de WhatsApp conectado — a confirmação não saiu.",
  falhou: "o envio da confirmação falhou. Mande na mão por enquanto.",
};

/**
 * O dialog que aparece quando o card entra na coluna de reunião marcada.
 *
 * Ele existe porque o CRM não tinha COMO saber a hora da reunião — e sem ela
 * não há véspera nem toque final, que são justamente os dois lembretes que
 * derrubam o no-show. Dois cliques (dia + slot) é o teto de fricção aceitável:
 * qualquer coisa mais longa e o SDR fecha o dialog no meio da correria.
 *
 * Depois de salvar, a tela NÃO se limita a "pronto": mostra o que de fato
 * aconteceu com o WhatsApp e com a agenda. Um "salvo" que esconde uma
 * confirmação não enviada é exatamente o silêncio que produz reunião vazia.
 */
export function AgendarReuniaoDialog({
  open,
  onOpenChange,
  leadId,
  leadTitulo,
  pipelineId,
  tipo,
  reuniaoAtual,
}: AgendarReuniaoDialogProps) {
  /**
   * O instante de abertura, congelado. O componente é montado sob condição
   * pelos dois chamadores (board e menu do card), então cada abertura já
   * nasce com estado limpo — e um relógio lido a cada render faria o aviso de
   * "horário no passado" piscar sozinho.
   */
  const [abertoEm] = useState(() => new Date());
  const hoje = useMemo(() => dataCivilBahia(abertoEm), [abertoEm]);
  const amanha = useMemo(() => dataCivilBahia(abertoEm, 1), [abertoEm]);
  const [data, setData] = useState(amanha);
  const [hora, setHora] = useState<string>(SLOTS_DO_CLOSER[1]);
  const [resultado, setResultado] = useState<RespostaDoAgendamento | null>(null);
  const mutation = useAgendarReuniao(pipelineId);

  const jaMarcada = useMemo(
    () => (reuniaoAtual ? formatarReuniao(new Date(reuniaoAtual.em)) : null),
    [reuniaoAtual],
  );
  const quando = useMemo(() => instanteDaReuniao(data, hora), [data, hora]);
  const noPassado = quando.getTime() < abertoEm.getTime();
  const previa = formatarReuniao(quando);

  const salvar = async () => {
    try {
      const resposta = await mutation.mutateAsync({ leadId, data, hora, tipo });
      setResultado(resposta);
    } catch {
      // showApiError já avisou; o dialog fica aberto para corrigir a data.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tipo ? ROTULO_DO_TIPO[tipo].toUpperCase() : "Reunião"} — {leadTitulo}
          </DialogTitle>
          <DialogDescription>
            {resultado
              ? "Reunião marcada."
              : "Escolha o dia e a hora. O lead recebe a confirmação agora, um lembrete às 18h da véspera e outro 1 hora antes."}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <Resultado resposta={resultado} />
        ) : (
          <div className="grid gap-4">
            {jaMarcada && (
              <p className="rounded-md border border-border bg-surface-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Já está marcada para {jaMarcada.diaDaSemana}, {jaMarcada.diaMes} às{" "}
                {jaMarcada.hora}. Salvar aqui remarca e manda uma confirmação nova.
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="reuniao-data">Dia</Label>
              <Input
                id="reuniao-data"
                type="date"
                value={data}
                min={hoje}
                onChange={(e) => setData(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Hora</Label>
              {/* Os 3 slots do closer primeiro (10h/14h/16h são a regra da
                  operação); o campo livre existe para a exceção, não para o
                  dia a dia. */}
              <div className="flex flex-wrap gap-2">
                {SLOTS_DO_CLOSER.map((slot) => (
                  <Button
                    key={slot}
                    type="button"
                    variant={hora === slot ? "default" : "outline"}
                    onClick={() => setHora(slot)}
                  >
                    {slot.replace(":00", "h")}
                  </Button>
                ))}
                <Input
                  type="time"
                  aria-label="Outro horário"
                  className="w-32"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                />
              </div>
            </div>

            <p
              className={`text-sm ${noPassado ? "text-destructive" : "text-muted-foreground"}`}
              aria-live="polite"
            >
              {noPassado
                ? "Esse horário já passou — escolha um futuro."
                : `${previa.diaDaSemana}, ${previa.diaMes} às ${previa.hora}.`}
            </p>
          </div>
        )}

        <DialogFooter>
          {resultado ? (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Agora não
              </Button>
              <Button onClick={salvar} disabled={noPassado || mutation.isPending}>
                {mutation.isPending ? "Marcando…" : "Marcar e confirmar"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O que realmente aconteceu — WhatsApp e agenda, cada um com o seu recado. */
function Resultado({ resposta }: { resposta: RespostaDoAgendamento }) {
  const q = formatarReuniao(new Date(resposta.reuniao.em));
  return (
    <div className="grid gap-3 text-sm">
      <p className="font-medium">
        {q.diaDaSemana}, {q.diaMes} às {q.hora}.
      </p>

      <p className={resposta.confirmacao.enviada ? "text-muted-foreground" : "text-destructive"}>
        {resposta.confirmacao.enviada
          ? "Confirmação enviada no WhatsApp. Os lembretes da véspera e de 1h antes saem sozinhos."
          : (MOTIVO_DA_CONFIRMACAO[resposta.confirmacao.motivo] ??
            "a confirmação não saiu.")}
      </p>

      {resposta.agenda.criada ? (
        <p className="text-muted-foreground">
          Evento criado no Google Agenda.{" "}
          {resposta.agenda.link && (
            <a
              className="underline underline-offset-2"
              href={resposta.agenda.link}
              target="_blank"
              rel="noreferrer"
            >
              Abrir
            </a>
          )}
        </p>
      ) : (
        <p className="text-muted-foreground">
          {resposta.agenda.configurada
            ? "O Google Agenda recusou o evento agora. "
            : "Google Agenda ainda não conectado. "}
          <a
            className="underline underline-offset-2"
            href={resposta.agenda.link_manual}
            target="_blank"
            rel="noreferrer"
          >
            Adicionar na minha agenda
          </a>
        </p>
      )}
    </div>
  );
}
