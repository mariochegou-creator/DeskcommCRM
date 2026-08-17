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
import { useHorariosDoDia } from "@/hooks/kanban/useHorariosDoDia";
import { useCriarTarefa } from "@/hooks/tarefas/useTarefas";
import {
  AGENDA_PUBLICA_URL,
  dataCivilBahia,
  formatarReuniao,
  instanteDaReuniao,
  ROTULO_DO_TIPO,
  SLOTS_DA_AGENDA,
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
  // Não é falha: é o interruptor da org desligado de propósito. A frase diz o
  // que sobrou pro humano, porque a reunião ficou marcada de verdade e o lead
  // não sabe disso.
  automacao_desligada:
    "as mensagens automáticas estão DESLIGADAS. A reunião ficou marcada, mas o lead não foi avisado — mande a confirmação e os lembretes na mão.",
  // Também não é falha: é o mesmo dia e hora salvos de novo. Dizer "já tinha
  // saído" evita que a pessoa mande na mão uma terceira cópia por precaução.
  ja_confirmada: "esse mesmo horário já estava marcado — a confirmação não foi reenviada.",
};

/**
 * O dialog que aparece quando o card entra na coluna de reunião marcada.
 *
 * UMA tela só, e o caminho é do CRM PARA o Google — nunca o contrário.
 *
 * A tentativa anterior (17/08/2026) embutia a página pública de agendamento do
 * Google num iframe como primeiro passo. Funcionava para marcar, mas morria ali:
 * uma página do Google dentro de um iframe **não conta ao CRM** o dia, a hora
 * nem o e-mail que foram digitados — é outro domínio, sem canal de volta. O
 * resultado era digitar tudo duas vezes. Então o sentido foi invertido: dia,
 * hora e e-mail entram AQUI, e é o CRM que cria o evento na agenda e manda o
 * convite (`lib/agendamento/google-calendar.ts`, quando as 4 env vars estão
 * ligadas — sem elas sobra o botão "Adicionar na minha agenda").
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
  const [hora, setHora] = useState<string>(SLOTS_DA_AGENDA[0]);
  const [resultado, setResultado] = useState<RespostaDoAgendamento | null>(null);
  /**
   * O e-mail que recebe o convite do Google. Vazio NÃO significa "sem convite":
   * a rota cai no e-mail cadastrado do contato. Este campo é para o caso comum
   * de o dono do negócio dar um e-mail diferente na hora de marcar.
   */
  const [email, setEmail] = useState("");
  const mutation = useAgendarReuniao(pipelineId);

  const jaMarcada = useMemo(
    () => (reuniaoAtual ? formatarReuniao(new Date(reuniaoAtual.em)) : null),
    [reuniaoAtual],
  );
  const quando = useMemo(() => instanteDaReuniao(data, hora), [data, hora]);
  const noPassado = quando.getTime() < abertoEm.getTime();
  const previa = formatarReuniao(quando);

  // O que já tem dono nesse dia — reuniões do CRM mais a agenda do Google.
  const horarios = useHorariosDoDia(data, leadId);
  const ocupados = useMemo(
    () => new Set(horarios.data?.ocupados ?? []),
    [horarios.data?.ocupados],
  );
  // O slot escolhido ficou ocupado (ou já estava, ao trocar de dia). O botão de
  // salvar trava: deixar salvar por cima é criar a segunda reunião no mesmo
  // horário, que é exatamente o que esta grade existe para impedir.
  const escolhidoOcupado = ocupados.has(hora);

  /**
   * Só manda o convidado quando o campo tem cara de e-mail. Digitação pela
   * metade viraria 422 do zod (`z.string().email()`) e derrubaria um
   * agendamento válido por causa de um campo opcional.
   */
  const emailLimpo = email.trim();
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo);

  const salvar = async () => {
    try {
      const resposta = await mutation.mutateAsync({
        leadId,
        data,
        hora,
        tipo,
        convidados: emailValido ? [emailLimpo] : undefined,
      });
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
              : "Escolha o dia e a hora. O evento entra na sua agenda, o lead recebe o convite por e-mail e a confirmação no WhatsApp, mais lembrete às 18h da véspera e 1 hora antes."}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <Resultado resposta={resultado} leadId={leadId} leadTitulo={leadTitulo} />
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
              {/* A grade do expediente (10h–18h); o campo livre existe para a
                  exceção, não para o dia a dia. Horário com dono aparece
                  desabilitado em vez de sumir: quem olha precisa entender que
                  o horário EXISTE e está tomado — uma grade que encolhe
                  sozinha parece defeito. */}
              <div className="flex flex-wrap gap-2">
                {SLOTS_DA_AGENDA.map((slot) => {
                  const tomado = ocupados.has(slot);
                  return (
                    <Button
                      key={slot}
                      type="button"
                      size="sm"
                      variant={hora === slot ? "default" : "outline"}
                      disabled={tomado}
                      title={tomado ? "Já tem compromisso nesse horário" : undefined}
                      className={tomado ? "line-through opacity-50" : undefined}
                      onClick={() => setHora(slot)}
                    >
                      {slot.replace(":00", "h")}
                    </Button>
                  );
                })}
                <Input
                  type="time"
                  aria-label="Outro horário"
                  className="w-32"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                />
              </div>
              {horarios.isLoading && (
                <p className="text-xs text-muted-foreground">Conferindo a agenda…</p>
              )}
              {horarios.data && !horarios.data.agenda_lida && (
                <p className="text-xs text-muted-foreground">
                  A agenda do Google não respondeu — aqui só aparecem os horários já
                  marcados no CRM.
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="reuniao-email">E-mail do lead (para o convite)</Label>
              <Input
                id="reuniao-email"
                type="email"
                inputMode="email"
                placeholder="deixe vazio para usar o e-mail do cadastro"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {emailLimpo.length > 0 && !emailValido && (
                <p className="text-xs text-destructive">
                  Esse e-mail está incompleto — do jeito que está, o convite não vai.
                </p>
              )}
            </div>

            <p
              className={`text-sm ${
                noPassado || escolhidoOcupado ? "text-destructive" : "text-muted-foreground"
              }`}
              aria-live="polite"
            >
              {noPassado
                ? "Esse horário já passou — escolha um futuro."
                : escolhidoOcupado
                  ? "Esse horário já tem compromisso — escolha outro."
                  : `${previa.diaDaSemana}, ${previa.diaMes} às ${previa.hora}.`}
            </p>

            {/* Atalho para conferir o que já está ocupado no dia. Abre fora: a
                agenda do Google não cabe (nem se comunica) dentro do dialog. */}
            <a
              className="text-xs text-muted-foreground underline underline-offset-2"
              href={AGENDA_PUBLICA_URL}
              target="_blank"
              rel="noreferrer"
            >
              Ver minha agenda do Google
            </a>
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
              <Button
                onClick={salvar}
                disabled={noPassado || escolhidoOcupado || mutation.isPending}
              >
                {mutation.isPending ? "Marcando…" : "Marcar e confirmar"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** As antecedências oferecidas na hora de marcar. Só o que se faz de véspera. */
const PREPARACAO: Array<{ id: string; rotulo: string; horas: number }> = [
  { id: "5h", rotulo: "Ligar 5h antes", horas: 5 },
  { id: "2h", rotulo: "Ligar 2h antes", horas: 2 },
];

/** O que realmente aconteceu — WhatsApp e agenda, cada um com o seu recado. */
function Resultado({
  resposta,
  leadId,
  leadTitulo,
}: {
  resposta: RespostaDoAgendamento;
  leadId: string;
  leadTitulo: string;
}) {
  const q = formatarReuniao(new Date(resposta.reuniao.em));
  const emReuniao = new Date(resposta.reuniao.em);
  const criar = useCriarTarefa();
  const [criadas, setCriadas] = useState<string[]>([]);
  // Instante congelado: relógio lido a cada render faria um botão desabilitar
  // sozinho no meio da leitura (e a regra de pureza do React proíbe).
  const [agora] = useState(() => new Date());

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
          {resposta.agenda.convidados.length > 0
            ? `Convite enviado para ${resposta.agenda.convidados.join(", ")}. `
            : "Sem e-mail do lead — ninguém foi convidado. "}
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

      {/* A preparação nasce AQUI, e não numa segunda visita ao card: o momento
          em que se marca a reunião é o único em que a pessoa já sabe o horário
          e ainda está pensando nele. Os lembretes automáticos são do LEAD; isto
          é o lembrete de QUEM VAI ATENDER — as duas coisas se confundiam, e a
          segunda simplesmente não existia. Cria para si mesmo; delegar e deixar
          recado é no relógio da conversa (dialog de tarefas). */}
      <div className="grid gap-2 border-t border-border pt-3">
        <p className="text-xs font-medium text-text">Sua preparação</p>
        {resposta.tarefa_de_ligar && (
          <p className="text-xs text-muted-foreground">
            {resposta.tarefa_de_ligar === "criada"
              ? "✓ Tarefa criada sozinha: ligar 1h antes."
              : "✓ A tarefa de ligar 1h antes foi movida para o horário novo."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {PREPARACAO.map((p) => {
            const em = new Date(emReuniao.getTime() - p.horas * 60 * 60 * 1000);
            const passou = em.getTime() <= agora.getTime();
            const feita = criadas.includes(p.id);
            return (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={feita ? "secondary" : "outline"}
                // Antecedência que já passou não vira botão morto na tela: ela
                // fica desabilitada dizendo o porquê, senão o clique criaria
                // uma tarefa nascida atrasada.
                disabled={feita || passou || criar.isPending}
                title={passou ? "Esse horário já passou" : undefined}
                onClick={() =>
                  criar.mutate(
                    {
                      title: `${p.rotulo.replace(" antes", "")} — ${leadTitulo}`,
                      kind: "ligar",
                      due_at: em.toISOString(),
                      lead_id: leadId,
                    },
                    { onSuccess: () => setCriadas((c) => [...c, p.id]) },
                  )
                }
              >
                {feita ? `${p.rotulo} ✓` : p.rotulo}
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {criadas.length > 0
            ? "Aparecem em Tarefas e avisam você quando a hora chegar."
            : "Vira tarefa sua, com aviso no CRM na hora certa."}
        </p>
      </div>
    </div>
  );
}
