/**
 * O prompt da análise pós-reunião — destilado do Passo 4 (coaching) da skill
 * /r1 e do MODO 2 + checklist de Pits da skill /r2. Roda no Sonnet, uma vez
 * por reunião, via worker.
 */
import type { MeetingTurn, MeetingType } from "@/lib/sala-reunioes/vocabulary";

const SAIDA = `
FORMATO DE SAÍDA — responda APENAS este objeto JSON, sem markdown:
{
  "resultado": "pedido" | "avanco" | "continuacao" | "nao_venda",
  "nota_geral": 0-10,
  "resumo": "3 a 5 linhas: o que era a reunião, o que o cliente revelou, como terminou",
  "fases": [{ "fase": "...", "nota": 0-10, "comentario": "uma frase objetiva" }],
  "coaching": {
    "acertos": ["..."],
    "melhorias": ["..."],
    "perguntas_que_faltaram": ["pergunta pronta, citando um dado REAL da transcrição"]
  },
  "sugestoes": [{ "n": 1, "seguiu": true }]
}
Regras do JSON:
- "fases": só as fases que de fato ocorreram na conversa, com o vocabulário exato dado.
- "resultado" (taxonomia de Rackham): "pedido" = fechou/comprou; "avanco" = próximo passo CONCRETO E DATADO; "continuacao" = interesse vago sem data ("vou pensar") — quase um não; "nao_venda" = recusa.
- "sugestoes": para CADA sugestão numerada da lista fornecida, diga se o vendedor usou aquela pergunta (ou uma equivalente em substância) nos turnos SEGUINTES ao momento dela. Julgue pela substância, não pelas palavras exatas.
- "perguntas_que_faltaram": no máximo 3, cada uma referenciando literalmente um número/fato que o cliente disse — nunca template genérico.
- Sem texto fora do JSON.`;

const CRITERIOS_R1 = `A reunião é uma R1 — diagnóstico SPIN com dono de negócio local de cidade pequena. Avalie a CONDUTA DO VENDEDOR contra estes critérios objetivos (não é opinião solta, é checklist):

- situacao: coletou UM número mensurável + a meta declarada? Estourou o teto de 5-6 perguntas? Dado de curiosidade que não abriu problema nenhum conta contra.
- problema: as perguntas usaram o formato comparativo obrigatório ("Com [dado], dá pra chegar em [meta]?") ou foram genéricas ("quais desafios?")? Pergunta genérica que gerou resposta boa saiu por sorte, não por técnica — nota baixa mesmo assim.
- implicacao (a fase que MAIS pesa na nota geral): cada problema confirmado foi traduzido em R$ (gap × ticket médio × meses)? Faltou componente da fórmula (ticket, tempo do problema)? A implicação ficou abstrata ("isso te incomoda?") em vez de custo presente ("isso já custou X")? A pergunta citou dado real da conversa ou foi decorada? Se foi tentada sem rapport/credibilidade antes, o defeito é de sequência, não de pergunta.
- necessidade: apareceu o contraste dos DOIS cenários (se nada mudar × projeção vívida do ideal) ou virou lista de benefícios? O cliente chegou a articular o ganho com a própria voz?
- fechamento: saiu com avanço DATADO (R2 marcada) ou com "vou pensar" sem data?
- Regra de ouro: solução/preço apresentados antes de implicação desenvolvida = defeito grave, derruba a nota geral.`;

const CRITERIOS_R2 = `A reunião é uma R2 — apresentação de proposta e fechamento pela metodologia de Pits. Avalie a CONDUTA DO VENDEDOR contra o checklist objetivo de execução:

- diagnostico: devolveu as dores da R1 nas palavras do cliente e o fez reconfirmar e dimensionar? Dá pra perceber que ele guardou dados específicos (números, prazos, nomes)?
- objecoes: pagamento, decisor(es) e urgência real foram sondados ANTES da apresentação, ou só apareceram como objeção reativa no fim?
- pit1: a escala 0-10 apareceu? E o "por que [nota] e não menos?" veio LOGO EM SEGUIDA? Escala sem o porquê = Pit 1 incompleto (a pergunta que importa é a segunda).
- extracao: perguntou "quanto você se programou pra investir" (nunca "quanto custa")? Se o cliente desviou, insistiu com educação (2-3 ângulos) ou desistiu na primeira?
- pit2: a apresentação reapresentou as dores DELE, na ordem de prioridade DELE, amarrando cada entrega a uma dor dita — ou despejou lista genérica de entregáveis? O preço foi TIER ÚNICO compatível com o extraído, ancorado no custo do problema — ou cardápio de opções?
- fechamento: saiu natural (consequência de Pit 1 + extração bem feitos) ou dependeu de pressão? Saiu com data de decisão?
- Defeito GRAVE (sempre citar em melhorias se ocorrer): escassez artificial ("só até amanhã", desconto-relâmpago, última vaga) em negociação de ticket alto — a urgência certa vem do custo do problema, nunca de prazo inventado. Também grave: preço revelado antes da extração.`;

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function buildMeetingAnalysisPrompt(opts: {
  meetingType: MeetingType;
  turns: MeetingTurn[];
  suggestions: Array<{ at_seconds: number; suggestion: string }>;
}): string {
  const criterios = opts.meetingType === "r1" ? CRITERIOS_R1 : CRITERIOS_R2;

  const transcricao = opts.turns
    .map((t) => `[${formatClock(t.t)}] ${t.is_self ? "VENDEDOR" : `LEAD (${t.speaker})`}: ${t.text}`)
    .join("\n");

  const sugestoes =
    opts.suggestions.length > 0
      ? opts.suggestions
          .map((s, idx) => `${idx + 1}. [${formatClock(Number(s.at_seconds))}] ${s.suggestion}`)
          .join("\n")
      : "(nenhuma sugestão foi exibida nesta reunião)";

  return `Você é o coach de vendas da Nexo IA. Analise a transcrição abaixo e devolva a avaliação em JSON.

${criterios}

Notas: 0-10 por fase, honestas — 7+ só quando o critério foi cumprido de verdade. A nota geral pondera as fases pelo peso do método (na R1, implicação pesa mais; na R2, pit1 + extração pesam mais). Nunca invente dado que não está na transcrição — se um componente falta (ticket médio, tempo do problema), diga ISSO no comentário em vez de estimar.

SUGESTÕES QUE O COPILOTO EXIBIU AO VENDEDOR DURANTE A CALL (numeradas):
${sugestoes}

TRANSCRIÇÃO:
${transcricao}
${SAIDA}`;
}

/** Acréscimo da segunda tentativa quando a primeira não devolveu JSON válido. */
export const ANALYSIS_RETRY_DE_FORMATO =
  "\n\nATENÇÃO: sua resposta anterior não era JSON válido. Responda APENAS com o objeto JSON, começando em { e terminando em }, sem markdown, sem cercas de código e sem nenhum texto antes ou depois.";
