/**
 * Os três textos que combatem o no-show, na ordem em que saem.
 *
 * O SDR marca e some; o dono do negócio marca porque é mais fácil dizer sim do
 * que dizer não; e no dia ele não aparece. Cada mensagem aqui existe para
 * fechar um desses furos, e a razão de cada uma está no comentário da função —
 * não é enfeite de copy, é a mecânica:
 *
 *  1. CONFIRMAÇÃO (no ato de marcar) — troca o "sim" de cortesia por um
 *     compromisso: pede resposta explícita, entrega uma micro-tarefa (o @ do
 *     Instagram) e devolve ao lead a saída honrosa de remarcar agora. Quem
 *     entrega a micro-tarefa aparece; quem ignora já avisou que vai furar.
 *  2. VÉSPERA (18h do dia anterior) — hora em que o dono organiza o dia
 *     seguinte. Diz que o trabalho JÁ FOI FEITO: desmarcar passa a ter custo.
 *  3. FINAL (~1h antes) — tira a reunião do esquecimento e diz exatamente o
 *     que vai acontecer, para ninguém ser pego no meio do balcão.
 *
 * Nenhuma promete resultado que a Nexo não vá entregar: o que elas afirmam é
 * que o diagnóstico foi preparado — e ele é, de fato, preparado antes da call.
 *
 * Módulo PURO: a rota (confirmação) e o cron (lembretes) montam o mesmo texto.
 */
import { formatarReuniao, ROTULO_DO_TIPO, type Reuniao } from "./reuniao";

export interface ContextoDaMensagem {
  /** Nome do contato como está no CRM. Só o primeiro nome é usado. */
  nomeDoContato?: string | null;
  /** Nome do negócio — o título do card ("Pizzaria Dom Luigi"). */
  negocio?: string | null;
  /** Quem conduz a reunião (o closer). Assina a confirmação. */
  quemConduz?: string | null;
}

/** Primeiro nome, capitalizado. Vazio quando o CRM não tem nome. */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? "").trim();
  if (!limpo) return "";
  const primeiro = limpo.split(/\s+/)[0]!;
  // Lista importada costuma vir em CAIXA ALTA; "OI, MARCOS" grita com o lead.
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

/** "Marcos, " quando há nome; "" quando não há — nunca "Olá cliente". */
function vocativo(nome: string | null | undefined): string {
  const p = primeiroNome(nome);
  return p ? `${p}, ` : "";
}

/**
 * Como o negócio entra na frase: "da Pizzaria X" quando o card tem título,
 * "do seu negócio" quando não tem. Sem isto, card sem nome vira "o diagnóstico
 * do o seu negócio".
 */
function doNegocio(negocio: string | null | undefined): string {
  const limpo = (negocio ?? "").trim();
  if (!limpo) return "do seu negócio";
  return `${feminino(limpo) ? "da" : "do"} ${limpo}`;
}

/** Idem, sem preposição: "a Pizzaria X" / "o seu negócio". */
function aoNegocio(negocio: string | null | undefined): string {
  const limpo = (negocio ?? "").trim();
  if (!limpo) return "o seu negócio";
  return `${feminino(limpo) ? "a" : "o"} ${limpo}`;
}

/**
 * Heurística de gênero pelo primeiro substantivo do nome fantasia. Erra menos
 * que fixar um artigo só, e é reversível: quem não gostar edita o texto da
 * mensagem, não a regra.
 */
function feminino(negocio: string): boolean {
  const primeira = negocio.trim().split(/\s+/)[0]!.toLowerCase();
  const conhecidos = [
    "pizzaria",
    "padaria",
    "clinica",
    "clínica",
    "loja",
    "barbearia",
    "oficina",
    "farmacia",
    "farmácia",
    "sorveteria",
    "lanchonete",
    "hamburgueria",
    "academia",
    "escola",
    "casa",
    "otica",
    "ótica",
    "distribuidora",
    "adega",
    "churrascaria",
    "confeitaria",
    "doceria",
    "cafeteria",
    "pousada",
    "imobiliaria",
    "imobiliária",
  ];
  if (conhecidos.includes(primeira)) return true;
  // "-a" final acerta a maioria do resto; "-ma" (clima, sistema) é a exceção
  // que aparece em nome de negócio com frequência suficiente pra valer a linha.
  return primeira.endsWith("a") && !primeira.endsWith("ma");
}

/**
 * Sai no instante em que o card entra na etapa de reunião marcada.
 *
 * As três alavancas, nesta ordem: repetir dia e hora por extenso (o lead
 * confirmou de cabeça, não anotou), pedir o @ (micro-compromisso), e oferecer
 * a devolução da vaga — que transforma o silêncio em decisão. Fecha com
 * pergunta fechada, porque mensagem sem pergunta não é respondida.
 */
