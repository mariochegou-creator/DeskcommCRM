/**
 * Dados de demonstração da NEXO IA.
 *
 * Modela a operação real da agência (funil SPIN: Captação → R1 → APN → R2 →
 * Follow-up) com negócios locais como clientes, pra dar pra ver como o CRM
 * fica preenchido antes de decidir se serve.
 *
 * Tudo aqui é FICÇÃO. Telefones usam a faixa +5511 9xxxx reservada a exemplos
 * e não pertencem a ninguém.
 */

/** Marca de água: é por ela que o botão "Limpar" sabe o que apagar. */
export const MARCA_DEMO = "nexo-demo";

export const PIPELINE = {
  nome: "Funil NEXO IA",
  slug: "funil-nexo-ia",
} as const;

/** Cores e ordem espelham `funil_etapas` do dashboard atual da NEXO IA. */
export const ETAPAS = [
  { nome: "Captação", slug: "captacao", cor: "#7b5ccc", hint: "new" },
  { nome: "R1 agendada", slug: "r1-agendada", cor: "#a78bfa", hint: "contacted" },
  { nome: "R1 feita", slug: "r1-feita", cor: "#8b5cf6", hint: "qualifying" },
  { nome: "APN enviada", slug: "apn-enviada", cor: "#f97316", hint: "qualified" },
  { nome: "R2 agendada", slug: "r2-agendada", cor: "#f59e0b", hint: null },
  { nome: "R2 feita", slug: "r2-feita", cor: "#eab308", hint: "negotiating" },
  { nome: "Follow-up", slug: "follow-up", cor: "#06b6d4", hint: null },
  { nome: "Fechado", slug: "fechado", cor: "#22c55e", hint: "won", ganho: true },
  { nome: "Perdido", slug: "perdido", cor: "#3f5070", hint: "lost", perdido: true },
] as const;

export const AGENTE = {
  nome: "Atendente NEXO IA (demo)",
  descricao: "Qualifica lead que chega pelo WhatsApp e agenda a R1.",
  prompt:
    "Você atende negócios locais interessados em IA. Descubra o segmento, o " +
    "tamanho da operação e a dor principal. Nunca fale de preço — seu objetivo " +
    "é agendar a reunião de diagnóstico (R1).",
} as const;

export interface Negocio {
  nome: string;
  contato: string;
  telefone: string;
  email: string | null;
  cidade: string;
  segmento: string;
  etapa: (typeof ETAPAS)[number]["slug"];
  /** Valor em reais; convertido para centavos na gravação. */
  valor: number | null;
  /** Dono do card: 'ia' mostra o anel; 'humano' mostra o disco cheio. */
  dono: "ia" | "humano";
  /** Dias desde a última interação real — alimenta o radar de esfriamento. */
  diasParado: number;
  /** Score 0-100 com as parcelas que o justificam. */
  score?: {
    valor: number;
    razao: string;
    fatores: { pontos: number; frase: string }[];
  };
  /** Só para a etapa Perdido. */
  motivoPerda?: string;
  /** Anotação que aparece na timeline. */
  nota?: string;
}

