/**
 * Qual etapa do Kanban significa "reunião marcada".
 *
 * O gatilho do agendamento é o card entrar nessa coluna — e o CRM não pode
 * depender de UM slug fixo: o funil da NEXO tem `r1-agendada`/`r2-agendada`
 * hoje e vai ganhar "Raio-x marcado" no funil de 8 etapas (o de prospecção do
 * plano de 60 dias). Um `slug === "r1-agendada"` hard-coded morreria calado no
 * dia da troca — sem erro, só sem lembrete, que é exatamente o modo de falha
 * que este arquivo existe para evitar.
 *
 * A regra: o nome (ou slug) precisa dizer QUE reunião é **e** que ela está
 * MARCADA. "R1 feita" não dispara; "R1 agendada" dispara.
 *
 * Módulo puro — o board (para abrir o dialog) e a rota (para validar) usam a
 * mesma leitura.
 */
import type { TipoDeReuniao } from "./reuniao";

/** Sem acento, minúsculo, separadores virando espaço. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-_./]+/g, " ")
    .trim();
}

/** "marcada", "agendado", "a agendar" — qualquer flexão. */
const MARCADA_RE = /\b(agendad|marcad)/;

/** O tipo de reunião que o nome da etapa anuncia, ou null se não anuncia nenhum. */
function tipoNoTexto(normalizado: string): TipoDeReuniao | null {
  if (/\braio ?x\b/.test(normalizado)) return "raio-x";
  if (/\br2\b/.test(normalizado)) return "r2";
  if (/\br1\b/.test(normalizado)) return "r1";
  // "Reunião marcada" / "Diagnóstico agendado" sem numeral: é a primeira.
  if (/\b(reuniao|diagnostico)\b/.test(normalizado)) return "r1";
  return null;
}

export interface EtapaComNome {
  name?: string | null;
  slug?: string | null;
}

/**
 * O tipo de reunião que esta etapa agenda, ou `null` quando ela não é etapa de
 * agendamento. Nome e slug são olhados juntos: o slug é estável para máquina,
 * o nome é o que o humano renomeia na tela.
 */
export function tipoDeReuniaoDaEtapa(etapa: EtapaComNome): TipoDeReuniao | null {
  for (const bruto of [etapa.slug, etapa.name]) {
    if (!bruto) continue;
    const texto = normalizar(bruto);
    if (!MARCADA_RE.test(texto)) continue;
    const tipo = tipoNoTexto(texto);
    if (tipo) return tipo;
  }
  return null;
}

/** Açúcar para o board: esta coluna deve abrir o dialog de agendamento? */
export function etapaPedeAgendamento(etapa: EtapaComNome): boolean {
  return tipoDeReuniaoDaEtapa(etapa) !== null;
}
