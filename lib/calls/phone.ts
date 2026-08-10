/**
 * O telefone do contato vira algo discável.
 *
 * `contacts.phone_number` é validado em E.164 pelo `contactCreateSchema`
 * (lib/schemas/contacts.ts), mas o banco tem histórico anterior a essa regra e
 * importação de planilha entra por outros caminhos: na prática convivem
 * `+5577998125024`, `(77)99812-5024`, `77 99812-5024` e `5577998125024`. O
 * botão "Ligar" precisa funcionar em todos — ou o SDR clica e nada acontece,
 * sem entender por quê.
 *
 * DEVOLVE `null` EM VEZ DE ADIVINHAR. Um número que não dá para normalizar com
 * confiança faz o botão aparecer desabilitado com o motivo escrito ao lado. O
 * caminho oposto — completar o que falta com um palpite — disca para o número
 * errado, e discar errado numa prospecção é ligar para um estranho em nome da
 * empresa.
 */

/** DDI do Brasil. Único mercado da Nexo IA hoje; a função é explícita nisso. */
const DDI_BR = "55";

/**
 * `(77)99812-5024` → `+5577998125024`.
 *
 * Regras, na ordem em que são aplicadas:
 *  - já em E.164 (`+` seguido de 8 a 15 dígitos) passa direto, seja qual for o país;
 *  - 10 ou 11 dígitos = número nacional com DDD → recebe o 55 na frente;
 *  - 12 ou 13 dígitos começando em 55 = já tem o DDI, só falta o `+`;
 *  - qualquer outra coisa → `null`.
 *
 * O 9 do celular NÃO é inserido quando falta. Um fixo de 10 dígitos é um fixo
 * de 10 dígitos, e transformá-lo em celular inventaria uma linha que pode
 * existir e ser de outra pessoa.
 */
export function toE164BR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const limpo = raw.trim();
  if (limpo === "") return null;

  // Já é E.164 de qualquer país: não mexe. O `+` é a afirmação de quem gravou
  // de que o número está completo — sobrescrever isso com a regra brasileira
  // quebraria um contato internacional legítimo.
  if (/^\+\d{8,15}$/.test(limpo)) return limpo;

  const digitos = limpo.replace(/\D/g, "");
  if (digitos === "") return null;

  // 10 = DDD + fixo (8), 11 = DDD + celular (9).
  if (digitos.length === 10 || digitos.length === 11) {
    return `+${DDI_BR}${digitos}`;
  }

  // 12/13 = DDI + DDD + número. Só aceita se o DDI for o do Brasil: um
  // 351xxxxxxxxx (Portugal) sem `+` cairia aqui e viraria `+351...` por
  // coincidência de tamanho, o que é adivinhação.
  if (
    (digitos.length === 12 || digitos.length === 13) &&
    digitos.startsWith(DDI_BR)
  ) {
    return `+${digitos}`;
  }

  return null;
}

/**
 * `+5577998125024` → `(77) 99812-5024`. É o que o SDR lê em fonte grande no
 * popup para digitar no celular — agrupado do jeito que ele já digita.
 *
 * Número que não é brasileiro (ou que não bate com o formato) volta como está:
 * exibir o E.164 cru é feio e correto; forçar máscara brasileira em número
 * estrangeiro é bonito e errado.
 */
export function formatPhoneBR(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}

/** `+5577998125024` → `5577998125024`, que é o que o link do wa.me espera. */
export function toWhatsAppNumber(e164: string | null | undefined): string | null {
  const normalizado = toE164BR(e164);
  return normalizado ? normalizado.slice(1) : null;
}