export function mensagemDeConfirmacao(reuniao: Reuniao, ctx: ContextoDaMensagem): string {
  const q = formatarReuniao(new Date(reuniao.em));
  const assinatura = (ctx.quemConduz ?? "").trim();

  return [
    `${vocativo(ctx.nomeDoContato)}fechado! Ficou ${q.diaDaSemana} (${q.diaMes}) às ${q.hora}.`,
    "",
    `Vou preparar o diagnóstico ${doNegocio(ctx.negocio)} antes da nossa conversa — me manda o @ do Instagram que eu já deixo pronto pra você.`,
    "",
    "Uma coisa só: são poucas vagas de diagnóstico esse mês. Se esse horário não for bom, me avisa hoje que eu remarco e passo a vaga pra outro negócio. Combinado?",
    ...(assinatura ? ["", assinatura] : []),
  ].join("\n");
}

/**
 * 18h da véspera. Não pergunta "ainda está de pé?" e para por aí: diz que o
 * material já existe e pede uma resposta de uma palavra. Confirmação que exige
 * digitar frase não é respondida no fim do expediente.
 */
export function mensagemDaVespera(reuniao: Reuniao, ctx: ContextoDaMensagem): string {
  const q = formatarReuniao(new Date(reuniao.em));

  return [
    `${vocativo(ctx.nomeDoContato)}passando só pra confirmar a nossa conversa de amanhã (${q.diaMes}), às ${q.hora}.`,
    "",
    `Já levantei o que está acontecendo com ${aoNegocio(ctx.negocio)} — vou te mostrar onde você está perdendo cliente pro concorrente sem perceber. São 20 minutos, direto ao ponto.`,
    "",
    `Me responde só "sim" que eu confirmo o seu horário${reuniao.tipo === "r2" ? ` do ${ROTULO_DO_TIPO[reuniao.tipo]}` : ""}. Se precisar mudar, também tudo bem — só me fala hoje.`,
  ].join("\n");
}

/**
 * ~1h antes. Diz o canal e a duração: o dono do negócio fura muita reunião por
 * não saber se era ligação, vídeo, ou se ia tomar a tarde dele.
 *
 * O texto evita "daqui a exatamente 1 hora" de propósito — o cron tem
 * tolerância de atraso, e uma promessa de relógio que chega 40 minutos depois
 * queima a confiança antes da call começar.
 */
export function mensagemFinal(reuniao: Reuniao, ctx: ContextoDaMensagem): string {
  const q = formatarReuniao(new Date(reuniao.em));

  return [
    `${vocativo(ctx.nomeDoContato)}é hoje às ${q.hora} — daqui a pouco eu te chamo aqui mesmo no WhatsApp.`,
    "",
    `Separa 20 minutos num lugar que dê pra falar. Vou com o diagnóstico ${doNegocio(ctx.negocio)} na tela.`,
    "",
    "Até já!",
  ].join("\n");
}

/** O texto de cada lembrete, pela chave que o cron carrega. */
export const TEXTO_DO_LEMBRETE = {
  vespera: mensagemDaVespera,
  final: mensagemFinal,
} as const;

/* -------------------------------------------------------------------------
 * OS MESMOS TRÊS TEXTOS, NA VOZ DO GRUPO
 *
 * Não é enfeite: no privado quem escreve é o closer ("já levantei o que está
 * acontecendo"). No grupo o closer ESTÁ LENDO junto, e uma mensagem em primeira
 * pessoa saindo do número da empresa enquanto o Mario aparece na lista de
 * participantes é o tipo de detalhe que o dono do negócio percebe na hora — e
 * que transforma "eles são organizados" em "isso aí é robô".
 *
 * Então a assistente fala como assistente, e o closer é citado em terceira
 * pessoa. É também a decisão do Mario de 19/08/2026: a IA é ASSUMIDA. Vender IA
 * e esconder a IA é a contradição que custa a venda quando o cliente descobre.
 * ------------------------------------------------------------------------- */

/** Como a assistente se apresenta. Um nome só, em todos os textos do grupo. */
const ASSINATURA_DA_IA = "assistente da Nexo IA";

/** "o Mario" quando se sabe quem conduz; "o time" quando não se sabe. */
function quemVaiConduzir(quemConduz: string | null | undefined): string {
  const p = primeiroNome(quemConduz);
  return p ? `o ${p}` : "o time";
}

/**
 * A PRIMEIRA mensagem do grupo, logo depois de criá-lo.
 *
 * Faz quatro coisas e para. Cada uma paga uma parte do no-show:
 *  1. repete dia e hora por extenso — o lead confirmou de cabeça;
 *  2. diz quem é ela e quem vai conduzir — grupo sem dono vira grupo ignorado;
 *  3. explica por que o grupo existe, na linguagem dele ("não ter que procurar
 *     ninguém") — sem isso, um grupo criado do nada parece spam;
 *  4. pede UMA palavra de volta.
 *
 * O pedido único é deliberado. A versão do privado pede o @ do Instagram junto;
 * aqui não, porque a confirmação escrita NA FRENTE DO TIME é o compromisso que
 * o grupo inteiro existe para produzir, e dois pedidos numa mensagem só dividem
 * a resposta — a pessoa responde o mais fácil e ignora o outro. O @ o closer
 * pede depois, no meio da conversa.
 */
