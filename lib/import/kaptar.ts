/**
 * Importação de listas do Kaptar (prospecção em Google Maps) → leads do CRM.
 * Sem I/O — puro, testável. A rota (api/v1/leads/import/kaptar) faz o resto.
 *
 * O export do Kaptar tem três armadilhas que quebram parser ingênuo, e todas
 * estão cobertas aqui: separador `;`, BOM antes da primeira coluna, e telefone
 * mascarado sem código de país.
 */
import Papa from "papaparse";

import { GANCHO_KEY_RE } from "@/lib/leads/ganchos";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";

/** Cabeçalho do export do Kaptar, na ordem em que ele emite. */
export const KAPTAR_COLUNAS = [
  "Nome",
  "Categoria",
  "Telefone",
  "E-mail",
  "Site",
  "Tem site",
  "Instagram",
  "Tem Instagram",
  "Cidade",
  "Estado",
  "Status",
  "Tipo",
  "Score",
  "Avaliação",
  "Nº avaliações",
  "Fonte",
  "Google Maps",
  "Criado em",
] as const;

/**
 * Sem estas o registro não vira lead: nome dá o título do negócio e telefone é
 * o único canal (o Kaptar quase nunca traz e-mail). As outras 15 são contexto —
 * se o Kaptar mudar o export e alguma sumir, a importação segue sem ela.
 */
const COLUNAS_OBRIGATORIAS = ["Nome", "Telefone"] as const;

export interface KaptarLead {
  /** Linha no arquivo, 1-based, contando o cabeçalho — é o que o usuário vê no relatório de erro. */
  linha: number;
  nome: string;
  /** Identificador do Google Maps. Chave de deduplicação: telefone e nome mudam, este não. */
  placeId: string | null;
  /** E.164 com `+`, como o CHECK `contacts_phone_e164_format` exige. */
  telefone: string;
  email: string | null;
  site: string | null;
  instagram: string | null;
  /** Derivado da URL real, não da coluna "Tem site" — veja `classificarPresenca`. */
  temSite: boolean;
  categoria: string | null;
  cidade: string | null;
  estado: string | null;
  score: number | null;
  avaliacao: number | null;
  numAvaliacoes: number | null;
  criadoEm: string | null;
  /**
   * Ganchos de abertura da lista ENRIQUECIDA — colunas extras (fora do
   * contrato de 18) cujo cabeçalho case com GANCHO_KEY_RE. Viram
   * custom_fields `gancho_*` e chegam a quem atende via nota semeada na
   * conversa e painel do inbox. Lista sem enriquecer → array vazio.
   */
  ganchos: string[];
}

export interface KaptarRejeitada {
  linha: number;
  /** Melhor esforço para o usuário reconhecer a linha na planilha. */
  nome: string;
  motivo: string;
}

export interface KaptarParse {
  leads: KaptarLead[];
  rejeitadas: KaptarRejeitada[];
  /** Cabeçalho encontrado no arquivo, já sem BOM. */
  colunas: string[];
  /** Colunas do contrato do Kaptar que não vieram neste arquivo. */
  colunasFaltando: string[];
}

/** Erro de arquivo (não de linha): o CSV inteiro é inaproveitável. */
export class KaptarArquivoInvalido extends Error {}

/**
 * O Kaptar emite UTF-8 com BOM. Sem remover, a primeira coluna vira
 * `"﻿Nome"` e TODO lead sai sem nome — falha silenciosa, porque as outras
 * 17 colunas continuam funcionando e o estrago só aparece depois de importar.
 */
function removerBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * `https://www.google.com/maps/place/?q=place_id:ChIJk7FqsrdxSpMRMErXeCyiYV0`
 * → `ChIJk7FqsrdxSpMRMErXeCyiYV0`
 */
