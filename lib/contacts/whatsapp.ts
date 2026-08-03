/**
 * Link de conversa no WhatsApp a partir do telefone do contato.
 *
 * Devolve `null` — e não uma string quebrada — quando o número não serve. Um
 * botão que abre o WhatsApp num número inválido é PIOR que botão nenhum: o SDR
 * descobre o defeito depois de já ter perdido o clique, e a lista de prospecção
 * tem números que comprovadamente não servem (central 4003, número sem DDD,
 * telefone que não é celular). Quem chama decide o que fazer com o null; aqui
 * a regra é só uma — na dúvida, não oferecer o atalho.
 */
export function whatsappLink(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) return null;

  const digitos = phoneNumber.replace(/\D/g, "");

  // E.164 mundial vai de 8 a 15 dígitos. Abaixo disso é número local sem DDI
  // (o `wa.me` interpretaria como outro país) e acima é lixo de digitação.
  if (digitos.length < 10 || digitos.length > 15) return null;

  // 0800/0300/4003 e afins são centrais de atendimento, não linhas de WhatsApp.
  if (/^55(0800|0300|4003|4004|3003)/.test(digitos) || /^(0800|0300|4003)/.test(digitos)) {
    return null;
  }

  return `https://wa.me/${digitos}`;
}