export function mensagemDeAberturaDoGrupo(reuniao: Reuniao, ctx: ContextoDaMensagem): string {
  const q = formatarReuniao(new Date(reuniao.em));
  const conduz = quemVaiConduzir(ctx.quemConduz);

  return [
    `${vocativo(ctx.nomeDoContato)}tudo certo. Sua conversa com a Nexo ficou ${q.diaDaSemana} (${q.diaMes}) às ${q.hora}.`,
    "",
    `Sou a ${ASSINATURA_DA_IA}. Quem vai conversar com você é ${conduz} — ele já está levantando o que está acontecendo com ${aoNegocio(ctx.negocio)} pra te mostrar no dia.`,
    "",
    "Criei esse grupo pra você não ter que procurar ninguém. Qualquer coisa antes do dia, é só falar aqui.",
    "",
    'Uma coisa só: me responde "confirmado" que eu travo esse horário?',
  ].join("\n");
}

/** 18h da véspera, no grupo. Mesma mecânica do privado, na voz da assistente. */
export function mensagemDaVesperaNoGrupo(reuniao: Reuniao, ctx: ContextoDaMensagem): string {
  const q = formatarReuniao(new Date(reuniao.em));
  const conduz = quemVaiConduzir(ctx.quemConduz);

  return [
    `${vocativo(ctx.nomeDoContato)}amanhã às ${q.hora} — passando pra confirmar.`,
    "",
    `${conduz.charAt(0).toUpperCase() + conduz.slice(1)} já separou o que levantou ${doNegocio(ctx.negocio)} pra te mostrar. São 20 minutos, direto ao ponto.`,
    "",
    'Me responde "sim" que eu confirmo com ele. Se precisar mudar, fala hoje que a gente ajeita.',
  ].join("\n");
}

/** ~1h antes, no grupo. */
export function mensagemFinalNoGrupo(reuniao: Reuniao, ctx: ContextoDaMensagem): string {
  const q = formatarReuniao(new Date(reuniao.em));
  const conduz = quemVaiConduzir(ctx.quemConduz);

  return [
    `${vocativo(ctx.nomeDoContato)}é hoje às ${q.hora}. ${conduz.charAt(0).toUpperCase() + conduz.slice(1)} te chama aqui daqui a pouco.`,
    "",
    "Separa 20 minutos num lugar que dê pra falar.",
  ].join("\n");
}

/** O texto de cada lembrete quando o lead tem grupo. */
export const TEXTO_DO_LEMBRETE_NO_GRUPO = {
  vespera: mensagemDaVesperaNoGrupo,
  final: mensagemFinalNoGrupo,
} as const;

/**
 * A ÚNICA resposta que a automação dá a algo que o lead escreveu.
 *
 * Sai quando `ehPedidoDeRemarcacao` casa (ver `lib/agendamento/grupo.ts`), e
 * NÃO oferece horário nenhum de propósito. Oferecer slots parece melhor e é
 * pior: o lead responde "quinta às 14h", ninguém do outro lado entende a
 * escolha (isto é texto montado em código, não IA), e a conversa morre num
 * beco com o lead achando que remarcou. Acusar o recebimento e entregar a um
 * humano em seguida é mais lento no papel e mais rápido na prática.
 *
 * A última linha é a que faz o trabalho: reenquadra de "cancelei" para "mudei o
 * dia". Sem ela, "sem problema" soa como permissão para sumir.
 */
export function mensagemDeRemarcacaoNoGrupo(ctx: ContextoDaMensagem): string {
  const conduz = quemVaiConduzir(ctx.quemConduz);

  return [
    `${vocativo(ctx.nomeDoContato)}sem problema — acontece.`,
    "",
    `Já avisei ${conduz} aqui. Ele te manda dois horários novos pra você escolher.`,
    "",
    `A conversa sobre ${aoNegocio(ctx.negocio)} continua de pé, só muda o dia.`,
  ].join("\n");
}

/**
 * O aviso INTERNO de 30 min antes — vai pro WhatsApp do Mario (e de quem mais
 * recebe o bom-dia), nunca pro lead. Pedido do Mario em 19/08/2026: os
 * lembretes do anti-no-show cutucavam o lead e ninguém cutucava o closer.
 *
 * Direto de propósito: quem lê está no meio de outra coisa; nome do negócio,
 * hora e contato — o resto está na Sala de Reuniões.
 */
export function mensagemDaEquipe(reuniao: Reuniao, ctx: ContextoDaMensagem): string {
  const q = formatarReuniao(new Date(reuniao.em));
  const nome = primeiroNome(ctx.nomeDoContato);
  const linha1 = `Reunião em meia hora: ${ROTULO_DO_TIPO[reuniao.tipo]} com ${
    (ctx.negocio ?? "").trim() || "(card sem nome)"
  }, às ${q.hora}.`;
  const linha2 = `${nome ? `Contato: ${nome}. ` : ""}O preparo está na Sala de Reuniões.`;
  return [linha1, linha2].join("\n");
}
