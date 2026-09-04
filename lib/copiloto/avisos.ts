/**
 * O que o copiloto tem a dizer sobre a tela em que você está.
 *
 * ⚠️ NENHUMA REGRA AQUI CHAMA MODELO DE LINGUAGEM, e é a decisão de projeto que
 * define a coisa toda. O caminho óbvio — jogar o estado da tela num LLM e pedir
 * "o que é importante?" — custa a cada abertura de tela, responde diferente para
 * o mesmo estado, e não dá para testar. Estes avisos são contas: quantos leads
 * pararam naquela etapa, há quantas horas a conversa mais velha espera, se o
 * chip que cria o grupo caiu. Conta é de graça, é instantânea, é sempre igual e
 * cabe num teste. O modelo só teria lugar se um dia o copiloto passasse a
 * REDIGIR a mensagem — e aí o caminho é o da estrelinha, que já existe.
 *
 * ⚠️ TETO DE 3 AVISOS (fora as confirmações). Um painel com doze itens é a mesma
 * lista que a pessoa já não lê; o valor está em escolher, não em listar. O
 * `ordenar` corta.
 *
 * ⚠️ TODO AVISO CARREGA O NÚMERO que o gerou. "4 responderam e 0 receberam
 * vídeo" se confere em dois cliques; "detectamos uma oportunidade" não se
 * confere — e o que não se confere não se obedece.
 *
 * Este módulo é puro de propósito: recebe os sinais já contados e devolve texto.
 * Quem vai ao banco é `sinais.ts`.
 */

export type Tela = "inbox" | "kanban" | "conexoes" | "tarefas";

/**
 * `ok` não é aviso, é confirmação — e existe porque o silêncio não convence.
 * Copiloto que some quando está tudo certo faz a pessoa ir conferir do mesmo
 * jeito, e aí ele não economizou nada.
 */
export type Peso = "agir" | "atencao" | "nota" | "ok";

export interface Aviso {
  /**
   * Estável para a MESMA situação: é o que permite "Depois" silenciar este
   * aviso sem silenciar os outros. Não entra número no id — senão o aviso
   * dispensado volta amanhã só porque o contador mudou de 4 para 5.
   */
  id: string;
  peso: Peso;
  etiqueta: string;
  titulo: string;
  texto: string;
  acao?: { rotulo: string; href: string };
}

const ORDEM: Record<Peso, number> = { agir: 0, atencao: 1, nota: 2, ok: 3 };
export const TETO_DE_AVISOS = 3;

/** Ordena por urgência e corta em 3 — as confirmações passam por fora do teto. */
export function ordenar(avisos: Aviso[]): Aviso[] {
  const reais = avisos.filter((a) => a.peso !== "ok").sort((a, b) => ORDEM[a.peso] - ORDEM[b.peso]);
  const confirmacoes = avisos.filter((a) => a.peso === "ok");
  return [...reais.slice(0, TETO_DE_AVISOS), ...confirmacoes];
}

