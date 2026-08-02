"use client";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UploadSimple, Warning, CheckCircle } from "@/lib/ui/icons";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonoLabel } from "@/components/ui/mono-label";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { KaptarArquivoInvalido, parseKaptarCsv, resumoDeVenda, type KaptarLead } from "@/lib/import/kaptar";
import type { Stage } from "@/lib/kanban/types";

/**
 * Lote enviado por requisição. O teto do servidor é 250; 100 dá barra de
 * progresso que anda de verdade e mantém cada chamada folgada no timeout.
 */
const LOTE = 100;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pipelineId: string;
  stages: Stage[];
}

interface Ignorado {
  linha: number;
  nome: string;
  motivo: string;
}

interface Resultado {
  criados: number;
  ignorados: Ignorado[];
  falhas: Array<{ linha: number; nome: string; erro: string }>;
}

function etapaPadrao(stages: Stage[]): string {
  const aberta = stages.find((s) => !s.is_won && !s.is_lost && !s.is_archived);
  return aberta?.id ?? stages[0]?.id ?? "";
}

export function ImportKaptarDialog({ open, onOpenChange, pipelineId, stages }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [parse, setParse] = useState<ReturnType<typeof parseKaptarCsv> | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  const [stageId, setStageId] = useState<string>(() => etapaPadrao(stages));
  const [categoriasFora, setCategoriasFora] = useState<Set<string>>(new Set());
  const [apenasSemSite, setApenasSemSite] = useState(false);
  const [scoreMinimo, setScoreMinimo] = useState<number | null>(null);

  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  function reiniciar() {
    setNomeArquivo(null);
    setParse(null);
    setErroArquivo(null);
    setCategoriasFora(new Set());
    setApenasSemSite(false);
    setScoreMinimo(null);
    setProgresso(null);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function aoEscolherArquivo(file: File) {
    setErroArquivo(null);
    setResultado(null);
    setNomeArquivo(file.name);
    try {
      const texto = await file.text();
      const p = parseKaptarCsv(texto);
      setParse(p);
      // A faixa útil sai do arquivo, não de um 0–100 fixo: o Kaptar já entrega
      // a lista peneirada, e um mínimo abaixo do menor score não filtra nada.
      const scores = p.leads.map((l) => l.score).filter((s): s is number => s !== null);
      setScoreMinimo(scores.length ? Math.min(...scores) : null);
    } catch (err) {
      setParse(null);
      setErroArquivo(err instanceof KaptarArquivoInvalido ? err.message : (err as Error).message);
    }
  }

  const categorias = useMemo(() => {
    if (!parse) return [];
    const contagem = new Map<string, number>();
    for (const l of parse.leads) {
      const c = l.categoria ?? "(sem categoria)";
      contagem.set(c, (contagem.get(c) ?? 0) + 1);
    }
    return [...contagem].sort((a, b) => b[1] - a[1]);
  }, [parse]);

  const faixaScore = useMemo(() => {
    const scores = (parse?.leads ?? []).map((l) => l.score).filter((s): s is number => s !== null);
    if (!scores.length) return null;
    return { min: Math.min(...scores), max: Math.max(...scores) };
  }, [parse]);

  const selecionados = useMemo(() => {
    if (!parse) return [];
    return parse.leads.filter((l) => {
      if (apenasSemSite && l.temSite) return false;
      if (categoriasFora.has(l.categoria ?? "(sem categoria)")) return false;
      if (scoreMinimo !== null && l.score !== null && l.score < scoreMinimo) return false;
      return true;
    });
  }, [parse, apenasSemSite, categoriasFora, scoreMinimo]);

  function alternarCategoria(nome: string) {
    setCategoriasFora((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(nome)) proximo.delete(nome);
      else proximo.add(nome);
      return proximo;
    });
  }

  async function importar() {
    if (!selecionados.length || !stageId) return;

    const acumulado: Resultado = { criados: 0, ignorados: [], falhas: [] };
    setProgresso({ feitos: 0, total: selecionados.length });

    try {
      for (let i = 0; i < selecionados.length; i += LOTE) {
        const fatia = selecionados.slice(i, i + LOTE);
        const resp = await apiClient.post<{ data: Resultado }>(
          "/api/v1/leads/import/kaptar",
          { pipeline_id: pipelineId, stage_id: stageId, leads: fatia },
          // O padrão de 10s não cobre 100 gravações; cada lote tem folga real.
          { timeoutMs: 120_000 },
        );
        acumulado.criados += resp.data.criados;
        acumulado.ignorados.push(...resp.data.ignorados);
        acumulado.falhas.push(...resp.data.falhas);
        setProgresso({ feitos: Math.min(i + LOTE, selecionados.length), total: selecionados.length });
      }

      setResultado(acumulado);
      toast.success(
        acumulado.criados === 1 ? "1 lead importado." : `${acumulado.criados} leads importados.`,
      );
    } catch (err) {
      // Parcial não é perdido: o que já gravou continua no funil, e a dedup
      // impede que uma nova tentativa duplique.
      setResultado(acumulado);
      showApiError(err);
    } finally {
      setProgresso(null);
      qc.invalidateQueries({ queryKey: ["board", pipelineId] });
    }
  }

  const importando = progresso !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (importando) return; // fechar no meio da gravação confunde mais do que ajuda
        if (!v) reiniciar();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar leads do Kaptar</DialogTitle>
          <DialogDescription>
            Solte o CSV exportado do Kaptar. Nada é gravado até você conferir a prévia e confirmar.
          </DialogDescription>
        </DialogHeader>

        {/* ---------------------------------------------- resultado final */}
        {resultado ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-surface-elevated p-4">
              <CheckCircle size={24} weight="fill" className="shrink-0 text-accent-500" aria-hidden />
              <div>
                <p className="text-lg font-medium text-text tabular">
                  {resultado.criados.toLocaleString("pt-BR")}{" "}
                  {resultado.criados === 1 ? "lead criado" : "leads criados"}
                </p>
                <p className="text-sm text-text-muted">
                  {resultado.ignorados.length} já existiam · {resultado.falhas.length} com erro
                </p>
              </div>
            </div>

            {resultado.ignorados.length > 0 && (
              <div>
                <MonoLabel>// já existiam</MonoLabel>
                <ScrollArea className="mt-2 max-h-40 rounded-lg border border-border">
                  <ul className="divide-y divide-border text-sm">
                    {resultado.ignorados.map((ig) => (
                      <li key={`${ig.linha}-${ig.nome}`} className="flex gap-3 px-3 py-2">
                        <span className="w-12 shrink-0 text-text-subtle tabular">L{ig.linha}</span>
                        <span className="flex-1 truncate text-text">{ig.nome}</span>
                        <span className="shrink-0 text-text-muted">{ig.motivo}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}

            {resultado.falhas.length > 0 && (
              <div>
                <MonoLabel>// não entraram</MonoLabel>
                <ScrollArea className="mt-2 max-h-40 rounded-lg border border-danger-500/40">
                  <ul className="divide-y divide-border text-sm">
                    {resultado.falhas.map((f) => (
                      <li key={`${f.linha}-${f.nome}`} className="flex gap-3 px-3 py-2">
                        <span className="w-12 shrink-0 text-text-subtle tabular">L{f.linha}</span>
                        <span className="flex-1 truncate text-text">{f.nome}</span>
                        <span className="shrink-0 text-danger-500">{f.erro}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}

            <DialogFooter>
              <Button variant="secondary" onClick={reiniciar}>
                Importar outro arquivo
              </Button>
              <Button onClick={() => { reiniciar(); onOpenChange(false); }}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : !parse ? (
          /* ---------------------------------------------- escolher arquivo */
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface-elevated px-6 py-10 text-center transition-colors hover:border-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <UploadSimple size={32} className="text-text-muted" aria-hidden />
              <span className="text-sm text-text">
                {nomeArquivo ?? "Escolher o CSV exportado do Kaptar"}
              </span>
              <span className="text-xs text-text-subtle">
                O arquivo é lido no seu navegador. Nada sai daqui antes de você confirmar.
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void aoEscolherArquivo(f);
              }}
            />

            {erroArquivo && (
              <p className="flex items-start gap-2 text-sm text-danger-500">
                <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
                {erroArquivo}
              </p>
            )}
          </div>
        ) : (
          /* ---------------------------------------------- revisar e filtrar */
          <div className="space-y-5">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-surface-elevated p-3 text-sm">
              <span className="font-medium text-text">{nomeArquivo}</span>
              <span className="text-text-muted tabular">{parse.leads.length} aproveitáveis</span>
              {parse.rejeitadas.length > 0 && (
                <span className="text-text-muted tabular">{parse.rejeitadas.length} sem telefone ou inválidas</span>
              )}
            </div>

            {parse.colunasFaltando.length > 0 && (
              <p className="flex items-start gap-2 text-sm text-text-muted">
                <Warning size={16} className="mt-0.5 shrink-0" aria-hidden />
                O Kaptar não mandou {parse.colunasFaltando.join(", ")}. A importação segue sem esse contexto.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="etapa-destino">Etapa de destino</Label>
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger id="etapa-destino">
                  <SelectValue placeholder="Escolha a etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages
                    .filter((s) => !s.is_archived)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <Label htmlFor="so-sem-site" className="cursor-pointer">
                  Só quem não tem site
                </Label>
                <p className="text-xs text-text-subtle">
                  {parse.leads.filter((l) => !l.temSite).length} dos {parse.leads.length} não têm site
                </p>
              </div>
              <Switch id="so-sem-site" checked={apenasSemSite} onCheckedChange={setApenasSemSite} />
            </div>

            {faixaScore && faixaScore.min !== faixaScore.max && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="score-min">Score mínimo</Label>
                  <span className="text-sm text-text-muted tabular">{scoreMinimo}</span>
                </div>
                <input
                  id="score-min"
                  type="range"
                  min={faixaScore.min}
                  max={faixaScore.max}
                  value={scoreMinimo ?? faixaScore.min}
                  onChange={(e) => setScoreMinimo(Number(e.target.value))}
                  className="w-full accent-accent-500"
                />
                <p className="text-xs text-text-subtle">
                  Neste arquivo o score vai de {faixaScore.min} a {faixaScore.max} — o Kaptar já entregou a lista
                  peneirada.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Categorias</Label>
              <div className="flex flex-wrap gap-1.5">
                {categorias.map(([nome, n]) => {
                  const dentro = !categoriasFora.has(nome);
                  return (
                    <button key={nome} type="button" onClick={() => alternarCategoria(nome)}>
                      <Badge variant={dentro ? "default" : "outline"} className={dentro ? "" : "opacity-50"}>
                        {nome} · {n}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-text-subtle">Clique para tirar uma categoria da importação.</p>
            </div>

            <div>
              <MonoLabel>// prévia</MonoLabel>
              <ScrollArea className="mt-2 max-h-44 rounded-lg border border-border">
                <ul className="divide-y divide-border text-sm">
                  {selecionados.slice(0, 30).map((l: KaptarLead) => (
                    <li key={l.linha} className="px-3 py-2">
                      <p className="truncate text-text">{l.nome}</p>
                      <p className="text-xs text-text-muted">
                        {l.telefone} · {resumoDeVenda(l)}
                      </p>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>

            {progresso && (
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-pill bg-surface-elevated">
                  <div
                    className="h-full rounded-pill bg-accent-500 transition-[width]"
                    style={{ width: `${Math.round((progresso.feitos / progresso.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-text-muted tabular">
                  {progresso.feitos} de {progresso.total}
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="secondary" onClick={reiniciar} disabled={importando}>
                Trocar arquivo
              </Button>
              <Button onClick={() => void importar()} disabled={importando || selecionados.length === 0 || !stageId}>
                {importando
                  ? "Importando…"
                  : `Importar ${selecionados.length.toLocaleString("pt-BR")} ${selecionados.length === 1 ? "lead" : "leads"}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
