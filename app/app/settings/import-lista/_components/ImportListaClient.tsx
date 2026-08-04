"use client";
/**
 * Upload da lista de prospecção: parseia o CSV aqui no navegador (o arquivo
 * nunca viaja cru), mostra o mapeamento de colunas detectado — corrigível —
 * e manda as linhas em lotes para POST /api/v1/leads/import.
 *
 * Papéis de coluna: a ferramenta de prospecção exporta com cabeçalhos
 * variados; a detecção cobre os nomes comuns e o usuário corrige o resto no
 * Select de cada coluna. Coluna "gancho" pode haver mais de uma — todas viram
 * custom_fields do lead.
 */
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api/client";
import { GANCHO_KEY_RE } from "@/lib/leads/ganchos";
import { usePipelines, usePipelineStages } from "@/hooks/webhooks/useWebhookSources";

type Papel = "negocio" | "dono" | "telefone" | "email" | "gancho" | "extra" | "ignorar";

const PAPEL_LABEL: Record<Papel, string> = {
  negocio: "Nome do negócio",
  dono: "Nome do dono",
  telefone: "Telefone / WhatsApp",
  email: "E-mail",
  gancho: "Gancho de abertura",
  extra: "Guardar como campo extra",
  ignorar: "Ignorar coluna",
};

interface ResultadoLinha {
  linha: number;
  status: "criado" | "repetido" | "erro";
  lead_id?: string;
  motivo?: string;
}

interface RespostaImport {
  data: { criados: number; repetidos: number; erros: number; resultados: ResultadoLinha[] };
}

const TAMANHO_LOTE = 25;

/* ------------------------------------------------------------------------ */
/* Parser CSV — delimitador sniffado na primeira linha, aspas duplas RFC.   */
/* ------------------------------------------------------------------------ */

function sniffDelimitador(primeiraLinha: string): string {
  const candidatos = [";", ",", "\t"];
  let melhor = ",";
  let melhorContagem = -1;
  for (const d of candidatos) {
    // Conta fora de aspas: "a;b","c" tem 1 ';' real, não 2.
    let dentroDeAspas = false;
    let contagem = 0;
    for (const ch of primeiraLinha) {
      if (ch === '"') dentroDeAspas = !dentroDeAspas;
      else if (ch === d && !dentroDeAspas) contagem++;
    }
    if (contagem > melhorContagem) {
      melhorContagem = contagem;
      melhor = d;
    }
  }
  return melhor;
}

