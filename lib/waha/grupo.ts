/**
 * Grupos do WhatsApp, do lado do WAHA.
 *
 * Duas coisas puras que o cliente HTTP e o agendamento precisam falar igual:
 * como escrever o endereço de alguém (`chatIdDeTelefone`) e como achar o
 * endereço do grupo dentro da resposta que o WAHA devolve ao criá-lo
 * (`extrairChatIdDoGrupo`).
 *
 * A segunda existe porque a resposta NÃO tem forma única. O NOWEB devolve o
 * JID direto em `id`; o WEBJS devolve um objeto `{ _serialized }` (às vezes
 * sob `gid`); e há build que só manda `{ user, server }` para montar. Um
 * `json.id as string` funcionaria até o dia da troca de engine — e o modo de
 * falha seria o pior possível: o grupo existe no celular de todo mundo e o CRM
 * não sabe o endereço dele, então nenhuma mensagem sai e não há como consertar
 * sem ir no banco.
 */

/** `+5575988887777` → `5575988887777@c.us`. Vazio devolve null. */
export function chatIdDeTelefone(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;
  return `${digitos}@c.us`;
}

/** É endereço de grupo? (`…@g.us`) */
export function ehChatIdDeGrupo(chatId: string | null | undefined): boolean {
  return typeof chatId === "string" && chatId.endsWith("@g.us");
}

/** Aceita só o que é endereço de grupo de verdade. */
function seForGrupo(v: unknown): string | null {
  return typeof v === "string" && v.endsWith("@g.us") ? v : null;
}

/**
 * O `…@g.us` do grupo recém-criado, venha na forma que vier.
 *
 * Devolve null quando não achou — quem chama tem de tratar isso como falha de
 * criação, não como "criou sem id".
 */
export function extrairChatIdDoGrupo(resposta: unknown): string | null {
  if (typeof resposta === "string") return seForGrupo(resposta);
  if (!resposta || typeof resposta !== "object") return null;

  const raiz = resposta as Record<string, unknown>;
  for (const chave of ["id", "gid", "groupId", "chatId"]) {
    const valor = raiz[chave];
    const direto = seForGrupo(valor);
    if (direto) return direto;

    if (valor && typeof valor === "object") {
      const obj = valor as Record<string, unknown>;
      const serializado = seForGrupo(obj._serialized);
      if (serializado) return serializado;
      // `{ user: "123-456", server: "g.us" }` — a forma crua do Baileys.
      if (typeof obj.user === "string" && obj.server === "g.us") {
        return `${obj.user}@g.us`;
      }
    }
  }
  return null;
}

/** Quem o WhatsApp NÃO conseguiu botar no grupo, pela resposta da criação. */
export function participantesQueFaltaram(resposta: unknown): string[] {
  if (!resposta || typeof resposta !== "object") return [];
  const lista = (resposta as Record<string, unknown>).participants;
  if (!Array.isArray(lista)) return [];
  const fora: string[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    // WAHA repete o código do WhatsApp: "200" é sucesso; qualquer outro não é.
    const codigo = p.code ?? p.status;
    const id = typeof p.id === "string" ? p.id : null;
    if (!id) continue;
    if (codigo !== undefined && String(codigo) !== "200") fora.push(id);
  }
  return fora;
}