function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`;
}

/**
 * A janela do primeiro toque no nicho de buffets: segunda a quarta, de manhã.
 * De quinta a sábado o dono está operando festa — não lê, e quando lê responde
 * mal. É a única regra do copiloto que olha o relógio em vez do banco.
 */
export function janelaDeAbordagem(agora: Date): { boa: boolean; motivo: string } {
  const dia = agora.getDay();
  const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  if (dia >= 1 && dia <= 3) {
    return { boa: true, motivo: `Hoje é ${DIAS[dia]} — a janela boa do primeiro toque.` };
  }
  return {
    boa: false,
    motivo:
      dia === 0
        ? "Hoje é domingo. A próxima janela boa é segunda de manhã."
        : `Hoje é ${DIAS[dia]}, e de quinta a sábado o dono está operando festa. A próxima janela boa é segunda de manhã.`,
  };
}

/* ───────────────────────────── inbox ───────────────────────────── */

export interface SinaisDoInbox {
  naoLidas: number;
  /** Horas que a conversa não lida mais velha está esperando. */
  maisVelhaHoras: number;
  /** Leads na etapa "Respondeu" do funil padrão. */
  responderam: number;
  /** Leads na etapa do segundo toque ("Vídeo enviado"), se ela existir. */
  segundoToque: number | null;
  enviadasHoje: number;
  enviadasOntem: number;
}

export function avisosDoInbox(s: SinaisDoInbox): Aviso[] {
  const out: Aviso[] = [];

  // O degrau que existe e nunca foi usado. Vale mais que qualquer contagem de
  // não lidas: é o funil parando num lugar que ninguém olha.
  if (s.responderam > 0 && s.segundoToque === 0) {
    out.push({
      id: "inbox.segundo-toque-parado",
      peso: "agir",
      etiqueta: "agir hoje",
      titulo: "O segundo toque não saiu para ninguém",
      texto: `${plural(s.responderam, "lead respondeu", "leads responderam")} e a etapa seguinte do funil está com zero. Quem respondeu e não recebeu o próximo passo esfria sozinho.`,
      acao: { rotulo: "Ver quem respondeu", href: "/app/kanban" },
    });
  }

  // Uma semana parada é abandono, não fila.
  if (s.maisVelhaHoras >= 168) {
    const dias = Math.floor(s.maisVelhaHoras / 24);
    out.push({
      id: "inbox.espera-longa",
      peso: "atencao",
      etiqueta: "esperando",
      titulo: `Alguém espera resposta há ${plural(dias, "dia", "dias")}`,
      texto: `São ${plural(s.naoLidas, "conversa não lida", "conversas não lidas")} na fila, e a mais antiga está parada desde então. Responder ou encerrar tira as duas do caminho.`,
      acao: { rotulo: "Abrir a fila", href: "/app/inbox" },
    });
  }

  if (s.enviadasHoje === 0 && s.enviadasOntem > 0) {
    out.push({
      id: "inbox.silencio-hoje",
      peso: "nota",
      etiqueta: "volume",
      titulo: "Nenhuma mensagem saiu hoje",
      texto: `Ontem saíram ${s.enviadasOntem}. Não é erro do sistema — é o dia que ainda não começou.`,
    });
  }

  if (s.naoLidas === 0) {
    out.push({
      id: "inbox.fila-limpa",
      peso: "ok",
      etiqueta: "está certo",
      titulo: "Ninguém está esperando",
      texto: "Nenhuma conversa não lida na fila.",
    });
  }

  return ordenar(out);
}

/* ───────────────────────────── kanban ───────────────────────────── */

export interface EtapaDoFunil {
  nome: string;
  leads: number;
  /** Leads que não mudam de etapa há 3 dias ou mais. */
  parados: number;
}

export interface SinaisDoKanban {
  funil: string;
  etapas: EtapaDoFunil[];
  agora: Date;
}

/** Casa pelo nome porque é assim que o resto do CRM reconhece etapa (0101). */
function etapa(etapas: EtapaDoFunil[], ...nomes: string[]): EtapaDoFunil | undefined {
  const alvo = nomes.map((n) => n.toLowerCase());
  return etapas.find((e) => alvo.includes(e.nome.trim().toLowerCase()));
}

export function avisosDoKanban(s: SinaisDoKanban): Aviso[] {
  const out: Aviso[] = [];
  const respondeu = etapa(s.etapas, "Respondeu");
  const segundo = etapa(s.etapas, "Vídeo enviado", "Video enviado", "Ligação marcada");
  const aContatar = etapa(s.etapas, "A contatar");
  const investigacao = etapa(s.etapas, "Investigacao", "Investigação");

  if (respondeu && segundo && respondeu.leads > 0 && segundo.leads === 0) {
    out.push({
      id: "kanban.gargalo-segundo-toque",
      peso: "agir",
      etiqueta: "o gargalo",
      titulo: `A etapa “${segundo.nome}” nunca teve um lead`,
      texto: `${plural(respondeu.leads, "lead está", "leads estão")} em “${respondeu.nome}” e o degrau seguinte está vazio. O funil trava exatamente aí.`,
      acao: { rotulo: "Ver quem respondeu", href: "/app/kanban" },
    });
  }

  if (aContatar && aContatar.leads > 0) {
    const janela = janelaDeAbordagem(s.agora);
    out.push({
      id: "kanban.fila-sem-primeiro-toque",
      peso: janela.boa ? "atencao" : "nota",
      etiqueta: janela.boa ? "dá pra começar" : "fora da janela",
      titulo: `${plural(aContatar.leads, "lead nunca recebeu", "leads nunca receberam")} o primeiro toque`,
      texto: `Estão parados em “${aContatar.nome}”. ${janela.motivo}`,
      acao: janela.boa ? { rotulo: "Abrir a fila", href: "/app/kanban" } : undefined,
    });
  }

  // Parado dentro da etapa é diferente de fila: aqui o lead ANDOU e travou.
  const travados = s.etapas
    .filter((e) => e.parados >= 5 && e.nome.toLowerCase() !== "a contatar")
    .sort((a, b) => b.parados - a.parados)[0];
  if (travados) {
    out.push({
      id: "kanban.etapa-travada",
      peso: "atencao",
      etiqueta: "parados",
      titulo: `${plural(travados.parados, "lead está", "leads estão")} há 3 dias em “${travados.nome}”`,
      texto: "Card que não anda em três dias raramente anda sozinho no quarto.",
      acao: { rotulo: "Ver a etapa", href: "/app/kanban" },
    });
  }

  if (investigacao && investigacao.leads > 0) {
    out.push({
      id: "kanban.sem-whatsapp",
      peso: "nota",
      etiqueta: "bloqueado",
      titulo: `${plural(investigacao.leads, "lead está", "leads estão")} sem WhatsApp`,
      texto: `Ficam em “${investigacao.nome}” e não andam até alguém achar o número.`,
    });
  }

  return ordenar(out);
}

/* ─────────────────────────── conexões ─────────────────────────── */

export interface NumeroDeWhatsApp {
  rotulo: string;
  status: string;
  aiMode: "atendente" | "copiloto";
  aquecido: boolean;
  /** Este é o chip que abre o grupo do WhatsApp quando uma reunião é marcada. */
  ehChipDoGrupo: boolean;
}

export interface SinaisDasConexoes {
  numeros: NumeroDeWhatsApp[];
}

const CAIDO = new Set(["FAILED", "STOPPED"]);

export function avisosDasConexoes(s: SinaisDasConexoes): Aviso[] {
  const out: Aviso[] = [];
  const caidos = s.numeros.filter((n) => CAIDO.has(n.status));
  const chipDoGrupoCaiu = caidos.find((n) => n.ehChipDoGrupo);

  // O aviso não é "um número caiu" — é o que para de funcionar por causa disso.
  // Sem a consequência escrita, o cartão vermelho já estava na tela e ninguém agia.
  if (chipDoGrupoCaiu) {
    out.push({
      id: "conexoes.chip-do-grupo-caiu",
      peso: "agir",
      etiqueta: "quebra algo",
      titulo: "Marcar reunião parou de criar o grupo",
      texto: `O ${chipDoGrupoCaiu.rotulo} está fora do ar, e é por ele que o CRM abre o grupo do WhatsApp quando um card vai para reunião marcada. Enquanto não voltar, a reunião é marcada e o grupo não nasce.`,
      acao: { rotulo: "Reconectar", href: "/app/connections" },
    });
  } else if (caidos.length > 0) {
    out.push({
      id: "conexoes.numero-caiu",
      peso: "agir",
      etiqueta: "fora do ar",
      titulo: `${plural(caidos.length, "número está", "números estão")} fora do ar`,
      texto: `${caidos.map((n) => n.rotulo).join(", ")}. Mensagem que chegar neles não entra no CRM.`,
      acao: { rotulo: "Reconectar", href: "/app/connections" },
    });
  }

  const frios = s.numeros.filter((n) => !n.aquecido && !CAIDO.has(n.status));
  if (frios.length > 0) {
    out.push({
      id: "conexoes.aquecimento",
      peso: "atencao",
      etiqueta: "teto de envio",
      titulo: `${plural(frios.length, "número está", "números estão")} sem aquecimento concluído`,
      texto:
        "Chip sem cadastro completo trabalha com teto baixo de envios por dia, e o corte é silencioso: não aparece erro, a mensagem simplesmente não sai.",
      acao: { rotulo: "Ver proteção de envio", href: "/app/connections" },
    });
  }

  const falantes = s.numeros.filter((n) => n.aiMode === "atendente");
  if (falantes.length > 0) {
    out.push({
      id: "conexoes.ia-respondendo",
      peso: "atencao",
      etiqueta: "confira",
      titulo: `A IA responde o cliente sozinha em ${plural(falantes.length, "número", "números")}`,
      texto: `${falantes.map((n) => n.rotulo).join(", ")}. Se não foi de propósito, o switch do cartão volta para copiloto.`,
      acao: { rotulo: "Ver os cartões", href: "/app/connections" },
    });
  } else if (s.numeros.length > 0) {
    out.push({
      id: "conexoes.tudo-copiloto",
      peso: "ok",
      etiqueta: "está certo",
      titulo: "Nenhum número responde cliente sozinho",
      texto: `Os ${s.numeros.length} estão em copiloto: a IA lê e organiza, quem fala é você.`,
    });
  }

  return ordenar(out);
}

/* ──────────────────────────── tarefas ──────────────────────────── */

export interface SinaisDasTarefas {
  pendentes: number;
  vencidas: number;
  /** Dias desde o vencimento da tarefa vencida mais antiga. */
  maisVelhaDias: number | null;
}

export function avisosDasTarefas(s: SinaisDasTarefas): Aviso[] {
  const out: Aviso[] = [];

  // "Tudo vencido" é um sinal DIFERENTE de "esta tarefa venceu", e é o único que
  // a tela não consegue dar: quando todas as datas estão vermelhas, a cor parou
  // de significar alguma coisa.
  if (s.pendentes >= 5 && s.vencidas === s.pendentes) {
    out.push({
      id: "tarefas.lista-morta",
      peso: "agir",
      etiqueta: "lista morta",
      titulo: "Todas as tarefas estão vencidas",
      texto: `São ${s.pendentes}, nenhuma no prazo${
        s.maisVelhaDias ? `, e a mais velha venceu há ${plural(s.maisVelhaDias, "dia", "dias")}` : ""
      }. Uma lista em que tudo está vermelho não avisa mais nada.`,
      acao: { rotulo: "Revisar em bloco", href: "/app/tarefas" },
    });
  } else if (s.vencidas > 0) {
    out.push({
      id: "tarefas.vencidas",
      peso: "atencao",
      etiqueta: "vencidas",
      titulo: `${plural(s.vencidas, "tarefa passou", "tarefas passaram")} do prazo`,
      texto: `De ${plural(s.pendentes, "tarefa aberta", "tarefas abertas")}${
        s.maisVelhaDias ? `. A mais velha venceu há ${plural(s.maisVelhaDias, "dia", "dias")}` : ""
      }.`,
      acao: { rotulo: "Abrir as tarefas", href: "/app/tarefas" },
    });
  }

  if (s.pendentes === 0) {
    out.push({
      id: "tarefas.em-dia",
      peso: "ok",
      etiqueta: "está certo",
      titulo: "Nenhuma tarefa aberta",
      texto: "A lista está limpa.",
    });
  }

  return ordenar(out);
}
