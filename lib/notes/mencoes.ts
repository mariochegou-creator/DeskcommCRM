/**
 * As duas regras puras da @menção na nota interna (0110). Sem React, testáveis.
 *
 * `resolveArroba` alimenta o menu que abre enquanto se digita — irmão do
 * `resolveSlash` do TemplateMenu, com uma diferença que importa: o `/` só vale
 * no COMEÇO do texto (é um comando), o `@` vale em qualquer ponto ("falei com
 * ele hoje, @david olha isso").
 *
 * `acharMencionados` é a rede de segurança: quem digitou o nome à mão, sem
 * escolher no menu, continua marcando a pessoa. Sem ela, "@david" escrito
 * direto não avisaria ninguém — que é justamente o defeito que a 0110 conserta.
 */
import { normalizarBusca } from "@/lib/busca/termo";

export interface MembroCitavel {
  user_id: string;
  full_name: string | null;
}

/** Estado do menu de @ a partir do texto e da posição do cursor. */
export function resolveArroba(
  text: string,
  cursor: number,
): { open: boolean; query: string; inicio: number } {
  const antes = text.slice(0, cursor);
  // O `@` precisa começar palavra: um e-mail colado na nota (`a@b.com`) não abre
  // menu. `[^\s@]*` porque o nome pode ter acento e o menu filtra sem acento.
  const m = /(?:^|\s)@([^\s@]*)$/.exec(antes);
  const query = m?.[1];
  if (query === undefined) return { open: false, query: "", inicio: -1 };
  return { open: true, query, inicio: cursor - query.length - 1 };
}

/** `@nome` seguido de qualquer coisa que não seja letra/número. */
function citado(alvo: string, nome: string): boolean {
  const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${escapado}(?![a-z0-9])`).test(alvo);
}

/**
 * Ids dos membros citados no corpo, casando pelo nome completo OU só pelo
 * primeiro nome (é como se fala: "@david", não "@david souza").
 *
 * A borda depois do nome não é detalhe: sem ela "@david" marcaria também um
 * "Davi" da equipe, porque `@davi` é prefixo de `@david`.
 */
export function acharMencionados(body: string, membros: MembroCitavel[]): string[] {
  const alvo = normalizarBusca(body);
  const ids = new Set<string>();
  for (const m of membros) {
    const nome = normalizarBusca(m.full_name ?? "");
    if (!nome) continue;
    const primeiro = nome.split(" ")[0] ?? nome;
    if (citado(alvo, nome) || citado(alvo, primeiro)) ids.add(m.user_id);
  }
  return [...ids];
}
