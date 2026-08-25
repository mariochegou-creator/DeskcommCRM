/**
 * POST /api/v1/broadcasts/preview — o dry-run.
 *
 * Responde três perguntas que o operador precisa fazer ANTES de existir fila:
 * quantos vão receber, quem vai ser pulado e por quê, e se o texto varia o
 * suficiente para não ser vetado como template em massa.
 *
 * A terceira é a menos óbvia e a que mais salva campanha. O gate de spinning
 * (lib/agent-engine/spinning/engine.ts) veta a 3ª mensagem quase-idêntica do
 * mesmo número — um texto fixo pausaria a campanha no terceiro destinatário.
 * Descobrir isso aqui custa um clique; descobrir depois custa uma campanha pela
 * metade e a dúvida sobre quem recebeu.
 *
 * Não grava nada. Usa o client do USUÁRIO (RLS), não o admin: preview é leitura,
 * e leitura de lead passa pela mesma porta que o resto do CRM.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { resolverPublico, resumirPublico } from "@/lib/broadcasts/audience";
import { amostraDeVariantes, contarVariantes } from "@/lib/broadcasts/spintax";
import { simularSpinning } from "@/lib/broadcasts/simulacao";
import { BROADCAST_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";
import { previewDePublicoSchema } from "@/lib/schemas/broadcasts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "broadcasts" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = previewDePublicoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Filtro inválido.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { audience, max_recipients, body_template } = parsed.data;

  const supabase = await createClient();

  let resumo;
  try {
    const candidatos = await resolverPublico(supabase, org.orgId, audience, max_recipients);
    resumo = resumirPublico(candidatos);
  } catch (err) {
    return fail(
      "internal_error",
      err instanceof Error && err.message.startsWith("publico_falhou")
        ? "Não foi possível montar o público com esse filtro."
        : "Falha ao montar o público.",
      500,
      { requestId },
    );
  }

  // Duração estimada: o worker manda ~1 a cada 5s, e só dentro da janela. É a
  // informação que evita a pergunta "travou?" dez minutos depois de ativar.
  const segundos = Math.round((resumo.aptos * BROADCAST_DEFAULTS.gapMs) / 1000);

  const texto = (body_template ?? "").trim();
  let variacao = null;
  if (texto) {
    /**
     * O veredito vem do MOTOR REAL (`decideSpinning`) rodando sobre a sequência
     * que ESTA campanha geraria — tantos envios quanto o público tem, com teto
     * na janela do gate. Para 2 destinatários até texto fixo passa (o gate veta
     * a partir da 3ª quase-idêntica), e a simulação diz isso sozinha.
     */
    const sim = simularSpinning(texto, {
      envios: Math.min(Math.max(resumo.aptos, 1), SPINNING_DEFAULTS.windowSize + 1),
    });
    variacao = {
      variantes: contarVariantes(texto),
      vai_ser_vetado: sim.vetaria,
      envio_do_veto: sim.envioDoVeto,
      exemplos: amostraDeVariantes(texto, { nome: "Ana", negocio: "Loja do Bairro" }, 3),
    };
  }

  return ok(
    {
      ...resumo,
      duracao_estimada_segundos: segundos,
      variacao,
    },
    { requestId },
  );
}
