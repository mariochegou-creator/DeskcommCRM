/**
 * Link de discagem (`tel:`) e formatação de exibição do telefone do contato.
 *
 * A regra aqui é DELIBERADAMENTE mais permissiva que a do `whatsappLink`, e a
 * diferença não é descuido: um 0800 ou 4003 não atende no WhatsApp mas atende
 * no telefone, e um fixo — 27 dos leads importados — é justamente o caso em que
 * ligar é o único caminho que funciona. Recusar aqui os mesmos números que o
 * WhatsApp recusa tiraria o botão de quem mais precisa dele.
 *
 * O que continua sendo recusado é o que não dá para discar com confiança:
 * número sem DDD (não dá para saber a cidade) e lixo de digitação.
 */
export function telLink(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) return null;

  const digitos = phoneNumber.replace(/\D/g, "");

  // Central nacional (0800/0300/4003/4004/3003): disca direto, com ou sem DDI.
  const central = digitos.replace(/^55/, "");
  if (/^(0800|0300|4003|4004|3003)\d+$/.test(central)) return `tel:${central}`;

  // Com DDI: 12 dígitos (55 + DDD + fixo) ou 13 (55 + DDD + celular).
  if (/^55\d{10,11}$/.test(digitos)) return `tel:+${digitos}`;

  // Sem DDI mas com DDD: 10 (fixo) ou 11 (celular) — assume Brasil.
  if (digitos.length === 10 || digitos.length === 11) return `tel:+55${digitos}`;

  // Abaixo disso falta o DDD e não dá para saber a cidade; acima é digitação errada.
  return null;
}

/** O número como uma pessoa lê: `(73) 99134-6237`. */
export function formatarTelefone(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) return null;

  const digitos = phoneNumber.replace(/\D/g, "");
  const local = digitos.replace(/^55/, "");

  if (/^(0800|0300|4003|4004|3003)/.test(local)) {
    return local.length === 8 ? `${local.slice(0, 4)}-${local.slice(4)}` : local;
  }

  if (local.length === 10 || local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, -4)}-${local.slice(-4)}`;
  }

  // Formato que não reconhecemos: devolve como veio em vez de inventar máscara.
  return phoneNumber;
}
