/**
 * A ABERTURA do grupo da reunião — com ou sem o áudio do Claudio.
 *
 * As duas rotas que criam grupo (marcar reunião e o botão manual do card)
 * mandavam a mesma mensagem única; agora as duas chamam aqui, para a escolha
 * texto-só × três atos morar num lugar. A decisão vem de
 * `grupo_da_reuniao.audio_abertura` (settings da org): sem áudio configurado,
 * sai o texto único de sempre; com ele, sai texto curto → áudio → pergunta.
 *
 * O resultado devolvido é o do PRIMEIRO envio: é ele que carimba
 * `avisos.confirmacao` e decide o "abertura enviada" das rotas. Ato 2 e 3
 * falhando não desfazem o 1 — mensagem no WhatsApp não tem botão de desfazer —
 * mas a falha do áudio troca a pergunta pelo texto reserva, que carrega a
 * apresentação e o pedido de confirmação por escrito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { enviarAudioNoGrupo, enviarNoGrupo, type ResultadoDoEnvio } from "./envio";
import {
  COMPLEMENTO_DA_ABERTURA_SEM_AUDIO,
  PERGUNTA_DE_CONFIRMACAO_DO_GRUPO,
  mensagemCurtaDeAberturaDoGrupo,
  mensagemDeAberturaDoGrupo,
  type ContextoDaMensagem,
} from "./mensagens";
import type { Reuniao } from "./reuniao";
import { grupoDaReuniaoSchema } from "@/lib/schemas/settings";
import { logger } from "@/lib/logger";

export interface AberturaDoGrupo {
  organizationId: string;
  conversationId: string;
  reuniao: Reuniao;
  ctx: ContextoDaMensagem;
  leadId: string;
  origem: string;
  requestId: string;
}

/** O áudio de abertura da org, se configurado. Falha de leitura ⇒ sem áudio. */
async function audioDeAbertura(
  admin: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const settings = (data as { settings?: Record<string, unknown> }).settings ?? {};
  return grupoDaReuniaoSchema.parse(settings["grupo_da_reuniao"]).audio_abertura;
}

export async function enviarAberturaDoGrupo(
  admin: SupabaseClient,
  abertura: AberturaDoGrupo,
): Promise<ResultadoDoEnvio> {
  const { organizationId, conversationId, reuniao, ctx, leadId, origem, requestId } = abertura;
  const metadataBase = {
    meeting_lead_id: leadId,
    meeting_message: "confirmacao",
    meeting_at: reuniao.em,
  };

  const audio = await audioDeAbertura(admin, organizationId);
  if (!audio) {
    return enviarNoGrupo(admin, {
      organizationId,
      conversationId,
      // O "digitando…" vale pra TODA fala do Claudio desde 22/08 (pedido do
      // Mario): grupo recém-criado despejando texto no mesmo segundo tem o
      // mesmo cheiro de robô que a resposta instantânea.
      digitando: true,
      corpo: mensagemDeAberturaDoGrupo(reuniao, ctx),
      metadata: metadataBase,
      origem,
      requestId,
    });
  }

  const primeiro = await enviarNoGrupo(admin, {
    organizationId,
    conversationId,
    digitando: true,
    corpo: mensagemCurtaDeAberturaDoGrupo(reuniao, ctx),
    metadata: metadataBase,
    origem,
    requestId,
  });
  // Sem o ato 1 não há "mensagem aqui em cima" para o áudio apontar — para tudo.
  if (!primeiro.ok) return primeiro;

  const envioDoAudio = await enviarAudioNoGrupo(admin, {
    organizationId,
    conversationId,
    audioDaBiblioteca: audio,
    metadata: { ...metadataBase, meeting_message: "abertura_audio" },
    origem,
    requestId,
  });
  if (!envioDoAudio.ok) {
    logger.warn("[agendamento] áudio da abertura não saiu — texto reserva no lugar", {
      leadId,
      motivo: envioDoAudio.motivo,
      detalhe: envioDoAudio.detalhe,
      requestId,
    });
  }

  const fechamento = await enviarNoGrupo(admin, {
    organizationId,
    conversationId,
    digitando: true,
    corpo: envioDoAudio.ok ? PERGUNTA_DE_CONFIRMACAO_DO_GRUPO : COMPLEMENTO_DA_ABERTURA_SEM_AUDIO,
    metadata: { ...metadataBase, meeting_message: "confirmacao_pergunta" },
    origem,
    requestId,
  });
  if (!fechamento.ok) {
    logger.warn("[agendamento] pergunta de confirmação não saiu no grupo", {
      leadId,
      motivo: fechamento.motivo,
      requestId,
    });
  }

  return primeiro;
}