export function extrairPlaceId(url: unknown): string | null {
  if (typeof url !== "string") return null;
  return url.match(/place_id:([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

/**
 * O Kaptar emite decimal com PONTO (`4.6`). Aceita vírgula também porque
 * planilha reaberta no Excel pt-BR e salva de novo troca o separador — e o
 * repositório já tem um bug de dinheiro gravado 100x maior por causa disso
 * (commit 206797e8), então aqui não se assume o formato.
 */
export function parseDecimal(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseInteiro(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number.parseInt(raw.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** `27/07/2026` → `2026-07-27`. Devolve null em qualquer outro formato. */
export function parseDataBr(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  const d = new Date(`${ano}-${mes}-${dia}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejeita 31/02: o Date normaliza para 03/03 em silêncio.
  if (d.getUTCDate() !== Number(dia) || d.getUTCMonth() + 1 !== Number(mes)) return null;
  return `${ano}-${mes}-${dia}`;
}

/** Vazio vira null, nunca `""` — o CHECK `contacts_email_format` recusa string vazia. */
function textoOuNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function pareceInstagram(url: string): boolean {
  return /(^|\/\/|\.)instagram\.com\//i.test(url);
}

/**
 * O Kaptar às vezes põe a URL do Instagram na coluna `Site` e ainda marca
 * "Tem site: Sim" / "Tem Instagram: Não" — os dois errados na mesma linha.
 *
 * Isso não é um detalhe cosmético: "não tem site" é o gancho de venda da lista,
 * e confiar na coluna classifica como "já tem site" um negócio que só tem
 * Instagram. Por isso a presença sai da URL, não da coluna.
 */
export function classificarPresenca(
  siteRaw: unknown,
  instagramRaw: unknown,
): { site: string | null; instagram: string | null; temSite: boolean } {
  const siteBruto = textoOuNull(siteRaw);
  const instagramBruto = textoOuNull(instagramRaw);

  if (siteBruto && pareceInstagram(siteBruto)) {
    return { site: null, instagram: instagramBruto ?? siteBruto, temSite: false };
  }
  return { site: siteBruto, instagram: instagramBruto, temSite: siteBruto !== null };
}

/**
 * Detecta o separador olhando o cabeçalho. O Kaptar emite `;`, mas a mesma
 * planilha reaberta e salva no Excel em locale diferente sai com `,` — e o
 * usuário não tem como saber qual está na mão dele.
 */
function detectarSeparador(primeiraLinha: string): string {
  const pontoEVirgula = (primeiraLinha.match(/;/g) ?? []).length;
  const virgula = (primeiraLinha.match(/,/g) ?? []).length;
  return pontoEVirgula >= virgula ? ";" : ",";
}

export function parseKaptarCsv(conteudo: string): KaptarParse {
  const texto = removerBom(conteudo).trim();
  if (!texto) throw new KaptarArquivoInvalido("Arquivo vazio.");

  const separador = detectarSeparador(texto.slice(0, texto.indexOf("\n") + 1 || texto.length));

  const { data, meta } = Papa.parse<Record<string, string>>(texto, {
    header: true,
    delimiter: separador,
    skipEmptyLines: true,
    transformHeader: (h) => removerBom(h).trim(),
  });

  const colunas = (meta.fields ?? []).filter(Boolean);
  const faltandoObrigatorias = COLUNAS_OBRIGATORIAS.filter((c) => !colunas.includes(c));
  if (faltandoObrigatorias.length > 0) {
    throw new KaptarArquivoInvalido(
      `Não parece um export do Kaptar: faltam as colunas ${faltandoObrigatorias.join(", ")}. ` +
        `Encontrei: ${colunas.slice(0, 8).join(", ")}${colunas.length > 8 ? "…" : ""}.`,
    );
  }

  const colunasFaltando = KAPTAR_COLUNAS.filter((c) => !colunas.includes(c));

  // Colunas de gancho são EXTRAS ao contrato do Kaptar — entram quando a lista
  // foi enriquecida antes de subir. Sem acento no teste: "Gancho de abertura"
  // e "gancho_abertura" têm que casar igual.
  const colunasGancho = colunas.filter((c) =>
    GANCHO_KEY_RE.test(c.normalize("NFD").replace(/[̀-ͯ]/g, "")),
  );

  const leads: KaptarLead[] = [];
  const rejeitadas: KaptarRejeitada[] = [];
  // Dentro do próprio arquivo o Kaptar às vezes repete o mesmo estabelecimento.
  const placeIdsVistos = new Set<string>();
  const telefonesVistos = new Set<string>();

  data.forEach((registro, i) => {
    const linha = i + 2; // +1 pelo cabeçalho, +1 porque planilha conta de 1
    const nome = textoOuNull(registro["Nome"]) ?? "";

    if (!nome) {
      rejeitadas.push({ linha, nome: "(sem nome)", motivo: "Sem nome do estabelecimento." });
      return;
    }

    const telefone = normalizePhoneBR(registro["Telefone"]);
    if (!telefone) {
      const bruto = textoOuNull(registro["Telefone"]);
      rejeitadas.push({
        linha,
        nome,
        motivo: bruto ? `Telefone inválido: "${bruto}".` : "Sem telefone.",
      });
      return;
    }

    const placeId = extrairPlaceId(registro["Google Maps"]);

    if (placeId && placeIdsVistos.has(placeId)) {
      rejeitadas.push({ linha, nome, motivo: "Repetido dentro do próprio arquivo (mesmo local)." });
      return;
    }
    if (!placeId && telefonesVistos.has(telefone)) {
      rejeitadas.push({ linha, nome, motivo: "Repetido dentro do próprio arquivo (mesmo telefone)." });
      return;
    }
    if (placeId) placeIdsVistos.add(placeId);
    telefonesVistos.add(telefone);

    const { site, instagram, temSite } = classificarPresenca(registro["Site"], registro["Instagram"]);

    leads.push({
      linha,
      nome,
      placeId,
      telefone,
      email: textoOuNull(registro["E-mail"]),
      site,
      instagram,
      temSite,
      categoria: textoOuNull(registro["Categoria"]),
      cidade: textoOuNull(registro["Cidade"]),
      estado: textoOuNull(registro["Estado"]),
      score: parseInteiro(registro["Score"]),
      avaliacao: parseDecimal(registro["Avaliação"]),
      numAvaliacoes: parseInteiro(registro["Nº avaliações"]),
      criadoEm: parseDataBr(registro["Criado em"]),
      ganchos: colunasGancho
        .map((c) => textoOuNull(registro[c]))
        .filter((g): g is string => g !== null)
        .map((g) => g.slice(0, 2000)),
    });
  });

  return { leads, rejeitadas, colunas, colunasFaltando };
}

/**
 * Resumo de venda que vai para a descrição do negócio. É o mesmo texto que você
 * vinha escrevendo à mão ("sem site · 394 avaliações, nota 4.6 · score 55").
 */
export function resumoDeVenda(lead: KaptarLead): string {
  const partes: string[] = [];
  partes.push(lead.temSite ? "tem site" : "sem site");
  if (!lead.temSite && lead.instagram) partes.push("só Instagram");
  if (lead.numAvaliacoes !== null && lead.avaliacao !== null) {
    partes.push(`${lead.numAvaliacoes} avaliações, nota ${lead.avaliacao}`);
  }
  if (lead.score !== null) partes.push(`score ${lead.score}`);
  return partes.join(" · ");
}

/**
 * O que vai para `crm_leads.custom_fields`. Campo separado em vez de texto na
 * nota porque é isso que permite filtrar "esteticistas sem site em LEM" depois.
 */
export function camposPersonalizados(lead: KaptarLead): Record<string, string | number | boolean> {
  const campos: Record<string, string | number | boolean> = { tem_site: lead.temSite };
  if (lead.categoria) campos.categoria = lead.categoria;
  if (lead.cidade) campos.cidade = lead.cidade;
  if (lead.estado) campos.estado = lead.estado;
  if (lead.score !== null) campos.score_kaptar = lead.score;
  if (lead.avaliacao !== null) campos.avaliacao_google = lead.avaliacao;
  if (lead.numAvaliacoes !== null) campos.num_avaliacoes = lead.numAvaliacoes;
  if (lead.site) campos.site = lead.site;
  if (lead.instagram) campos.instagram = lead.instagram;
  if (lead.placeId) campos.place_id = lead.placeId;
  // Mesma convenção de chave da importação genérica (/api/v1/leads/import):
  // é o nome `gancho_*` que a nota semeada e o painel do inbox procuram.
  lead.ganchos.forEach((g, i) => {
    campos[i === 0 ? "gancho_abertura" : `gancho_${i + 1}`] = g;
  });
  return campos;
}
