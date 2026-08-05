/**
 * Reconstrói o histórico de mensagens ENVIADAS que o ingest descartou.
 *
 * Contexto: `handleOutboundFromUserPhone` lia o destinatário de `p.to`, campo
 * que o engine NOWEB não manda em eventos `fromMe`. Toda mensagem enviada pelo
 * WhatsApp Web / celular caía num `return` mudo — o inbox ficou só com o lado do
 * cliente. O bug está corrigido em `lib/waha/ingest.ts`, mas a correção só vale
 * dali pra frente; o que já passou está guardado cru em `webhook_events_log`.
 *
 * Este script relê aquele log e roda os mesmos payloads pelo ingest JÁ
 * CORRIGIDO — de propósito, em vez de reimplementar o insert aqui. Backfill que
 * duplica a lógica do caminho ao vivo é backfill que envelhece diferente dele.
 *
 * Idempotente: o próprio ingest procura o `external_id` (nas duas formas, crua e
 * completa) antes de inserir. Rodar duas vezes não duplica nada.
 *
 * ⚠️ RECONCILIAÇÃO NO FIM, E ELA NÃO É OPCIONAL. `fn_mark_conversation_message`
 * faz `last_message_at = p_at` sem comparar com o valor atual, e o ingest passa
 * o instante do processamento. Ao vivo isso é inofensivo (agora ≈ hora da
 * mensagem); num backfill de mensagens de dias atrás, carimbaria TODA conversa
 * tocada com a data de hoje e embaralharia a ordem do inbox. Por isso, no fim,
 * os carimbos são recalculados a partir da tabela `messages`, que é a verdade.
 *
 * Simulação (padrão, não escreve nada):
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/backfill-outbound-waha.ts
 * Gravando:
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/backfill-outbound-waha.ts --gravar
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchWahaEvent, type WahaEnvelope } from "@/lib/waha/ingest";
import { bareWaMessageId } from "@/lib/waha/message-id";

const GRAVAR = process.argv.includes("--gravar");
const PAGINA = 1000;

interface Sessao {
  id: string;
  organization_id: string;
  waha_session_name: string;
  is_warmup_complete: boolean | null;
  warmup_started_at: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** Lê uma tabela inteira em páginas — o PostgREST corta em 1000 por requisição. */
async function lerTudo<T>(
  admin: Admin,
  monta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await monta(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error(error.message);
    tudo.push(...(data ?? []));
    if (!data || data.length < PAGINA) return tudo;
  }
}

function preview(body: string | null, type: string): string {
  if (body) return body.slice(0, 280);
  return type !== "text" ? `[${type}]` : "";
}

