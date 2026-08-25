"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import {
  useCamposDePublico,
  useCriarDisparo,
  usePreverPublico,
  type ResumoDoPublico,
} from "@/hooks/disparos/useDisparos";
import { usePipelines, usePipelineStages } from "@/hooks/webhooks/useWebhookSources";
import type { FiltroDePublico } from "@/lib/broadcasts/audience";
import { fraseDoPulo } from "@/lib/broadcasts/vocabulario";
import { MAX_CORPO } from "@/lib/schemas/broadcasts";
import { cn } from "@/lib/utils";

/** Valor do Select quando "não filtrar por isso" — string vazia não é aceita pelo Radix. */
const QUALQUER = "__qualquer__";

function limpo(v: string | undefined): string | null {
  return !v || v === QUALQUER ? null : v;
}

/**
 * O assistente de 3 passos: público → mensagem → revisão.
 *
 * A ordem não é cosmética. Escolher o público primeiro faz o número aparecer
 * antes do texto ser escrito — e é o número ("são 312 pessoas") que muda a
 * forma como a pessoa escreve. O caminho inverso (texto primeiro) produz
 * mensagem genérica e a surpresa do tamanho só na hora de ativar.
 *
 * A REVISÃO é obrigatória, e não um passo que dá para pular: é ali que se vê
 * quem vai ser pulado e se o texto varia o bastante para não ser barrado como
 * template em massa. Uma campanha ativada sem essa conferência é a que pausa no
 * terceiro envio.
 */
