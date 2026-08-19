/**
 * O GRUPO DA REUNIÃO — o cerco que faz o lead aparecer.
 *
 * A confirmação e os dois lembretes (ver `mensagens.ts`) atacam o esquecimento.
 * Não atacam o outro motivo, que é maior: no privado, furar a reunião não custa
 * nada — ninguém vê. Num grupo com o closer, o time e o dono do negócio, furar
 * é uma decisão tomada na frente de três pessoas.
 *
 * Por isso o grupo não é "um canal a mais": ele é onde os MESMOS três textos
 * passam a sair. Mandar no grupo E no privado dobraria a mensagem e queimaria o
 * efeito; quem tem grupo recebe só pelo grupo.
 *
 * Onde mora: `crm_leads.custom_fields.grupo` — IRMÃO de `reuniao`, não filho.
 * A escolha é deliberada: o cron de lembretes lê a reunião com `lerReuniao` e
 * regrava `{ ...reuniao, avisos }`, então tudo que estiver DENTRO de `reuniao`
 * e fora da peneira daquela função é apagado em silêncio no primeiro lembrete
 * (foi o que quase aconteceu com `checklist`). Como irmão, o grupo sobrevive
 * também à remarcação, que zera `avisos` e recria o evento — e é o que se quer:
 * remarcar não desfaz o grupo, só muda a hora que ele repete.
 *
 * Módulo PURO. A criação de verdade está em `grupo-criar.ts`.
 */
import { chatIdDeTelefone } from "@/lib/waha/grupo";

/** O que fica gravado em `custom_fields.grupo`. */
export interface GrupoDaReuniao {
  /** Endereço do grupo no WhatsApp (`…@g.us`). É a chave de tudo. */
  chat_id: string;
  /** Nome como aparece no WhatsApp de todo mundo. */
  nome: string;
  /** A conversa do inbox que espelha o grupo. Null = criada sem espelho. */
  conversation_id: string | null;
  criado_em: string;
  criado_por?: string | null;
  /** Telefones E.164 convidados na criação (sem o número da própria sessão). */
  participantes: string[];
  /**
   * Quem o WhatsApp NÃO conseguiu adicionar. Quase sempre é privacidade de
   * grupo ("só quem eu conheço"): o grupo nasce sem a pessoa e ninguém percebe.
   */
  faltaram?: string[];
}

/**
 * Teto do nome do grupo. O WhatsApp aceita 100 caracteres; nome cortado no meio
 * de uma palavra parece erro de sistema, então corta-se no espaço mais próximo.
 */
export const LIMITE_NOME_DO_GRUPO = 100;

/** O prefixo é fixo de propósito: no celular do dono, ele identifica quem é. */
const PREFIXO_DO_GRUPO = "Nexo IA";

/**
 * "Nexo IA ✕ Pizzaria Dom Luigi".
 *
 * O nome do negócio vem DEPOIS do nosso porque a lista de conversas do
 * WhatsApp corta o fim: o dono precisa reconhecer de quem é o grupo pelo começo.
 */
export function nomeDoGrupo(negocio: string | null | undefined): string {
  const limpo = (negocio ?? "").trim().replace(/\s+/g, " ");
  if (!limpo) return PREFIXO_DO_GRUPO;
  const cheio = `${PREFIXO_DO_GRUPO} ✕ ${limpo}`;
  if (cheio.length <= LIMITE_NOME_DO_GRUPO) return cheio;
  const cortado = cheio.slice(0, LIMITE_NOME_DO_GRUPO);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  return (ultimoEspaco > PREFIXO_DO_GRUPO.length + 3 ? cortado.slice(0, ultimoEspaco) : cortado).trim();
}

export interface ParticipantesInput {
  /** Telefone do lead, como está no contato (E.164 ou não). */
  telefoneDoLead: string | null | undefined;
  /** O time — os mesmos destinatários do bom-dia (`sixty_day_brief`). */
  telefonesDaEquipe: Array<string | null | undefined>;
  /** O número da própria sessão WAHA. Entra como DONO, nunca como convidado. */
  telefoneDaSessao: string | null | undefined;
}

/**
 * A lista de convites, em chatId (`…@c.us`), sem repetição e sem o próprio
 * número.
 *
 * O lead vem PRIMEIRO por um motivo prático: se o WhatsApp cortar a criação por
 * limite, o participante que não pode faltar é ele. E o número da sessão é
 * excluído porque ele já é o dono — convidar a si mesmo volta como participante
 * que falhou, e faria o CRM avisar de um problema que não existe.
 *
 * A comparação é por DÍGITOS, não por string: o mesmo número aparece como
 * `+5575…` no contato e `5575…` na sessão, e comparar cru deixaria o dono
 * entrar duas vezes.
 */
