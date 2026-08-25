/**
 * Spintax do disparador (0108) — função PURA, rng injetável.
 *
 * POR QUE ISTO EXISTE, E NÃO É ENFEITE
 *
 * O gate de spinning (`lib/agent-engine/spinning/engine.ts`) veta a TERCEIRA
 * mensagem quase-idêntica saindo do mesmo número: janela das últimas 20 copies,
 * Jaccard de palavras ≥ 0,8. Isso não é uma regra nossa, é a defesa contra o
 * gatilho de ban mais conhecido do WhatsApp — template idêntico em massa.
 *
 * Ou seja: um disparo de texto FIXO morre no terceiro destinatário. Com o texto
 * variando de verdade a cada envio, passa. `{oi|opa|e aí}` num texto de 30
 * palavras não é suficiente sozinho (troca 1 palavra ⇒ Jaccard ~0,97): a tela
 * usa `contarVariantes` e `simularSpinning` (simulacao.ts) no dry-run pra dizer
 * isso ANTES de ativar, em vez de deixar a campanha pausar no meio.
 *
 * SINTAXE
 *   {a|b|c}     — sorteia uma das opções (não aninhado, igual ao spec upstream)
 *   {{nome}}    — variável do destinatário
 *
 * Ordem de resolução: variáveis PRIMEIRO. Se um nome contiver `|` (raro, mas
 * "Maria | Loja X" acontece em cadastro importado), resolver alternância antes
 * transformaria o nome em sorteio.
 */

/** Variáveis disponíveis por destinatário. Ausente/vazia cai no fallback. */
export interface VariaveisDoDestinatario {
  /** Primeiro nome do contato — o único que a operação usa hoje. */
  nome?: string | null;
  /** Nome do negócio (título do card), quando houver. */
  negocio?: string | null;
}

/** O que substituir quando a variável está vazia. Nunca deixar `{{nome}}` cru sair. */
const FALLBACK_DE_VARIAVEL: Record<string, string> = {
  nome: "tudo bem",
  negocio: "seu negócio",
};

const RE_VARIAVEL = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;
/** Alternância NÃO aninhada: `[^{}]` impede casar por cima de um `{{var}}`. */
const RE_ALTERNANCIA = /\{([^{}]+)\}/g;

/**
 * Só o primeiro nome — "José Carlos da Silva Ltda" vira "José".
 *
 * Inicial abreviada ("J. Carlos", "M Souza") NÃO é cortada: a mensagem
 * começaria com "Oi J.," que é pior do que não personalizar. Nesse caso vale o
 * nome inteiro.
 */
export function primeiroNome(nomeCompleto: string | null | undefined): string | null {
  const limpo = (nomeCompleto ?? "").trim();
  if (!limpo) return null;
  const primeiro = limpo.split(/\s+/)[0] ?? "";
  const ehInicial = primeiro.endsWith(".") || primeiro.replace(/\W/g, "").length <= 1;
  return ehInicial ? limpo : primeiro;
}

function substituiVariaveis(template: string, vars: VariaveisDoDestinatario): string {
  return template.replace(RE_VARIAVEL, (_todo, nome: string) => {
    const bruto = (vars as Record<string, unknown>)[nome];
    const valor = typeof bruto === "string" ? bruto.trim() : "";
    if (valor) return valor;
    // Variável desconhecida some em vez de vazar `{{cnpj}}` pro lead.
    return FALLBACK_DE_VARIAVEL[nome] ?? "";
  });
}

/**
 * Expande o template numa mensagem final.
 * `rng` injetável: os testes fixam, o preview usa índices determinísticos e a
 * produção usa Math.random.
 */
export function expandirSpintax(
  template: string,
  vars: VariaveisDoDestinatario = {},
  rng: () => number = Math.random,
): string {
  const comVars = substituiVariaveis(template, vars);
  const expandido = comVars.replace(RE_ALTERNANCIA, (_todo, grupo: string) => {
    const opcoes = grupo.split("|").map((s) => s.trim());
    if (opcoes.length <= 1) return grupo.trim();
    const i = Math.min(opcoes.length - 1, Math.floor(rng() * opcoes.length));
    return opcoes[i] ?? "";
  });
  // Alternância pode deixar espaço duplo ("oi {amigo|} tudo bem").
  return expandido.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Quantas mensagens DIFERENTES o template consegue gerar (produto das opções).
 * Teto em 10.000: acima disso o número não informa mais nada e só assusta.
 */
export function contarVariantes(template: string): number {
  const semVars = template.replace(RE_VARIAVEL, "x");
  let total = 1;
  for (const m of semVars.matchAll(RE_ALTERNANCIA)) {
    const opcoes = (m[1] ?? "").split("|").length;
    if (opcoes > 1) total *= opcoes;
    if (total >= 10000) return 10000;
  }
  return total;
}

/**
 * Amostra determinística de variantes distintas — o que a tela mostra como
 * "exemplos do que vai sair". Determinístico de propósito: o operador precisa
 * poder reler a mesma tela e ver os mesmos exemplos.
 */
export function amostraDeVariantes(
  template: string,
  vars: VariaveisDoDestinatario = {},
  quantidade = 3,
): string[] {
  const vistas = new Set<string>();
  // Passeio por sementes fixas em vez de random: mesma entrada, mesma saída.
  for (let semente = 0; semente < quantidade * 20 && vistas.size < quantidade; semente += 1) {
    let passo = semente;
    const rng = (): number => {
      // LCG minúsculo — só precisa espalhar, não precisa ser bom.
      passo = (passo * 1103515245 + 12345) % 2147483648;
      return passo / 2147483648;
    };
    vistas.add(expandirSpintax(template, vars, rng));
  }
  return [...vistas];
}

/**
 * A medida de "esse texto varia o bastante?" vive em `simulacao.ts`, e é o
 * MOTOR REAL do gate (`decideSpinning`) rodando sobre a sequência que a
 * campanha geraria — não uma segunda implementação de Jaccard aqui.
 *
 * A primeira versão deste arquivo tinha essa segunda implementação, medindo o
 * PIOR par entre as variantes. Media a coisa errada: com 3 blocos de spin
 * existem pares que diferem em um bloco só (similaridade ~0,8) e o pior caso
 * reprovava templates que na prática passam — um aviso que grita sempre é um
 * aviso que se aprende a ignorar. O gate não olha o pior par: olha quantas das
 * ÚLTIMAS 20 casam com a candidata.
 */