export const NEGOCIOS: Negocio[] = [
  // ── Captação ──────────────────────────────────────────────────────────────
  {
    nome: "Pizzaria La Pizza",
    contato: "Rodrigo Menezes",
    telefone: "+5511987650001",
    email: "contato@lapizza.exemplo.br",
    cidade: "Itapevi",
    segmento: "Restaurante / delivery",
    etapa: "captacao",
    valor: null,
    dono: "ia",
    diasParado: 1,
    score: {
      valor: 42,
      razao: "Respondeu rápido e disse o segmento, mas ainda não revelou volume nem orçamento.",
      fatores: [
        { pontos: 20, frase: "Respondeu em menos de 5 minutos" },
        { pontos: 15, frase: "Informou o segmento sem ser perguntado" },
        { pontos: 7, frase: "Perguntou como funciona (interesse ativo)" },
      ],
    },
    nota: "Chegou pelo Instagram. Reclamou que perde pedido no horário de pico.",
  },
  {
    nome: "Barbearia do Gu",
    contato: "Gustavo Prado",
    telefone: "+5511987650002",
    email: null,
    cidade: "Cotia",
    segmento: "Barbearia",
    etapa: "captacao",
    valor: null,
    dono: "ia",
    diasParado: 3,
    score: {
      valor: 28,
      razao: "Só cumprimentou e não voltou. Sem qualificação nenhuma até agora.",
      fatores: [
        { pontos: 10, frase: "Iniciou a conversa por conta própria" },
        { pontos: 18, frase: "Não respondeu à pergunta de qualificação" },
      ],
    },
  },
  {
    nome: "Petshop Amigo Fiel",
    contato: "Carla Bertoni",
    telefone: "+5511987650003",
    email: "carla@amigofiel.exemplo.br",
    cidade: "Vargem Grande Paulista",
    segmento: "Petshop",
    etapa: "captacao",
    valor: null,
    dono: "humano",
    diasParado: 0,
    nota: "Indicação da Barbearia do Gu. Já sabe o que quer: agendamento automático.",
  },

  // ── R1 agendada ───────────────────────────────────────────────────────────
  {
    nome: "Clínica Odonto Sorriso",
    contato: "Dra. Helena Vasques",
    telefone: "+5511987650004",
    email: "helena@odontosorriso.exemplo.br",
    cidade: "Itapevi",
    segmento: "Clínica odontológica",
    etapa: "r1-agendada",
    valor: 2400,
    dono: "humano",
    diasParado: 2,
    score: {
      valor: 71,
      razao: "R1 marcada com data confirmada, decisora é a própria dona e citou perda de paciente por falta de retorno.",
      fatores: [
        { pontos: 30, frase: "R1 confirmada com data e hora" },
        { pontos: 25, frase: "Falando direto com quem decide" },
        { pontos: 16, frase: "Nomeou a dor: paciente que não recebe retorno" },
      ],
    },
    nota: "R1 quinta 15h. Quer entender custo antes — não abrir preço na R1.",
  },
  {
    nome: "Auto Center Faria",
    contato: "Sérgio Faria",
    telefone: "+5511987650005",
    email: null,
    cidade: "Jandira",
    segmento: "Oficina mecânica",
    etapa: "r1-agendada",
    valor: 1800,
    dono: "ia",
    diasParado: 4,
    score: {
      valor: 55,
      razao: "Aceitou a R1 mas não confirmou depois do lembrete; risco de não aparecer.",
      fatores: [
        { pontos: 30, frase: "Aceitou agendar a R1" },
        { pontos: 25, frase: "Não confirmou presença após o lembrete" },
      ],
    },
  },

  // ── R1 feita ──────────────────────────────────────────────────────────────
  {
    nome: "Mercado Bom Preço",
    contato: "Antônio Ribeiro",
    telefone: "+5511987650006",
    email: "antonio@bompreco.exemplo.br",
    cidade: "Cotia",
    segmento: "Mercado de bairro",
    etapa: "r1-feita",
    valor: 3200,
    dono: "humano",
    diasParado: 2,
    score: {
      valor: 78,
      razao: "Diagnóstico completo na R1, quantificou a perda em R$ 8 mil/mês e pediu a proposta.",
      fatores: [
        { pontos: 30, frase: "R1 realizada com diagnóstico completo" },
        { pontos: 28, frase: "Quantificou a perda: R$ 8 mil por mês" },
        { pontos: 20, frase: "Pediu a proposta ele mesmo" },
      ],
    },
    nota: "Prioridade dele: 1) WhatsApp sem resposta 2) sem cadastro de cliente 3) sem recorrência.",
  },

  // ── APN enviada ───────────────────────────────────────────────────────────
  {
    nome: "Estúdio Pilates Corpo Leve",
    contato: "Marina Duarte",
    telefone: "+5511987650007",
    email: "marina@corpoleve.exemplo.br",
    cidade: "Itapevi",
    segmento: "Estúdio de pilates",
    etapa: "apn-enviada",
    valor: 2900,
    dono: "humano",
    diasParado: 5,
    score: {
      valor: 66,
      razao: "APN entregue e aberta duas vezes, mas ainda sem resposta e a R2 não foi marcada.",
      fatores: [
        { pontos: 25, frase: "APN entregue e aberta 2 vezes" },
        { pontos: 22, frase: "Diagnóstico da R1 alinhado com a proposta" },
        { pontos: 19, frase: "5 dias sem resposta desde o envio" },
      ],
    },
    nota: "Disse que ia olhar com o sócio. Follow-up previsto pra segunda.",
  },
  {
    nome: "Loja Casa & Cor",
    contato: "Beatriz Lemos",
    telefone: "+5511987650008",
    email: "bia@casaecor.exemplo.br",
    cidade: "Jandira",
    segmento: "Loja de decoração",
    etapa: "apn-enviada",
    valor: 2200,
    dono: "ia",
    diasParado: 12,
    score: {
      valor: 38,
      razao: "APN enviada há 12 dias sem nenhuma abertura registrada. Esfriando.",
      fatores: [
        { pontos: 20, frase: "APN enviada" },
        { pontos: 18, frase: "12 dias sem interação nenhuma" },
      ],
    },
  },

  // ── R2 agendada ───────────────────────────────────────────────────────────
  {
    nome: "Academia Força Total",
    contato: "Rafael Nunes",
    telefone: "+5511987650009",
    email: "rafael@forcatotal.exemplo.br",
    cidade: "Cotia",
    segmento: "Academia",
    etapa: "r2-agendada",
    valor: 3800,
    dono: "humano",
    diasParado: 1,
    score: {
      valor: 84,
      razao: "R2 marcada, faixa de investimento já revelada por ele e sem objeção aberta.",
      fatores: [
        { pontos: 32, frase: "R2 confirmada com data" },
        { pontos: 30, frase: "Revelou a faixa de investimento no Pit de extração" },
        { pontos: 22, frase: "Nenhuma objeção em aberto" },
      ],
    },
    nota: "Falou 'até uns 4 mil dá'. Tier único de R$ 3.800 na R2.",
  },

  // ── R2 feita ──────────────────────────────────────────────────────────────
  {
    nome: "Restaurante Sabor Caseiro",
    contato: "Dona Lúcia Prates",
    telefone: "+5511987650010",
    email: null,
    cidade: "Vargem Grande Paulista",
    segmento: "Restaurante",
    etapa: "r2-feita",
    valor: 2600,
    dono: "humano",
    diasParado: 3,
    score: {
      valor: 69,
      razao: "R2 feita e proposta aceita verbalmente, mas o pagamento depende do filho.",
      fatores: [
        { pontos: 30, frase: "R2 realizada, proposta apresentada" },
        { pontos: 25, frase: "Aceitou verbalmente" },
        { pontos: 14, frase: "Decisão de pagamento depende de terceiro" },
      ],
    },
    nota: "Objeção: decisor secundário (o filho cuida do financeiro).",
  },

  // ── Follow-up ─────────────────────────────────────────────────────────────
  {
    nome: "Salão Bella Hair",
    contato: "Priscila Amorim",
    telefone: "+5511987650011",
    email: "priscila@bellahair.exemplo.br",
    cidade: "Itapevi",
    segmento: "Salão de beleza",
    etapa: "follow-up",
    valor: 1900,
    dono: "ia",
    diasParado: 21,
    score: {
      valor: 22,
      razao: "Três tentativas de follow-up sem resposta. Objeção de preço nunca foi resolvida.",
      fatores: [
        { pontos: 12, frase: "Chegou até a R2" },
        { pontos: 10, frase: "3 follow-ups sem resposta" },
      ],
    },
    nota: "Objeção de preço na R2 e sumiu. Última tentativa antes de encerrar.",
  },

  // ── Fechado ───────────────────────────────────────────────────────────────
  {
    nome: "Hamburgueria Brasa 61",
    contato: "Diego Castilho",
    telefone: "+5511987650012",
    email: "diego@brasa61.exemplo.br",
    cidade: "Cotia",
    segmento: "Hamburgueria",
    etapa: "fechado",
    valor: 3400,
    dono: "humano",
    diasParado: 6,
    nota: "Fechou na R2, sem objeção. Onboarding começa segunda.",
  },
  {
    nome: "Clínica Vet Pata Amiga",
    contato: "Dr. Fernando Bastos",
    telefone: "+5511987650013",
    email: "fernando@pataamiga.exemplo.br",
    cidade: "Jandira",
    segmento: "Clínica veterinária",
    etapa: "fechado",
    valor: 4200,
    dono: "humano",
    diasParado: 14,
    nota: "Indicação do Petshop Amigo Fiel. Fechou o pacote completo.",
  },

  // ── Perdido ───────────────────────────────────────────────────────────────
  {
    nome: "Padaria Pão de Ouro",
    contato: "Marcos Tanaka",
    telefone: "+5511987650014",
    email: null,
    cidade: "Itapevi",
    segmento: "Padaria",
    etapa: "perdido",
    valor: 1600,
    dono: "humano",
    diasParado: 30,
    motivoPerda: "price",
    nota: "Achou caro e foi num freelancer por R$ 400. Reabordar em 6 meses.",
  },
  {
    nome: "Ótica Visão Clara",
    contato: "Simone Rangel",
    telefone: "+5511987650015",
    email: "simone@visaoclara.exemplo.br",
    cidade: "Cotia",
    segmento: "Ótica",
    etapa: "perdido",
    valor: null,
    dono: "ia",
    diasParado: 45,
    motivoPerda: "no_response",
    nota: "Nunca respondeu depois do primeiro contato.",
  },
];

/** Conversa de WhatsApp exibida no card da Pizzaria (o 1º da Captação). */
export const CONVERSA_EXEMPLO = [
  { de: "contato", texto: "Boa tarde! Vi o anúncio de vocês, como funciona?" },
  {
    de: "ia",
    texto:
      "Boa tarde, Rodrigo! Funciona assim: a gente olha onde seu negócio está " +
      "perdendo venda e resolve com IA. Antes de te explicar, me conta — o que " +
      "mais te incomoda hoje na pizzaria?",
  },
  {
    de: "contato",
    texto:
      "Cara, no pico da noite o WhatsApp lota e a gente não dá conta. Deve " +
      "perder uns 10 pedidos por noite fácil.",
  },
  {
    de: "ia",
    texto:
      "10 pedidos por noite é bastante. Qual o ticket médio de um pedido, mais " +
      "ou menos?",
  },
  { de: "contato", texto: "Uns 70 reais." },
  {
    de: "ia",
    texto:
      "Então são uns R$ 700 por noite escapando — perto de R$ 21 mil por mês. " +
      "Vale meia hora de conversa pra eu te mostrar como resolver isso? Tenho " +
      "quinta às 15h ou sexta às 10h.",
  },
] as const;
