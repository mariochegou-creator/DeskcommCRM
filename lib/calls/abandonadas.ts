/**
 * A ligação que ficou pela metade — e por que ela precisava de um fim.
 *
 * O QUE ACONTECIA (medido em 25/08/2026, org da Nexo): duas ligações — uma de
 * 24/08 às 10:34, outra de 25/08 às 15:29 — estavam em `pending` com
 * `storage_path` nulo e nenhum evento `call.transcribe_requested` no
 * `event_log`. Quer dizer: o popup gravou, a transcrição ao vivo rodou (328 e
 * 1707 caracteres), e o áudio íntegro NUNCA subiu. A aba foi fechada, ou a
 * internet caiu, antes de a promessa entregue ao `LigacoesEmVooProvider`
 * terminar.
 *
 * Do lado do servidor nada distingue essa linha de uma ligação que começou há
 * dez segundos: as duas são `pending`. Então o card da timeline mostrava
 * "Analisando…" para sempre, e "Analisar de novo" não tinha o que reanalisar —
 * não existe áudio. O estado que mais parece trabalho em andamento era, na
 * verdade, trabalho que nunca ia acontecer.
 *
 * COMO SE SABE QUE ACABOU: `updated_at`. Enquanto a ligação está no ar, a rota
 * `/calls/[id]/live` escreve `transcript` e `live_state` a cada bloco (uns 8
 * segundos), então a linha é tocada o tempo todo. Silêncio de
 * {@link ABANDONO_MINUTOS} minutos numa ligação sem áudio quer dizer que o
 * popup não existe mais. Não é palpite sobre duração de ligação — é ausência de
 * sinal de vida.
 *
 * MARCAR `failed` É SEGURO. `POST /calls/[id]/audio` só recusa quando já existe
 * `storage_path`; o status não entra na decisão. Se o áudio aparecer depois
 * (uma aba que voltou do sono, por exemplo), o upload passa e devolve a ligação
 * para `transcribing` normalmente. O pior caso desta função é um "falhou" que
 * se conserta sozinho — nunca uma gravação perdida.
 *
 * ESTE ARQUIVO NÃO IMPORTA NADA DE SERVIDOR de propósito: quem escreve no banco
 * é a rota (que já tem o cliente admin em mãos). Um `import` de
 * `@/lib/supabase/admin` aqui arrastaria `server-only` para dentro do teste
 * unitário e a regra deixaria de ser testável — que é justamente a parte que
 * decide se uma ligação vira falha.
 */
/**
 * Silêncio, em minutos, que basta para dizer que o áudio não vem mais.
 *
 * Generoso de propósito: o bloco ao vivo chega a cada ~8 segundos, então 15
 * minutos são mais de cem blocos perdidos. Uma ligação longa e saudável nunca
 * chega perto disso.
 */
export const ABANDONO_MINUTOS = 15;

/** O que o SDR lê no lugar de "Analisando…" — em português, e acionável. */
export const MOTIVO_ABANDONO =
  "A gravação não chegou ao servidor: a aba foi fechada (ou a conexão caiu) antes de o áudio subir. A anotação e a transcrição ao vivo continuam salvas.";

/** O mínimo que se precisa saber de uma ligação para julgá-la abandonada. */
export interface LigacaoParaJulgar {
  status: string | null;
  storage_path: string | null;
  updated_at: string | null;
}

/**
 * `true` quando a ligação está parada em `pending`, sem áudio, e sem sinal de
 * vida há tempo demais.
 */
export function ligacaoAbandonada(
  call: LigacaoParaJulgar,
  agora: Date = new Date(),
): boolean {
  if (call.status !== "pending") return false;
  if (call.storage_path) return false;
  if (!call.updated_at) return false;

  const parado = agora.getTime() - new Date(call.updated_at).getTime();
  return parado > ABANDONO_MINUTOS * 60_000;
}

