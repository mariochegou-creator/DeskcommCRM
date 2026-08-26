/**
 * O que o cliente contou — os fatos que só existem na conversa e que nenhuma
 * lista de prospecção traz: quem decide de verdade, como a pessoa gosta de ser
 * atendida, o que ela já tentou, por que desconfia, há quanto tempo está no
 * mercado, como compra.
 *
 * POR QUE ISTO EXISTE: o resumo diário (`lib/conversations/digest-diario`) tem
 * teto de 4 linhas e fala do DIA — "pediu preço, ficou de responder". Um áudio
 * em que o dono diz que não fecha por telefone, que só compra por indicação e
 * que está há 40 anos no ramo vira, no máximo, meia linha desse resumo, e some
 * na varredura do dia seguinte. Isso é o que se lê ANTES de uma reunião, então
 * precisa de um lugar que ACUMULA em vez de trocar todo dia.
 *
 * Onde vivem: em `crm_leads.custom_fields`, sob FATOS_KEY, como OBJETO. Ser
 * objeto não é detalhe — `extractExtras` (lib/leads/ganchos) descarta objeto e
 * array de propósito, então o dossiê de prospecção não ganha uma linha crua
 * `fatos_do_cliente: [object Object]` só porque este campo passou a existir.
 * Ainda assim FATOS_KEY é pulada lá explicitamente: depender do tipo deixaria a
 * tela feia no dia em que um webhook gravasse uma string nesta chave.
 *
 * Módulo puro — sem I/O — porque quem escreve (cron do digest, rota do botão) e
 * quem lê (painel do inbox, dossiê do Kanban) precisam da MESMA extração.
 */

/** A chave em `crm_leads.custom_fields`. Mudar aqui órfã tudo que já foi gravado. */
export const FATOS_KEY = "fatos_do_cliente";

/**
 * Teto de fatos guardados por negócio. Existe para a lista continuar sendo
 * LIDA: vinte itens numa barra lateral viram parede de texto e ninguém lê antes
 * da reunião — que é o único momento em que isto serve para alguma coisa.
 */
export const MAX_FATOS = 12;

/** Teto por fato. Fato é uma linha; parágrafo é resumo, e resumo já tem lugar. */
const MAX_CHARS_POR_FATO = 220;

/** Teto do decisor — "Nome — cargo" e nada mais. */
const MAX_CHARS_DECISOR = 120;

export interface FatosDoCliente {
  /**
   * Quem decide, como o cliente mesmo disse ("João, o dono"). Null quando a
   * conversa ainda não revelou — que é diferente de "quem fala é quem decide".
   */
  decisor: string | null;
  /**
   * Se quem está no WhatsApp é o decisor. `null` = a conversa não deixou claro.
   * Separado de `decisor` porque as duas perguntas têm respostas independentes:
   * dá para saber que o dono se chama João e não saber se é ele quem digita.
   */
  falaComDecisor: boolean | null;
  fatos: string[];
  /** ISO da última varredura. Null em registro antigo, gravado antes do campo. */
  atualizadoEm: string | null;
}

export const FATOS_VAZIO: FatosDoCliente = {
  decisor: null,
  falaComDecisor: null,
  fatos: [],
  atualizadoEm: null,
};

/**
 * Chave de comparação de fato: sem acento, sem caixa, sem pontuação, espaço
 * colapsado. É o que impede "Não fecha por telefone." e "nao fecha por
 * telefone" de virarem dois itens na lista depois de duas varreduras.
 */
function chaveDoFato(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lê os fatos de um `custom_fields` (jsonb → unknown). Nunca lança. */
export function extractFatos(customFields: unknown): FatosDoCliente {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) {
    return FATOS_VAZIO;
  }
  const bruto = (customFields as Record<string, unknown>)[FATOS_KEY];
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return FATOS_VAZIO;

  const obj = bruto as Record<string, unknown>;
  const decisor = typeof obj.decisor === "string" && obj.decisor.trim() ? obj.decisor.trim() : null;
  const fatos = Array.isArray(obj.fatos)
    ? obj.fatos.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim())
    : [];
  const atualizadoEm =
    typeof obj.atualizado_em === "string" && obj.atualizado_em.trim() ? obj.atualizado_em : null;
  const falaComDecisor =
    typeof obj.fala_com_decisor === "boolean" ? obj.fala_com_decisor : null;

  return { decisor, falaComDecisor, fatos, atualizadoEm };
}

/** O objeto como vai para o jsonb. snake_case porque é contrato de banco. */
export function serializarFatos(f: FatosDoCliente): Record<string, unknown> {
  return {
    decisor: f.decisor,
    fala_com_decisor: f.falaComDecisor,
    fatos: f.fatos,
    atualizado_em: f.atualizadoEm,
  };
}

/**
 * Junta o que já estava guardado com o que a varredura de hoje achou.
 *
 * As três regras, e o porquê de cada uma:
 *
 * 1. Fato novo entra no FIM e fato repetido não entra de novo. Ordem estável
 *    importa: uma lista que se reordena a cada varredura obriga a reler tudo.
 * 2. Estourando o teto, quem sai é o mais ANTIGO. O contrário (recusar o novo)
 *    congelaria o dossiê no primeiro dia de conversa.
 * 3. `decisor` e `falaComDecisor` só são trocados quando a varredura tem
 *    resposta. Silêncio da IA — que é o caso comum, porque a maioria das
 *    conversas não fala de quem decide — PRESERVA o que já se sabia. Sem isso
 *    o nome do dono, achado uma vez num áudio, sumiria na primeira varredura de
 *    um dia de conversa morna.
 */
export function mesclarFatos(
  atuais: FatosDoCliente,
  novos: { decisor: string | null; falaComDecisor: boolean | null; fatos: string[] },
  agoraIso: string,
): FatosDoCliente {
  const vistos = new Set(atuais.fatos.map(chaveDoFato));
  const juntos = [...atuais.fatos];
  for (const bruto of novos.fatos) {
    const texto = bruto.trim().slice(0, MAX_CHARS_POR_FATO);
    if (!texto) continue;
    const chave = chaveDoFato(texto);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    juntos.push(texto);
  }

  return {
    decisor: novos.decisor?.trim()
      ? novos.decisor.trim().slice(0, MAX_CHARS_DECISOR)
      : atuais.decisor,
    falaComDecisor: novos.falaComDecisor ?? atuais.falaComDecisor,
    fatos: juntos.slice(-MAX_FATOS),
    atualizadoEm: agoraIso,
  };
}

/** Nada mudou de verdade → o chamador pula o UPDATE (e o histórico não enche). */
export function fatosIguais(a: FatosDoCliente, b: FatosDoCliente): boolean {
  return (
    a.decisor === b.decisor &&
    a.falaComDecisor === b.falaComDecisor &&
    a.fatos.length === b.fatos.length &&
    a.fatos.every((f, i) => f === b.fatos[i])
  );
}
