/**
 * Em que modo a IA trabalha NESTE número de WhatsApp.
 *
 * O problema que isto resolve: "a IA organiza meu funil, mas quem fala com o
 * cliente sou eu". Até aqui as duas coisas eram a mesma coisa — o card só anda
 * porque o agente atende, e o agente atende porque existe versão publicada.
 * Quem quisesse a primeira levava a segunda junto.
 *
 * ⚠️ POR QUE O FREIO NÃO É "NÃO CRIAR O JOB".
 *
 * Cortar no drain (ao lado do `ai_dispatch_mode = 'external'`) seria mais barato
 * e é o lugar óbvio — e mata justamente o que se quer manter: sem turno não há
 * leitura da conversa, não há `update_lead_state`, e o card fica exatamente tão
 * parado quanto antes. O gasto do turno é o preço de a IA continuar lendo.
 *
 * ⚠️ E POR QUE TAMBÉM NÃO É UM VETO NO ENVIO.
 *
 * A cadeia `before-send` já sabe recusar mensagem, e usá-la aqui deixaria o
 * modelo TENTAR enviar a cada turno para ser recusado no fim: token gasto à toa,
 * uma atividade de veto na timeline do lead a cada mensagem recebida, e um
 * `before_send_trace` para um envio que nunca deveria ter sido cogitado. Veto é
 * para o que era permitido e deu errado; aqui enviar nunca esteve em questão.
 *
 * O freio é a AUSÊNCIA DA FERRAMENTA: sem `send_message` no turno, não existe
 * caminho de código que leve uma mensagem deste número ao cliente — nem por
 * decisão do modelo, nem por engano de prompt. É a mesma técnica que o repo já
 * usa para `search_knowledge` sem base de conhecimento.
 *
 * ⚠️ O FREIO NÃO PEGA A CADÊNCIA (`job.kind = 'followup_turn'`), e a distinção é
 * do dono do negócio, não técnica: no turno de conversa quem decide o que dizer
 * é o modelo, na hora, sobre o que o cliente acabou de falar — é isso que ele
 * não quer terceirizar. O toque da cadência é texto que ELE redigiu, num dia que
 * ELE escolheu, para quem sumiu. A exceção vive no chamador (inbound-turn.ts),
 * onde `job.kind` existe.
 *
 * Mora em `channel_sessions.metadata` (jsonb que já existe) e não em coluna
 * nova: é knob de operação, muda com um `update`, e uma migration para um
 * booleano seria um passo a mais entre o Mario querer calar um número e o número
 * calar. Ausente ⇒ `atendente`, que é como todo número sempre se comportou.
 */
import type { Queryable } from '../../queue/queue';

export type ModoDoNumero =
  /** A IA conversa com o cliente — comportamento de sempre, e o padrão. */
  | 'atendente'
  /** A IA lê e organiza o CRM; quem fala com o cliente é uma pessoa. */
  | 'copiloto';

/**
 * ⚠️ QUALQUER DÚVIDA RESPONDE `atendente`, e isso é deliberado.
 *
 * O outro default seria "na dúvida, cale" — que soa mais seguro e é pior: uma
 * falha de leitura do banco calaria a IA de TODOS os números sem nada na tela
 * dizendo por quê, e o dono descobriria pelos leads que ninguém respondeu. O
 * silêncio é o estado que ninguém percebe; a resposta indevida, alguém vê no
 * mesmo dia. Errar para o lado visível é o certo aqui.
 */
export async function lerModoDoNumero(
  db: Queryable,
  tenantId: string,
  channelSessionId: string | null,
): Promise<ModoDoNumero> {
  if (!channelSessionId) return 'atendente';
  try {
    const { rows } = await db.query<{ modo: string | null }>(
      `select metadata->>'ai_mode' as modo
         from channel_sessions
        where organization_id = $1 and id = $2`,
      [tenantId, channelSessionId],
    );
    return rows[0]?.modo === 'copiloto' ? 'copiloto' : 'atendente';
  } catch {
    return 'atendente';
  }
}

/**
 * O que o modelo lê quando o número está em copiloto.
 *
 * Diz as três coisas na ordem em que ele precisa delas: que não vai falar com o
 * cliente, o que ele DEVE fazer no lugar disso, e que escrever a resposta no
 * texto do turno é desperdício — sem a última, o modelo redige uma bela resposta
 * que não vai a lugar nenhum e ainda acha que atendeu.
 *
 * A ferramenta já não existe no turno; este bloco existe para o modelo não
 * passar o turno inteiro procurando por ela, e para não PROMETER ao cliente algo
 * que ele não tem como cumprir.
 */
export const BLOCO_COPILOTO =
  `## Modo copiloto: você NÃO responde este cliente\n` +
  `Neste número quem fala com o cliente é uma pessoa do time. Você não tem a ferramenta ` +
  `de enviar mensagem e nada que você escrever chega ao cliente.\n\n` +
  `Seu trabalho aqui é ler a conversa e deixar o CRM em dia:\n` +
  `- atualize o estágio do lead com update_lead_state quando a conversa tiver avançado de verdade;\n` +
  `- guarde com save_lead_note o que for durável (o que ele pediu, objeções, combinados);\n` +
  `- encerre o turno em seguida.\n\n` +
  `Não redija a resposta ao cliente: ela não sai daqui, e escrevê-la só gasta o turno.`;