async function main(): Promise<void> {
  const admin = createAdminClient();

  const { data: sessoesRaw, error: erroSessoes } = await admin
    .from("channel_sessions")
    .select("id, organization_id, waha_session_name, is_warmup_complete, warmup_started_at");
  if (erroSessoes) throw new Error(`channel_sessions: ${erroSessoes.message}`);
  const porNome = new Map<string, Sessao>(
    (sessoesRaw as Sessao[]).map((s) => [s.waha_session_name, s]),
  );

  // Ordem cronológica: o carimbo da conversa é sobrescrito a cada mensagem, e
  // processar fora de ordem deixaria a conversa marcada por uma mensagem velha.
  // (A reconciliação final corrige de qualquer forma — isto é cinto e suspensório.)
  const eventos = await lerTudo<{
    received_at: string;
    event_type: string;
    payload_parsed: WahaEnvelope;
  }>(admin, (from, to) =>
    admin
      .from("webhook_events_log")
      .select("received_at, event_type, payload_parsed")
      .eq("provider", "waha")
      .in("event_type", ["message", "message.any"])
      .order("received_at", { ascending: true })
      .range(from, to),
  );

  const vistos = new Set<string>();
  const candidatos: Array<{ envelope: WahaEnvelope; sessao: Sessao; externalIds: string[] }> = [];
  let semSessao = 0;
  let duplicados = 0;

  for (const ev of eventos) {
    const envelope = ev.payload_parsed;
    if (envelope?.payload?.fromMe !== true) continue;
    const id = envelope.payload.id;
    if (!id) continue;
    // O mesmo id chega em `message` e `message.any` — conta uma vez só.
    if (vistos.has(id)) {
      duplicados++;
      continue;
    }
    vistos.add(id);

    const sessao = porNome.get(envelope.session ?? "");
    if (!sessao) {
      semSessao++;
      continue;
    }
    const bare = bareWaMessageId(id);
    candidatos.push({ envelope, sessao, externalIds: bare === id ? [id] : [id, bare] });
  }

  // Quais já estão no banco (rodada anterior, ou eco de envio pelo composer).
  const todosIds = [...new Set(candidatos.flatMap((c) => c.externalIds))];
  const jaGravados = new Set<string>();
  for (let i = 0; i < todosIds.length; i += 200) {
    const { data, error } = await admin
      .from("messages")
      .select("external_id")
      .in("external_id", todosIds.slice(i, i + 200));
    if (error) throw new Error(`messages lookup: ${error.message}`);
    for (const r of (data ?? []) as Array<{ external_id: string | null }>) {
      if (r.external_id) jaGravados.add(r.external_id);
    }
  }
  const faltando = candidatos.filter((c) => !c.externalIds.some((id) => jaGravados.has(id)));

  const porSessao = new Map<string, number>();
  for (const c of faltando) {
    porSessao.set(c.sessao.waha_session_name, (porSessao.get(c.sessao.waha_session_name) ?? 0) + 1);
  }
  const datas = faltando
    .map((c) => c.envelope.payload?.timestamp)
    .filter((t): t is number => typeof t === "number")
    .sort((a, b) => a - b);

  console.log("─".repeat(64));
  console.log(GRAVAR ? "BACKFILL — GRAVANDO" : "BACKFILL — SIMULAÇÃO (nada é escrito)");
  console.log("─".repeat(64));
  console.log(`eventos de mensagem lidos ............ ${eventos.length}`);
  console.log(`enviadas (fromMe) únicas ............. ${vistos.size}`);
  console.log(`  descartadas: evento repetido ....... ${duplicados}`);
  console.log(`  descartadas: sessão desconhecida ... ${semSessao}`);
  console.log(`  já presentes no histórico .......... ${candidatos.length - faltando.length}`);
  console.log(`A RECUPERAR .......................... ${faltando.length}`);
  if (datas.length) {
    console.log(
      `período .............................. ${new Date(datas[0]! * 1000).toISOString()} → ${new Date(datas[datas.length - 1]! * 1000).toISOString()}`,
    );
  }
  for (const [nome, n] of porSessao) console.log(`  sessão ${nome}: ${n}`);

  if (!GRAVAR) {
    console.log("\nNada foi gravado. Rode de novo com --gravar para aplicar.");
    return;
  }
  if (faltando.length === 0) {
    console.log("\nNada a fazer.");
    return;
  }

  let ok = 0;
  let falhas = 0;
  for (const [i, c] of faltando.entries()) {
    try {
      await dispatchWahaEvent(admin, c.sessao as never, c.envelope, `backfill-${i}`);
      ok++;
    } catch (err) {
      falhas++;
      console.error(`  falhou ${c.envelope.payload?.id}:`, err instanceof Error ? err.message : err);
    }
    if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${faltando.length}`);
  }
  console.log(`\nprocessadas: ${ok} | falhas: ${falhas}`);

  // ── Reconciliação dos carimbos ────────────────────────────────────────────
  // Recalcula a partir de `messages`, desfazendo o "agora" que o ingest gravou.
  console.log("\nreconciliando carimbos das conversas…");
  const conversas = await lerTudo<{ id: string }>(admin, (from, to) =>
    admin.from("conversations").select("id").range(from, to),
  );

  let ajustadas = 0;
  for (const conv of conversas) {
    const ultima = async (direcao?: "inbound" | "outbound") => {
      let q = admin
        .from("messages")
        .select("sent_at, body, type")
        .eq("conversation_id", conv.id)
        .order("sent_at", { ascending: false })
        .limit(1);
      if (direcao) q = q.eq("direction", direcao);
      const { data } = await q.maybeSingle();
      return data as { sent_at: string; body: string | null; type: string } | null;
    };

    const [geral, entrada, saida] = await Promise.all([ultima(), ultima("inbound"), ultima("outbound")]);
    if (!geral) continue;

    const { error } = await admin
      .from("conversations")
      .update({
        last_message_at: geral.sent_at,
        last_message_preview: preview(geral.body, geral.type),
        last_inbound_at: entrada?.sent_at ?? null,
        last_outbound_at: saida?.sent_at ?? null,
      })
      .eq("id", conv.id);
    if (error) console.error(`  conversa ${conv.id}: ${error.message}`);
    else ajustadas++;
  }
  console.log(`conversas reconciliadas: ${ajustadas}`);
  console.log("\nPronto.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