export function NovoDisparoDialog({
  onFechar,
  onCriada,
}: {
  onFechar: () => void;
  onCriada: (id: string) => void;
}) {
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<FiltroDePublico>({ lead_status: "open" });
  const [resumo, setResumo] = useState<ResumoDoPublico | null>(null);

  const { data: campos } = useCamposDePublico();
  // Envelope duplo de propósito nos dois: `usePipelines` devolve o JSON inteiro
  // (`{data: Pipeline[]}`) e `usePipelineStages` reusa a rota do board
  // (`{data: {stages: Stage[]}}`). Desembrulhar aqui, e não dentro do JSX.
  const { data: funisRes } = usePipelines();
  const funis = funisRes?.data ?? [];
  const { data: etapasRes } = usePipelineStages(filtro.pipeline_id ?? null);
  const etapas = etapasRes?.data.stages ?? [];
  const prever = usePreverPublico();
  const criar = useCriarDisparo();

  const [chaveDeCampo, setChaveDeCampo] = useState<string>(QUALQUER);
  const valoresDoCampo =
    campos?.custom_fields.find((c) => c.key === chaveDeCampo)?.values ?? [];

  const revisar = () => {
    prever.mutate(
      { audience: filtro, body_template: texto.trim() || null },
      {
        onSuccess: (r) => {
          setResumo(r);
          setPasso(3);
        },
      },
    );
  };

  const criarRascunho = () => {
    const nomeFinal = nome.trim() || `Disparo de ${new Date().toLocaleDateString("pt-BR")}`;
    criar.mutate(
      {
        name: nomeFinal,
        body_template: texto.trim() || null,
        audience: filtro,
      },
      {
        onSuccess: (c) => {
          toast.success("Rascunho criado. Confira e ative quando quiser.");
          onCriada(c.id);
        },
      },
    );
  };

  const temPublico = (resumo?.aptos ?? 0) > 0;

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo disparo</DialogTitle>
          <DialogDescription>
            {passo === 1
              ? "Passo 1 de 3 — para quem vai."
              : passo === 2
                ? "Passo 2 de 3 — o que vai chegar."
                : "Passo 3 de 3 — confira antes de criar."}
          </DialogDescription>
        </DialogHeader>

        {/* ---------------- PASSO 1: público ---------------- */}
        {passo === 1 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="disparo-nome">Nome da campanha</Label>
              <Input
                id="disparo-nome"
                value={nome}
                maxLength={120}
                placeholder="Ex.: Vídeo do site — barbearias"
                onChange={(e) => setNome(e.target.value)}
              />
              <p className="text-xs text-text-muted">Só para você achar depois. O lead não vê.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Funil</Label>
                <Select
                  value={filtro.pipeline_id ?? QUALQUER}
                  onValueChange={(v) =>
                    setFiltro((f) => ({ ...f, pipeline_id: limpo(v), stage_id: null }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QUALQUER}>Todos os funis</SelectItem>
                    {funis.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Etapa</Label>
                <Select
                  value={filtro.stage_id ?? QUALQUER}
                  disabled={!filtro.pipeline_id}
                  onValueChange={(v) => setFiltro((f) => ({ ...f, stage_id: limpo(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QUALQUER}>Todas as etapas</SelectItem>
                    {etapas.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Tag do negócio</Label>
                <Select
                  value={filtro.lead_tag ?? QUALQUER}
                  onValueChange={(v) => setFiltro((f) => ({ ...f, lead_tag: limpo(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Qualquer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QUALQUER}>Qualquer tag</SelectItem>
                    {(campos?.lead_tags ?? []).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Tag do cliente</Label>
                <Select
                  value={filtro.contact_tag ?? QUALQUER}
                  onValueChange={(v) => setFiltro((f) => ({ ...f, contact_tag: limpo(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Qualquer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QUALQUER}>Qualquer tag</SelectItem>
                    {(campos?.client_tags ?? []).map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Nicho: chave crua do CSV importado, não campo do sistema. */}
            {(campos?.custom_fields.length ?? 0) > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Campo da importação</Label>
                  <Select
                    value={chaveDeCampo}
                    onValueChange={(v) => {
                      setChaveDeCampo(v);
                      setFiltro((f) => ({ ...f, custom_field: null }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Nenhum" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={QUALQUER}>Nenhum</SelectItem>
                      {(campos?.custom_fields ?? []).map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-text-muted">
                    Vem do cabeçalho da planilha que você importou (ex.: nicho, categoria).
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Valor</Label>
                  <Select
                    value={filtro.custom_field?.value ?? QUALQUER}
                    disabled={chaveDeCampo === QUALQUER}
                    onValueChange={(v) =>
                      setFiltro((f) => ({
                        ...f,
                        custom_field: v === QUALQUER ? null : { key: chaveDeCampo, value: v },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Qualquer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={QUALQUER}>Qualquer valor</SelectItem>
                      {valoresDoCampo.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label>Situação do negócio</Label>
              <Select
                value={filtro.lead_status ?? "open"}
                onValueChange={(v) =>
                  setFiltro((f) => ({ ...f, lead_status: v as FiltroDePublico["lead_status"] }))
                }
              >
                <SelectTrigger className="sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Em aberto (recomendado)</SelectItem>
                  <SelectItem value="won">Ganhos</SelectItem>
                  <SelectItem value="lost">Perdidos</SelectItem>
                  <SelectItem value="any">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        {/* ---------------- PASSO 2: mensagem ---------------- */}
        {passo === 2 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="disparo-texto">Mensagem</Label>
              <Textarea
                id="disparo-texto"
                value={texto}
                maxLength={MAX_CORPO}
                rows={6}
                placeholder={"{Oi|Olá|Bom dia} {{nome}}! {Vi que vocês|Passei no perfil de vocês e vi que} ..."}
                onChange={(e) => setTexto(e.target.value)}
              />
              <p className="text-xs text-text-muted">
                {texto.length}/{MAX_CORPO} caracteres.
              </p>
            </div>

            <div className="rounded-card border border-border bg-surface-elevated p-4 text-sm">
              <p className="font-medium text-text">Escreva com variações — não é enfeite</p>
              <p className="mt-1 text-text-muted">
                O WhatsApp bane número que manda texto idêntico em massa. Use chaves para dar
                opções: <code className="rounded bg-surface px-1">{"{Oi|Olá|Bom dia}"}</code> sorteia
                uma por pessoa. E <code className="rounded bg-surface px-1">{"{{nome}}"}</code>{" "}
                coloca o nome do contato.
              </p>
              <p className="mt-2 text-text-muted">
                Trocar só o nome não basta: a conferência do próximo passo diz se o texto passa.
              </p>
            </div>

            <p className="text-xs text-text-muted">
              A mídia (vídeo, áudio ou foto) você anexa depois de criar, na tela da campanha.
            </p>
          </div>
        ) : null}

        {/* ---------------- PASSO 3: revisão ---------------- */}
        {passo === 3 && resumo ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-card border border-border p-3">
                <p className="text-2xl font-semibold tabular-nums text-text">{resumo.aptos}</p>
                <p className="text-xs text-text-muted">vão receber</p>
              </div>
              <div className="rounded-card border border-border p-3">
                <p className="text-2xl font-semibold tabular-nums text-text">
                  {resumo.total - resumo.aptos}
                </p>
                <p className="text-xs text-text-muted">serão pulados</p>
              </div>
              <div className="rounded-card border border-border p-3">
                <p className="text-2xl font-semibold tabular-nums text-text">
                  {Math.max(1, Math.round(resumo.duracao_estimada_segundos / 60))}
                </p>
                <p className="text-xs text-text-muted">minutos, mais ou menos</p>
              </div>
            </div>

            {Object.keys(resumo.pulados).length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-card border border-border p-3">
                <p className="text-sm font-medium text-text">Quem não vai receber</p>
                {Object.entries(resumo.pulados).map(([motivo, quantos]) => (
                  <p key={motivo} className="text-xs text-text-muted">
                    <span className="font-medium tabular-nums text-text">{quantos}</span>{" "}
                    {fraseDoPulo(motivo)}
                  </p>
                ))}
              </div>
            ) : null}

            {resumo.variacao ? (
              <div
                className={cn(
                  "flex flex-col gap-2 rounded-card border p-3",
                  resumo.variacao.vai_ser_vetado ? "border-error bg-error-bg" : "border-border",
                )}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text">
                    {resumo.variacao.vai_ser_vetado
                      ? "O texto está repetitivo demais"
                      : "O texto varia o bastante"}
                  </p>
                  <Badge variant={resumo.variacao.vai_ser_vetado ? "error" : "success"}>
                    {resumo.variacao.variantes === 1
                      ? "1 versão"
                      : `${resumo.variacao.variantes} versões`}
                  </Badge>
                </div>
                {resumo.variacao.vai_ser_vetado ? (
                  <p className="text-xs text-error-fg">
                    Do jeito que está, a campanha para sozinha no{" "}
                    {resumo.variacao.envio_do_veto ?? 3}º envio para proteger seu número. Volte e
                    acrescente opções com {"{a|b|c}"} antes de criar.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {resumo.variacao.exemplos.map((ex, i) => (
                      <p key={i} className="truncate text-xs text-text-muted">
                        “{ex}”
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {resumo.amostra.length > 0 ? (
              <div className="flex flex-col gap-1 rounded-card border border-border p-3">
                <p className="text-sm font-medium text-text">Alguns que vão receber</p>
                {resumo.amostra.slice(0, 5).map((a, i) => (
                  <p key={i} className="truncate text-xs text-text-muted">
                    {a.nome ?? "Sem nome"} — {a.telefone ?? "sem telefone"}
                  </p>
                ))}
              </div>
            ) : null}

            {!temPublico ? (
              <p className="text-sm text-error-fg">
                Ninguém casou com esse filtro. Volte e afrouxe as opções.
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          {passo > 1 ? (
            <Button variant="ghost" onClick={() => setPasso((p) => (p === 3 ? 2 : 1))}>
              Voltar
            </Button>
          ) : null}
          {passo === 1 ? (
            <Button onClick={() => setPasso(2)}>Continuar</Button>
          ) : passo === 2 ? (
            <Button disabled={!texto.trim() || prever.isPending} onClick={revisar}>
              {prever.isPending ? "Conferindo…" : "Conferir"}
            </Button>
          ) : (
            <Button
              disabled={!temPublico || criar.isPending || resumo?.variacao?.vai_ser_vetado}
              onClick={criarRascunho}
            >
              {criar.isPending ? "Criando…" : "Criar rascunho"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
