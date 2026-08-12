"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  useChannelSessions,
  type ChannelSession,
} from "@/hooks/channels/useChannelSessions";
import { usePacingKnobs } from "@/hooks/channels/usePacingKnobs";
// Só o tipo (some no build): o módulo em si é server-only.
import type { UniaoDeNumero } from "@/lib/waha/um-numero-uma-conexao";
import { AntiBanSheet } from "./AntiBanSheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  Phone,
  Plus,
  ShieldCheck,
  Trash,
} from "@/lib/ui/icons";

type Variant = "success" | "warning" | "error" | "neutral";

const STATUS_MAP: Record<string, { label: string; variant: Variant }> = {
  WORKING: { label: "Conectado", variant: "success" },
  SCAN_QR_CODE: { label: "Escaneie o QR", variant: "warning" },
  STARTING: { label: "Conectando…", variant: "warning" },
  STOPPED: { label: "Parado", variant: "error" },
  FAILED: { label: "Caiu", variant: "error" },
};

function statusInfo(status: string): { label: string; variant: Variant } {
  return STATUS_MAP[status] ?? { label: status, variant: "neutral" };
}

function channelLabel(c: ChannelSession): string {
  return c.display_name || c.phone_number || c.waha_session_name;
}

/**
 * "hoje 22:34", "ontem 09:12", "5 de agosto". Data crua em card é ruído; o que
 * o usuário precisa responder é "esse número trabalhou hoje?".
 */
function quandoFoi(iso: string | null): string {
  if (!iso) return "Nenhuma mensagem ainda";
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dia(hoje) - dia(d)) / 86_400_000);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `hoje ${hora}`;
  if (diff === 1) return `ontem ${hora}`;
  if (diff < 7) return `há ${diff} dias`;
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

/** Número que recebeu conversa na semana não se remove por engano. */
function estaTrabalhando(c: ChannelSession): boolean {
  return c.conversas_7d > 0;
}

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

