/**
 * A regra ÚNICA de "o que foi digitado casa com o que está gravado".
 *
 * Nasceu de um caso concreto (27/08/2026): o contato gravado como
 * `name = "Contraste Móveis e Decorações"` e `display_name = "Sérgio Martins"`
 * não era encontrado por "sergio" em NENHUMA caixa de busca do CRM. Eram dois
 * defeitos somados, e os dois moram aqui:
 *
 *  1. **Acento.** `ilike` do Postgres é insensível a MAIÚSCULA, nunca a
 *     ACENTO — `'%sergio%'` não casa com "Sérgio". Ninguém digita acento numa
 *     caixa de busca, e 170 dos 1140 contatos desta base têm nome com acento.
 *  2. **Campo único.** Cada tela olhava um campo só (a última mensagem no
 *     inbox, o título na lista de negócios) e nenhum deles era onde o nome da
 *     PESSOA está guardado.
 *
 * A correção do acento é feita no PADRÃO, não no dado: cada letra vira a
 * família dela (`e` → `[eèéêë]`) e a comparação sai por `imatch` (`~*` do
 * Postgres, via PostgREST). A alternativa seria a extensão `unaccent`, que
 * não está instalada nesta base e que o PostgREST não sabe chamar dentro de um
 * filtro — precisaria de coluna gerada ou RPC, muito mais peça para o mesmo
 * resultado.
 *
 * Duas saídas, mesma promessa:
 *  - `padraoBusca` para quem pergunta ao banco;
 *  - `contemBusca` para as listas que já vieram inteiras ao navegador (o
 *    quadro Kanban e a tabela de negócios carregam tudo e filtram na tela).
 */
import { toE164BR, chaveWhatsAppBR, paraDiscarBR } from "@/lib/calls/phone";

/** Letras que mudam de forma com acento. A chave é a letra sem acento. */
const FAMILIAS: Record<string, string> = {
  a: "aàáâãä",
  c: "cç",
  e: "eèéêë",
  i: "iìíîï",
  n: "nñ",
  o: "oòóôõö",
  u: "uùúûü",
  y: "yýÿ",
};

/** `é` → `e`: quem digita COM acento cai na mesma família de quem digita sem. */
const SEM_ACENTO = new Map<string, string>();
for (const [base, familia] of Object.entries(FAMILIAS)) {
  for (const letra of familia) SEM_ACENTO.set(letra, base);
}

/**
 * O texto reduzido ao esqueleto: minúscula, sem acento, sem espaço sobrando.
 * É o que `contemBusca` compara dos DOIS lados — o digitado e o gravado.
 */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * O termo digitado vira um padrão POSIX para o operador `imatch` do PostgREST.
 *
 * `null` quando não sobrou nada de útil — quem chama entende como "sem filtro
 * de texto", nunca como "nada casa".
 *
 * Todo caractere que não é letra nem dígito vira `.` (curinga de UM caractere)
 * em vez de ser escapado. Não é preguiça: `,`, `(` e `)` são os delimitadores
 * do próprio `.or()` do PostgREST, e um termo com parêntese escaparia do valor
 * e viraria condição extra dentro do filtro. Virando curinga, o pior caso é
 * achar um pouco a mais — nunca executar o que o usuário digitou.
 */
export function padraoBusca(termo: string): string | null {
  const limpo = termo.trim();
  if (!limpo) return null;

  let padrao = "";
  for (const bruto of limpo) {
    const c = bruto.toLowerCase();
    const base = SEM_ACENTO.get(c) ?? c;
    const familia = FAMILIAS[base];
    if (familia) {
      padrao += `[${familia}]`;
    } else if (/[a-z0-9 ]/.test(c)) {
      padrao += c;
    } else {
      padrao += ".";
    }
  }
  return padrao;
}

/**
 * Quantos dígitos bastam para o termo ser tratado como telefone. Abaixo disso
 * ("loja 2", "sala 55") a busca por número traria a base inteira junto.
 */
const MINIMO_DE_DIGITOS = 4;

/**
 * As formas do telefone que valem procurar, só dígitos.
 *
 * O CRM guarda o número como o WhatsApp atende — DDD >= 31 fica SEM o nono
 * dígito (`+557399818151`), enquanto o cartão, o Google Maps e a boca do dono
 * usam COM (`+5573999818151`). Quem digita, digita a forma que conhece. Por
 * isso as duas entram: `chaveWhatsAppBR` tira o 9, `paraDiscarBR` devolve.
 *
 * Lista vazia = o termo não é telefone; quem chama simplesmente não filtra por
 * número.
 */
export function telefonesBusca(termo: string): string[] {
  const digitos = termo.replace(/\D/g, "");
  if (digitos.length < MINIMO_DE_DIGITOS) return [];

  const variantes = new Set<string>([digitos]);
  const e164 = toE164BR(termo);
  if (e164) {
    for (const forma of [chaveWhatsAppBR(e164), paraDiscarBR(e164)]) {
      if (forma) variantes.add(forma.replace(/\D/g, ""));
    }
  }
  return [...variantes];
}

/**
 * A versão de tela: o termo casa com QUALQUER um dos campos passados.
 *
 * Campo `null`/`undefined` é ignorado — negócio sem descrição e contato sem
 * telefone são estados legítimos, e tratá-los como texto vazio faria a busca
 * por "" casar com tudo.
 */
export function contemBusca(termo: string, ...campos: Array<string | null | undefined>): boolean {
  const alvo = normalizarBusca(termo);
  if (!alvo) return true;

  const digitos = alvo.replace(/\D/g, "");
  const porNumero = digitos.length >= MINIMO_DE_DIGITOS ? telefonesBusca(termo) : [];

  for (const campo of campos) {
    if (!campo) continue;
    if (normalizarBusca(campo).includes(alvo)) return true;
    if (porNumero.length > 0) {
      const soDigitos = campo.replace(/\D/g, "");
      if (soDigitos && porNumero.some((v) => soDigitos.includes(v))) return true;
    }
  }
  return false;
}
