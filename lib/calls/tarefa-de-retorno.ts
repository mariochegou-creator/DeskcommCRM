/**
 * O retorno que o lead pediu na ligação virando TAREFA com hora na agenda do SDR.
 *
 * O buraco que isto fecha: em todo o CRM, tarefa só nascia quando um card mudava
 * de coluna (`lib/tarefas/criar-da-etapa.ts`, chamado pela rota de move e pelo
 * espelho do agente). Ligação não move card — então "me liga quinta de manhã"
 * ficava só como texto dentro da nota do negócio, e quem lembrava era o SDR, de
 * cabeça, no fim de um dia de ligações. O caderno manda confirmar o combinado em
 * voz alta; ninguém tinha mandado o CRM guardá-lo.
 *
 * MÓDULO PURO: não conhece banco nem Supabase, e `agora` entra por parâmetro —
 * mesmo padrão de `lib/tarefas/modelos-de-etapa.ts`. O worker grava; aqui só se
 * decide SE e COM QUE CARA.
 *
 * ⚠️ A decisão mais importante deste arquivo é RECUSAR. Um horário inventado
 * pelo modelo não custa uma tarefa errada: custa a confiança na lista inteira,
 * e uma lista em que o SDR não confia é uma lista que ele para de abrir — aí as
 * tarefas verdadeiras morrem junto. Por isso todo caso duvidoso devolve `null`,
 * e o combinado continua legível na nota do negócio, que não se perde.
 */
import {
  dataValida,
  horaValida,
  instanteDaReuniao,
  dataCivilBahia,
} from "@/lib/agendamento/reuniao";
import { MAX_TITULO, type TipoDeTarefa } from "@/lib/tarefas/tarefa";
import type { RetornoCombinado } from "@/lib/calls/analysis-schema";

/** O que o worker precisa para gravar a linha em `crm_tasks`. */
export interface TarefaDeRetorno {
  titulo: string;
  kind: TipoDeTarefa;
  prazo: Date;
  nota: string;
}

/**
 * Teto de 90 dias. Não é um número mágico de calendário: é o ponto em que um
 * erro do modelo deixa de parecer erro. "Me liga em março" com o ano trocado
 * produz uma data plausível, e a tarefa ficaria meses no fundo da lista sem
 * ninguém questionar. O que passa disto é bug, não combinado.
 */
const HORIZONTE_DIAS = 90;

/**
 * Folga de 5 minutos para trás.
 *
 * A análise roda alguns minutos depois de desligar, e um retorno pedido "daqui
 * a pouco" pode ter o horário já vencido quando o modelo responde. Recusar por
 * segundos jogaria fora justamente o caso mais urgente; a folga o mantém, e o
 * prazo nasce vencido — que é a verdade e aparece em vermelho na lista.
 */
const FOLGA_MS = 5 * 60 * 1000;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A data civil da Bahia do instante — usada para conferir que a data pedida
 * EXISTE. `dataValida` só olha o formato: "2026-02-31" passa nela e
 * `instanteDaReuniao` o transforma em 3 de março, calado. Uma tarefa três dias
 * fora do combinado é pior que nenhuma, porque parece certa.
 */
function voltaNaMesmaData(data: string, hora: string): boolean {
  return dataCivilBahia(instanteDaReuniao(data, hora)) === data;
}

/**
 * A tarefa de retorno, ou `null` quando não há combinado confiável.
 *
 * `nomeDoLead` entra no TÍTULO porque é ele que a aba Tarefas mostra em lista —
 * e é o mesmo texto que serve de trava contra duplicata quando a ligação é
 * analisada de novo (a mesma convenção de `tituloDaTarefa`).
 */
export function tarefaDeRetorno(
  retorno: RetornoCombinado | null | undefined,
  nomeDoLead: string | null,
  agora: Date,
): TarefaDeRetorno | null {
  if (!retorno) return null;

  const { data, hora } = retorno;
  if (!dataValida(data) || !horaValida(hora)) return null;
  if (!voltaNaMesmaData(data, hora)) return null;

  const prazo = instanteDaReuniao(data, hora);
  if (prazo.getTime() < agora.getTime() - FOLGA_MS) return null;
  if (prazo.getTime() > agora.getTime() + HORIZONTE_DIAS * DIA_MS) return null;

  const combinado = retorno.combinado.trim();
  if (combinado.length === 0) return null;

  const nome = (nomeDoLead ?? "").trim();
  const titulo = (nome.length > 0 ? `Retornar a ligação — ${nome}` : "Retornar a ligação").slice(
    0,
    MAX_TITULO,
  );

  return {
    titulo,
    kind: "ligar",
    prazo,
    nota: `O lead pediu: ${combinado}`,
  };
}