export function ConnectionsClient({ wahaConfigured }: { wahaConfigured: boolean }) {
  const qc = useQueryClient();
  const { data: sessions, isLoading } = useChannelSessions({ refetchInterval: 10_000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [qr, setQr] = useState<{ sessionId: string; title: string } | null>(null);
  const [antiBanId, setAntiBanId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ChannelSession | null>(null);
  const [confirmandoNovo, setConfirmandoNovo] = useState(false);
  const [telefoneVivo, setTelefoneVivo] = useState<Record<string, string>>({});
  const pacingItems = usePacingKnobs().data?.items ?? [];

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["channel-sessions"] }),
    [qc],
  );

  // Health check ao vivo de todos os canais — consulta o WAHA e grava
  // last_health_check_at. É a verificação de saúde de verdade (o status do DB
  // pode estar velho se o WAHA caiu sem emitir evento).
  const runHealthCheck = useCallback(
    async (list: ChannelSession[]) => {
      if (!wahaConfigured || list.length === 0) return;
      setChecking(true);
      try {
        const res = await Promise.allSettled(
          list.map((c) =>
            apiClient.get<{
              data: { id: string; phone_number: string | null; uniao?: UniaoDeNumero | null };
            }>(`/api/v1/channel-sessions/${c.id}`),
          ),
        );
        // A trava de número repetido roda dentro do health check — quando ela
        // age, quem está olhando a Central precisa saber por que um cartão sumiu.
        for (const r of res) {
          const u = r.status === "fulfilled" ? r.value.data.uniao : null;
          if (!u) continue;
          toast.success(
            u.acao === "cartao_reassumiu"
              ? `${u.rotulo} voltou a funcionar no cartão de sempre.`
              : `Conexão repetida do mesmo WhatsApp removida. Tudo continua em ${u.rotulo}.`,
          );
        }
        // O telefone da resposta vale mais que o da lista: quando o mesmo
        // aparelho está em duas sessões, a unique do banco deixa a coluna vazia
        // numa delas e o card fica sem identificação nenhuma.
        setTelefoneVivo((antes) => {
          const proximo = { ...antes };
          for (const r of res) {
            if (r.status !== "fulfilled") continue;
            const { id, phone_number } = r.value.data;
            if (phone_number) proximo[id] = phone_number;
          }
          return proximo;
        });
        invalidate();
      } finally {
        setChecking(false);
      }
    },
    [wahaConfigured, invalidate],
  );

  const didInitialCheck = useRef(false);
  useEffect(() => {
    if (didInitialCheck.current || !sessions || sessions.length === 0) return;
    didInitialCheck.current = true;
    void runHealthCheck(sessions);
  }, [sessions, runHealthCheck]);

  const handleConnectNew = useCallback(async () => {
    setConfirmandoNovo(false);
    setCreating(true);
    try {
      const res = await apiClient.post<{ data: ChannelSession }>(
        "/api/v1/channel-sessions",
        {},
      );
      invalidate();
      setQr({ sessionId: res.data.id, title: "Conectar novo WhatsApp" });
    } catch (err) {
      toast.error(errMsg(err, "Não foi possível iniciar a conexão."));
    } finally {
      setCreating(false);
    }
  }, [invalidate]);

  const handleReconnect = useCallback(
    async (c: ChannelSession) => {
      setBusyId(c.id);
      try {
        await apiClient.post(`/api/v1/channel-sessions/${c.id}/reconnect`, {});
        invalidate();
        setQr({ sessionId: c.id, title: `Reconectar ${channelLabel(c)}` });
      } catch (err) {
        toast.error(errMsg(err, "Não foi possível reconectar."));
      } finally {
        setBusyId(null);
      }
    },
    [invalidate],
  );

  // Remover = parar a sessão no WAHA e tirar o número de todas as listas. O
  // servidor decide entre apagar de vez (número que nunca conversou) e
  // arquivar (tem histórico) — aqui só refletimos o que ele fez.
  const handleRemove = useCallback(
    async (c: ChannelSession) => {
      setBusyId(c.id);
      try {
        const res = await apiClient.delete<{ data: { modo: "apagado" | "arquivado" } }>(
          `/api/v1/channel-sessions/${c.id}`,
        );
        setRemoving(null);
        toast.success(
          res.data.modo === "apagado"
            ? `${channelLabel(c)} removido.`
            : `${channelLabel(c)} removido. As conversas antigas continuam no inbox.`,
        );
        invalidate();
      } catch (err) {
        toast.error(errMsg(err, "Não foi possível remover o número."));
      } finally {
        setBusyId(null);
      }
    },
    [invalidate],
  );

  const handleConnected = useCallback(() => {
    toast.success("WhatsApp conectado!");
    setQr(null);
    invalidate();
  }, [invalidate]);

  const list = sessions ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {list.length === 0
            ? "Nenhum número conectado ainda."
            : `${list.length} ${list.length === 1 ? "número conectado" : "números conectados"}.`}
        </p>
        <div className="flex gap-2">
          {list.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={checking || !wahaConfigured}
              onClick={() => void runHealthCheck(list)}
            >
              <ArrowsClockwise
                size={14}
                className={checking ? "animate-spin" : undefined}
                aria-hidden
              />
              Atualizar saúde
            </Button>
          )}
          {/* Com número já conectado, o "+" pergunta antes: foi ele, clicado no
              lugar do "Reconectar", que criou as conexões repetidas de 10/08. */}
          <Button
            size="sm"
            disabled={creating || !wahaConfigured}
            onClick={() => (list.length > 0 ? setConfirmandoNovo(true) : void handleConnectNew())}
          >
            {creating ? (
              <CircleNotch size={14} className="animate-spin" aria-hidden />
            ) : (
              <Plus size={14} aria-hidden />
            )}
            Conectar novo WhatsApp
          </Button>
        </div>
      </div>

      {!wahaConfigured && (
        <div className="rounded-md border border-warning bg-warning-bg p-4 text-sm text-warning-fg">
          <p className="font-medium">O serviço do WhatsApp não está ativo.</p>
          <p className="mt-1">
            Suba o container (<code>docker compose up -d waha</code>) para conectar e reconectar números.
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando conexões…</p>
      ) : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <Phone size={28} className="text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Conecte seu primeiro número de WhatsApp para começar a atender.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => {
            const info = statusInfo(c.status);
            const telefone = c.phone_number ?? telefoneVivo[c.id] ?? null;
            const trabalhando = estaTrabalhando(c);
            return (
              <Card key={c.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Phone size={16} className="text-muted-foreground" aria-hidden />
                      <span className="truncate text-sm font-medium">{channelLabel(c)}</span>
                    </div>
                    {telefone && telefone !== channelLabel(c) && (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{telefone}</p>
                    )}
                  </div>
                  <Badge variant={info.variant}>{info.label}</Badge>
                </div>

                {/* Atividade acima da saúde de propósito: "trabalhou hoje?" é a
                    pergunta que decide o que fazer com o número. */}
                <div className="rounded-md bg-muted/50 px-2.5 py-2">
                  <p className="text-xs font-medium">
                    Última mensagem: {quandoFoi(c.ultima_mensagem_em)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {trabalhando
                      ? `${c.conversas_7d} ${c.conversas_7d === 1 ? "conversa" : "conversas"} nos últimos 7 dias`
                      : c.conversas_total > 0
                        ? `Parado — ${c.conversas_total} ${c.conversas_total === 1 ? "conversa" : "conversas"} no histórico`
                        : "Nunca foi usado"}
                  </p>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {c.last_health_check_at
                    ? `Verificado ${new Date(c.last_health_check_at).toLocaleString("pt-BR")}`
                    : "Ainda não verificado"}
                </p>
                <div className="mt-auto flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === c.id || !wahaConfigured}
                    onClick={() => handleReconnect(c)}
                  >
                    {busyId === c.id ? (
                      <CircleNotch size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <ArrowsClockwise size={14} aria-hidden />
                    )}
                    Reconectar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAntiBanId(c.id)}>
                    <ShieldCheck size={14} aria-hidden />
                    Proteção de envio
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto text-error-fg"
                    disabled={busyId === c.id}
                    aria-label={`Remover ${channelLabel(c)}`}
                    title="Remover número"
                    onClick={() => setRemoving(c)}
                  >
                    <Trash size={14} aria-hidden />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AntiBanSheet
        item={pacingItems.find((i) => i.channel_session.id === antiBanId) ?? null}
        canWrite
        onClose={() => setAntiBanId(null)}
      />

      <AlertDialog open={confirmandoNovo} onOpenChange={(o) => !o && setConfirmandoNovo(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Esse WhatsApp é novo?</AlertDialogTitle>
            <AlertDialogDescription>
              Use este botão só para um número que ainda não está aqui. Se um número
              seu caiu, clique em <span className="font-medium">Reconectar</span> no
              cartão dele — é o mesmo QR, e a conversa dos leads continua no lugar de
              sempre. Se escanear o mesmo WhatsApp aqui, o CRM devolve a conexão ao
              cartão que já existe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConnectNew()}>
              É um número novo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remover {removing ? channelLabel(removing) : "este número"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O número sai da Central, do seletor do inbox e do canal dos agentes, e o
              aparelho é desconectado. As conversas e mensagens que já existem
              continuam no inbox. Para voltar a usar este número, é só conectar de novo
              e escanear o QR.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Em 09/08/2026 o número removido era justamente o que trabalhava —
              dois canais "Conectado" e nada na tela para diferenciar. O aviso
              existe para que remover o número vivo seja uma decisão, não um
              acidente. */}
          {removing && estaTrabalhando(removing) && (
            <div className="rounded-md border border-error bg-error-bg p-3 text-sm text-error-fg">
              <p className="font-medium">Atenção: este número está trabalhando.</p>
              <p className="mt-1">
                {removing.conversas_7d}{" "}
                {removing.conversas_7d === 1 ? "conversa" : "conversas"} nos últimos 7
                dias, a última {quandoFoi(removing.ultima_mensagem_em)}. Se ele for
                removido, mensagem que chegar nele é descartada.
              </p>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!removing && busyId === removing.id}
              onClick={(e) => {
                e.preventDefault(); // fecha só depois que o servidor confirmar
                if (removing) void handleRemove(removing);
              }}
            >
              {removing && estaTrabalhando(removing) ? "Remover mesmo assim" : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {qr && (
        <QrDialog
          sessionId={qr.sessionId}
          title={qr.title}
          wahaConfigured={wahaConfigured}
          onClose={() => {
            setQr(null);
            invalidate();
          }}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}

function QrDialog({
  sessionId,
  title,
  wahaConfigured,
  onClose,
  onConnected,
}: {
  sessionId: string;
  title: string;
  wahaConfigured: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [status, setStatus] = useState<string>("STARTING");
  const [tick, setTick] = useState(0);
  const [uniao, setUniao] = useState<UniaoDeNumero | null>(null);
  const done = useRef(false);
  const qrShown = useRef(false);

  useEffect(() => {
    if (!wahaConfigured) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiClient.get<{ data: { status: string; uniao?: UniaoDeNumero | null } }>(
          `/api/v1/channel-sessions/${sessionId}`,
        );
        if (cancelled) return;
        // Mesmo WhatsApp escaneado de novo: o servidor já desfez a repetição.
        // Aqui a tela só explica — e para de esperar um QR que não vem mais.
        if (res.data.uniao?.este_cartao_saiu) {
          setUniao(res.data.uniao);
          done.current = true;
          return;
        }
        const s = res.data.status;
        setStatus(s);
        // NOWEB: o QR é estável até conectar — carrega a imagem UMA vez ao entrar
        // em SCAN_QR_CODE (evita o flash branco de recarregar a cada poll).
        if (s === "SCAN_QR_CODE" && !qrShown.current) {
          qrShown.current = true;
          setTick((t) => t + 1);
        }
        if (s === "WORKING" && !done.current) {
          done.current = true;
          onConnected();
        }
      } catch {
        // erro transitório de rede — o próximo tick tenta de novo
      }
    };
    void poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [sessionId, wahaConfigured, onConnected]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneie o código.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 py-2">
          {uniao ? (
            <div className="w-full rounded-md border border-warning bg-warning-bg p-4 text-sm text-warning-fg">
              <p className="font-medium">
                {uniao.acao === "cartao_reassumiu"
                  ? "Esse número já tinha um cartão aqui — ele voltou a funcionar."
                  : "Esse WhatsApp já está conectado aqui."}
              </p>
              <p className="mt-1">
                Cartão: <span className="font-medium">{uniao.rotulo}</span>.{" "}
                {uniao.acao === "cartao_reassumiu"
                  ? "Não criei um segundo cartão: o de sempre assumiu a conexão, com todo o histórico."
                  : "Não criei um segundo cartão — dois cartões do mesmo número partem a conversa do lead em dois lugares."}
              </p>
              <Button size="sm" className="mt-3" onClick={onClose}>
                Entendi
              </Button>
            </div>
          ) : status === "SCAN_QR_CODE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={tick}
              src={`/api/v1/channel-sessions/${sessionId}/qr?t=${tick}`}
              alt="QR Code para conectar WhatsApp"
              className="h-64 w-64 rounded-md border bg-white p-2"
            />
          ) : status === "WORKING" ? (
            <div className="flex flex-col items-center gap-2 text-sm font-medium text-success-fg">
              <CheckCircle size={28} weight="fill" aria-hidden />
              Conectado!
            </div>
          ) : status === "FAILED" || status === "STOPPED" ? (
            <p className="text-center text-sm text-error-fg">
              Não foi possível conectar. Feche e tente “Reconectar”.
            </p>
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <CircleNotch size={28} className="animate-spin" aria-hidden />
              Preparando o código…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