function parseCsv(texto: string): string[][] {
  const semBom = texto.replace(/^﻿/, "");
  const primeiraQuebra = semBom.indexOf("\n");
  const delim = sniffDelimitador(
    primeiraQuebra === -1 ? semBom : semBom.slice(0, primeiraQuebra),
  );

  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroDeAspas = false;

  for (let i = 0; i < semBom.length; i++) {
    const ch = semBom[i]!;
    if (dentroDeAspas) {
      if (ch === '"') {
        if (semBom[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += ch;
      }
    } else if (ch === '"') {
      dentroDeAspas = true;
    } else if (ch === delim) {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && semBom[i + 1] === "\n") i++;
      linha.push(campo);
      campo = "";
      if (linha.some((c) => c.trim() !== "")) linhas.push(linha);
      linha = [];
    } else {
      campo += ch;
    }
  }
  linha.push(campo);
  if (linha.some((c) => c.trim() !== "")) linhas.push(linha);
  return linhas;
}

/* ------------------------------------------------------------------------ */
/* Detecção de papel por cabeçalho                                          */
/* ------------------------------------------------------------------------ */

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function detectarPapel(cabecalho: string): Papel {
  const h = semAcento(cabecalho.trim().toLowerCase());
  if (GANCHO_KEY_RE.test(h)) return "gancho";
  if (/dono|proprietari|responsav|owner|contato/.test(h)) return "dono";
  if (/negocio|empresa|estabelecimento|business|company|razao/.test(h)) return "negocio";
  if (/telefone|whatsapp|celular|fone|phone|numero|^tel$/.test(h)) return "telefone";
  if (/e-?mail/.test(h)) return "email";
  // "nome"/"name" solto é o nome do negócio nas listas de prospecção (o dono,
  // quando vem, vem nomeado como dono/proprietário).
  if (/^(nome|name)$/.test(h)) return "negocio";
  return "extra";
}

/* ------------------------------------------------------------------------ */

interface LinhaMontada {
  linhaArquivo: number;
  negocio: string;
  dono?: string;
  telefone?: string;
  email?: string;
  ganchos: string[];
  extras: Record<string, string>;
}

function montarLinhas(
  dados: string[][],
  cabecalhos: string[],
  papeis: Papel[],
): { linhas: LinhaMontada[]; puladas: number[] } {
  const idx = (papel: Papel) => papeis.map((p, i) => (p === papel ? i : -1)).filter((i) => i >= 0);
  const [iNegocio] = idx("negocio");
  const [iDono] = idx("dono");
  const [iTelefone] = idx("telefone");
  const [iEmail] = idx("email");
  const iGanchos = idx("gancho");
  const iExtras = idx("extra");

  const linhas: LinhaMontada[] = [];
  const puladas: number[] = [];

  dados.forEach((cells, i) => {
    const linhaArquivo = i + 2; // +1 do cabeçalho, +1 para base 1
    const valor = (j: number | undefined) =>
      j === undefined || j < 0 ? "" : (cells[j] ?? "").trim();

    const dono = valor(iDono);
    // Sem nome do negócio a linha não tem título de lead: cai para o dono e,
    // em último caso, o telefone — pior que importar torto é sumir com a linha.
    const negocio = valor(iNegocio) || dono || valor(iTelefone);
    if (!negocio) {
      puladas.push(linhaArquivo);
      return;
    }

    const extras: Record<string, string> = {};
    for (const j of iExtras) {
      const v = valor(j);
      if (v) extras[cabecalhos[j]?.trim() || `coluna_${j + 1}`] = v.slice(0, 2000);
    }

    linhas.push({
      linhaArquivo,
      negocio: negocio.slice(0, 200),
      dono: dono ? dono.slice(0, 200) : undefined,
      telefone: valor(iTelefone) ? valor(iTelefone).slice(0, 40) : undefined,
      email: valor(iEmail) ? valor(iEmail).slice(0, 320) : undefined,
      ganchos: iGanchos.map((j) => valor(j)).filter(Boolean).map((g) => g.slice(0, 2000)),
      extras,
    });
  });

  return { linhas, puladas };
}

/* ------------------------------------------------------------------------ */

export function ImportListaClient() {
  const [nomeArquivo, setNomeArquivo] = React.useState<string | null>(null);
  const [cabecalhos, setCabecalhos] = React.useState<string[]>([]);
  const [dados, setDados] = React.useState<string[][]>([]);
  const [papeis, setPapeis] = React.useState<Papel[]>([]);
  const [pipelineId, setPipelineId] = React.useState("");
  const [stageId, setStageId] = React.useState("");
  const [importando, setImportando] = React.useState(false);
  const [progresso, setProgresso] = React.useState(0);
  const [resultado, setResultado] = React.useState<{
    criados: number;
    repetidos: number;
    erros: ResultadoLinha[];
    puladas: number[];
  } | null>(null);

  const { data: pipelinesRes, isLoading: pipelinesLoading } = usePipelines();
  const { data: boardRes, isLoading: stagesLoading } = usePipelineStages(pipelineId || null);
  const pipelines = pipelinesRes?.data ?? [];
  const stages = boardRes?.data?.stages ?? [];

  React.useEffect(() => {
    setStageId("");
  }, [pipelineId]);

  const aoEscolherArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const texto = await file.text();
    const linhas = parseCsv(texto);
    if (linhas.length < 2) {
      toast.error("O arquivo precisa de um cabeçalho e ao menos uma linha de dados.");
      return;
    }
    const headers = linhas[0]!.map((h) => h.trim());
    setNomeArquivo(file.name);
    setCabecalhos(headers);
    setDados(linhas.slice(1));
    setPapeis(headers.map(detectarPapel));
    setResultado(null);
  };

  const temNegocio = papeis.includes("negocio");
  const temTelefone = papeis.includes("telefone");
  const temGancho = papeis.includes("gancho");

  const importar = async () => {
    if (!pipelineId || !stageId) {
      toast.error("Escolha o funil e o estágio de entrada.");
      return;
    }
    if (!temNegocio) {
      toast.error("Marque qual coluna é o nome do negócio.");
      return;
    }

    const { linhas, puladas } = montarLinhas(dados, cabecalhos, papeis);
    if (linhas.length === 0) {
      toast.error("Nenhuma linha aproveitável no arquivo.");
      return;
    }

    setImportando(true);
    setProgresso(0);
    let criados = 0;
    let repetidos = 0;
    const erros: ResultadoLinha[] = [];

    try {
      for (let inicio = 0; inicio < linhas.length; inicio += TAMANHO_LOTE) {
        const lote = linhas.slice(inicio, inicio + TAMANHO_LOTE);
        const res = await apiClient.post<RespostaImport>(
          "/api/v1/leads/import",
          {
            pipeline_id: pipelineId,
            stage_id: stageId,
            file_name: nomeArquivo ?? undefined,
            rows: lote.map(({ linhaArquivo: _l, ...row }) => row),
          },
          // Cada linha custa várias queries no servidor; o teto padrão de 10s
          // do apiClient derrubaria lotes cheios.
          { timeoutMs: 120_000 },
        );
        criados += res.data.criados;
        repetidos += res.data.repetidos;
        for (const r of res.data.resultados) {
          if (r.status !== "erro") continue;
          // r.linha é relativa ao lote; converte para a linha real do arquivo.
          erros.push({ ...r, linha: lote[r.linha - 1]?.linhaArquivo ?? r.linha });
        }
        setProgresso(Math.min(inicio + TAMANHO_LOTE, linhas.length));
      }
      setResultado({ criados, repetidos, erros, puladas });
      if (erros.length === 0) toast.success(`Lista importada: ${criados} lead(s) criados.`);
      else toast.warning(`Importação terminou com ${erros.length} erro(s).`);
    } catch {
      // Interrompe onde parou; o dedupe do servidor deixa reenviar o mesmo
      // arquivo sem duplicar o que já entrou.
      setResultado({ criados, repetidos, erros, puladas });
      toast.error("A importação parou no meio. Suba o mesmo arquivo de novo — o que já entrou não duplica.");
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="space-y-3 p-4">
        <Label htmlFor="arquivo-lista">Arquivo da lista (.csv)</Label>
        <input
          id="arquivo-lista"
          type="file"
          accept=".csv,text/csv"
          onChange={aoEscolherArquivo}
          disabled={importando}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:border-border-strong"
        />
        <p className="text-xs text-muted-foreground">
          Primeira linha = cabeçalho. Colunas de gancho de abertura são detectadas pelo nome
          (gancho, hook, abertura) e salvas no lead para quem atender.
        </p>
      </Card>

      {cabecalhos.length > 0 && (
        <>
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">
              Mapeamento das colunas{" "}
              <span className="font-normal text-muted-foreground">
                ({dados.length} linha{dados.length === 1 ? "" : "s"} de dados)
              </span>
            </h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {cabecalhos.map((h, i) => (
                <div key={`${h}-${i}`} className="flex items-center gap-2">
                  <span className="w-40 truncate text-xs font-medium" title={h}>
                    {h || `(coluna ${i + 1})`}
                  </span>
                  <Select
                    value={papeis[i]}
                    onValueChange={(v) =>
                      setPapeis((prev) => prev.map((p, j) => (j === i ? (v as Papel) : p)))
                    }
                    disabled={importando}
                  >
                    <SelectTrigger className="h-8 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAPEL_LABEL) as Papel[]).map((p) => (
                        <SelectItem key={p} value={p} className="text-xs">
                          {PAPEL_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {!temNegocio && (
              <p className="text-xs text-error-fg">
                Nenhuma coluna marcada como nome do negócio — marque uma para importar.
              </p>
            )}
            {!temTelefone && (
              <p className="text-xs text-warning-fg">
                Sem coluna de telefone os leads entram sem contato — não dá para abrir conversa no
                WhatsApp a partir deles.
              </p>
            )}
            {!temGancho && (
              <p className="text-xs text-warning-fg">
                Nenhuma coluna de gancho de abertura detectada. Se a lista tem os ganchos, marque a
                coluna certa acima.
              </p>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Prévia (primeiras linhas)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    {cabecalhos.map((h, i) => (
                      <th key={`${h}-${i}`} className="max-w-48 truncate px-2 py-1.5 font-medium">
                        {h || `(coluna ${i + 1})`}
                        <span className="block text-[10px] font-normal opacity-70">
                          {PAPEL_LABEL[papeis[i] ?? "extra"]}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dados.slice(0, 5).map((cells, i) => (
                    <tr key={i} className="border-b border-border/50 align-top">
                      {cabecalhos.map((_, j) => (
                        <td key={j} className="max-w-48 truncate px-2 py-1.5" title={cells[j]}>
                          {cells[j] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-4 p-4">
            <h2 className="text-sm font-semibold">Destino no CRM</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Funil de entrada</Label>
                <Select value={pipelineId} onValueChange={setPipelineId} disabled={pipelinesLoading || importando}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Estágio de entrada</Label>
                <Select
                  value={stageId}
                  onValueChange={setStageId}
                  disabled={!pipelineId || stagesLoading || importando}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={pipelineId ? "Escolha o estágio" : "Escolha o funil primeiro"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={importar} disabled={importando || !temNegocio}>
                {importando
                  ? `Importando… ${progresso}/${dados.length}`
                  : `Importar ${dados.length} linha${dados.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </Card>
        </>
      )}

      {resultado && (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Resultado</h2>
          <p className="text-sm">
            <span className="font-medium">{resultado.criados}</span> criados ·{" "}
            <span className="font-medium">{resultado.repetidos}</span> já existiam ·{" "}
            <span className="font-medium">{resultado.erros.length}</span> com erro
            {resultado.puladas.length > 0 && (
              <>
                {" "}
                · {resultado.puladas.length} linha(s) sem nome puladas (
                {resultado.puladas.slice(0, 10).join(", ")}
                {resultado.puladas.length > 10 ? "…" : ""})
              </>
            )}
          </p>
          {resultado.erros.length > 0 && (
            <ul className="space-y-1 text-xs text-error-fg">
              {resultado.erros.map((r) => (
                <li key={r.linha}>
                  Linha {r.linha} do arquivo: {r.motivo ?? "erro"}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Os leads estão no funil escolhido. Quando alguém abrir a conversa de um deles no inbox,
            os ganchos de abertura aparecem como nota interna e no painel do contato.
          </p>
        </Card>
      )}
    </div>
  );
}