export function participantesDoGrupo(input: ParticipantesInput): string[] {
  const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
  const proprio = soDigitos(input.telefoneDaSessao);

  const vistos = new Set<string>();
  const chatIds: string[] = [];

  for (const telefone of [input.telefoneDoLead, ...input.telefonesDaEquipe]) {
    const digitos = soDigitos(telefone);
    if (!digitos) continue;
    if (proprio && digitos === proprio) continue;
    if (vistos.has(digitos)) continue;
    const chatId = chatIdDeTelefone(digitos);
    if (!chatId) continue;
    vistos.add(digitos);
    chatIds.push(chatId);
  }
  return chatIds;
}

/** Lê `custom_fields.grupo` sem confiar no formato (jsonb → unknown). */
export function lerGrupo(customFields: unknown): GrupoDaReuniao | null {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return null;
  }
  const raw = (customFields as Record<string, unknown>)["grupo"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const chatId = typeof obj.chat_id === "string" ? obj.chat_id : null;
  // Sem endereço não há grupo: é registro quebrado, e tratá-lo como existente
  // faria o agendamento pular a criação e o lembrete não sair em lugar nenhum.
  if (!chatId || !chatId.endsWith("@g.us")) return null;

  const listaDeTexto = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  return {
    chat_id: chatId,
    nome: typeof obj.nome === "string" ? obj.nome : "",
    conversation_id: typeof obj.conversation_id === "string" ? obj.conversation_id : null,
    criado_em: typeof obj.criado_em === "string" ? obj.criado_em : "",
    criado_por: typeof obj.criado_por === "string" ? obj.criado_por : null,
    participantes: listaDeTexto(obj.participantes),
    faltaram: listaDeTexto(obj.faltaram),
  };
}

/**
 * O lead está pedindo para mudar (ou desmarcar) a reunião?
 *
 * ISTO É A ÚNICA COISA QUE A AUTOMAÇÃO LÊ NO GRUPO, e a régua é deliberadamente
 * apertada. O grupo tem três pessoas conversando; qualquer palavra solta que
 * dispare um robô produz o pior resultado possível — a Nexo respondendo torto
 * na frente do cliente, no canal criado justamente para mostrar organização.
 *
 * Por isso a regra é de FRASE, não de palavra: "não vou poder", "preciso
 * remarcar", "dá pra mudar". A lista de STOP (`lib/waha/opt-out.ts`) aprendeu
 * essa lição do jeito caro — busca de palavra solta bloqueou lead vivo porque a
 * frase dizia "antes de sair de casa".
 *
 * Falso NEGATIVO aqui é barato: a mensagem fica no inbox e um humano responde.
 * Falso positivo é que custa. Na dúvida, não casa.
 */
export function ehPedidoDeRemarcacao(texto: string | null | undefined): boolean {
  const t = (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (!t.trim()) return false;
  // Mensagem longa quase nunca é "não vou poder" — é conversa. E quanto mais
  // texto, maior a chance de a frase aparecer citada ou negada.
  if (t.length > 300) return false;

  const frases = [
    // "não vou" sozinho NÃO basta, e a lição custou um teste: "o cliente não
    // vou saber dizer" disparava a resposta automática. O que separa
    // indisponibilidade de conversa normal é o que vem DEPOIS do verbo.
    /\bnao (vou|vou conseguir|posso|consigo|conseguirei|conseguir) (poder|ir|participar|estar|comparecer|conseguir|atender|entrar)\b/,
    // "não posso nesse horário", "não vou amanhã" — o complemento é tempo.
    /\bnao (vou|posso|consigo) (mais )?(amanha|hoje|depois|nesse|neste|nessa|nesta|essa|esse)\b/,
    /\bnao (da|vai dar) (pra|para)\b/,
    // Resposta seca, no fim da mensagem: "não posso", "não vou".
    /\bnao (vou|posso|consigo|da)\s*[.!]*$/,
    /\b(preciso|precisava|queria|gostaria de|posso|podemos|da pra|tem como) (remarcar|adiar|mudar|trocar|passar|transferir|desmarcar|cancelar)\b/,
    /\b(vamos|vamo|bora) (remarcar|adiar|mudar)\b/,
    /\b(remarcar|adiar|desmarcar|cancelar) (a |essa |nossa )?(reuniao|conversa|call)\b/,
    // "problema" saiu da lista: "surgiu um problema no meu site" é o lead
    // contando a DOR dele, que é o assunto da reunião — responder "o Mario te
    // manda dois horários" ali é responder outra pergunta.
    /\b(surgiu|apareceu) (um |uma )?(imprevisto|compromisso|urgencia)\b/,
    // Precisa da preposição: "outro dia" solto aparece em "esse é outro dia que
    // eu atendo", que não é pedido de nada.
    /\b(pra|para|em|noutro) (outro|outra) (dia|hora|horario|semana)\b/,
    /\bfica pra (outro|outra|semana|depois)\b/,
    /\btem como (ser|marcar) (outro|outra|mais)\b/,
  ];
  return frases.some((re) => re.test(t));
}
