/**
 * Gatilho de SILÊNCIO (Task 8.1) — TIME-DRIVEN, não event-driven. Roda como
 * uma varredura periódica dentro do MESMO tick do cron
 * `app/api/v1/cron/followup-flow-worker/route.ts`, lado a lado com
 * `runFollowupTick` (lib/followup/engine.ts) — decisão de arquitetura já
 * tomada (ver HANDOFF): silêncio não tem um EVENTO que o dispare (é ausência
 * de evento por um período), então não pertence a `reactivity.ts` (que reage
 * a linhas de `event_log`).
 *
 * Fluxo por tick: acha pointers `status='active'` com `trigger_config.kind=
 * 'silence'` (de TODAS as orgs — mesmo design cross-org do
 * `fn_claim_due_followup_enrollments`) → GATEIA cada um via
 * `isPointerEnabledForAutomaticTrigger` (Task 7.2 — só enrolla se algum
 * agente PUBLICADO da org tem esse pointer habilitado) → acha contatos
 * silenciosos da org (sem inbound há >= threshold_minutes) → cria 1
 * enrollment por (pointer, contato) qualificado, nascendo no nó `trigger` do
 * grafo pinado com `next_eval_at=now`. Como `runSilenceSweep` roda DEPOIS de
 * `runFollowupTick` no MESMO tick do cron (route.ts), esse enrollment recém-
 * criado só é reclamado no PRÓXIMO tick (~1min depois), não neste.
 *
 * Idempotência + exclusividade: o índice único `idx_followup_enrollments_one_live`
 * é ORG-WIDE `(organization_id, contact_id)` (migration 0062, Task 8.6) — um
 * contato já vivo em QUALQUER fluxo da org barra novo enrollment (1 follow-up
 * vivo por lead), 23505 vira skip silencioso (`insertEnrollment` devolve
 * `inserted:false`), nunca erro.
 *
 * COOLDOWN de re-inscrição (incidente de 10/08/2026): o índice só barra
 * enrollment VIVO — com o LLM quebrado, o enrollment morria em minutos e o
 * tick seguinte re-inscrevia o MESMO contato (38 leads → 4.566 enrollments em
 * 24h). Agora um contato com QUALQUER enrollment iniciado há menos de
 * `SILENCE_REENROLL_COOLDOWN_MS` (24h, org-wide, qualquer status) é pulado —
 * sem tabela nova: a régua é `followup_enrollments.started_at`. O check é
 * best-effort (fora de transação com o insert); a corrida residual de 1 tick
 * é inócua — o índice unique-live segura duplicata viva, e o custo de 1
 * re-inscrição precoce é 1 job, não um loop.
 *
 * agent_id: cada pointer é gateado por `resolveAgentForAutomaticTrigger`, que
 * devolve o agente publicado que ARMA o pointer (menor uuid se >1) — esse
 * agent_id é PINADO no enrollment (persona + exibição na fila). `null` = gate-out.
 *
 * `segments`: única primitiva de segmentação já modelada no schema é
 * `contacts.tags` (GIN index `idx_contacts_tags_gin` já existe) — interpretado
 * como overlap entre `trigger_config.params.segments` e `contacts.tags`.
 * `segments` vazio/ausente = todos os contatos silenciosos da org.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { flowGraphSchema } from "./graph-schema";
import { triggerConfigSchema } from "./api-schemas";
import { resolveAgentForAutomaticTrigger, type FollowupGateDb } from "./agent-followup-gate";

export interface SilencePointer {
  id: string;
  organization_id: string;
  active_version_id: string;
  threshold_minutes: number;
  segments: string[];
  /** Ver `include_never_replied` em api-schemas.ts — prospecção fria. */
  includeNeverReplied: boolean;
}

/** DB surface o sweep precisa — narrow por consumidor (mesma doutrina de `AdminClient`/`ReactivityAdminClient`/`FollowupGateDb`). */
export interface SilenceSweepDb {
  /** Pointers ativos com trigger_config.kind='silence', de TODAS as orgs. */
  loadActiveSilencePointers(): Promise<SilencePointer[]>;
  /**
   * Contact ids da org sem inbound desde `cutoffIso` (inclusive); `segments` vazio = todos.
   *
   * `includeNeverReplied` (4º parâmetro, opcional para não quebrar adapters
   * antigos): quando true, contato SEM nenhum inbound também conta como
   * silencioso, medido pelo `last_outbound_at` — é o lead frio prospectado.
   */
  loadSilentContactIds(
    orgId: string,
    cutoffIso: string,
    segments: string[],
    includeNeverReplied?: boolean,
  ): Promise<string[]>;
  /** id do nó `trigger` do grafo pinado da version; `null` se version/nó não existir (defensivo — não deveria acontecer, validate-publish garante 1 trigger). */
  loadTriggerNodeId(orgId: string, versionId: string): Promise<string | null>;
  /**
   * Contact ids da org com QUALQUER enrollment (qualquer pointer, qualquer
   * status) iniciado em/depois de `sinceIso` — o cooldown de re-inscrição.
   * Opcional para não quebrar adapters/fakes antigos (mesmo padrão de
   * `includeNeverReplied`); ausente = sem cooldown.
   */
  loadRecentEnrollmentContactIds?(orgId: string, sinceIso: string): Promise<string[]>;
  /** Insere o enrollment nascendo no nó trigger; `inserted:false` = 23505 (já vivo nesse pointer) → skip. */
  insertEnrollment(input: {
    organization_id: string;
    pointer_id: string;
    version_id: string;
    contact_id: string;
    current_node_id: string;
    next_eval_at: string;
    agent_id: string | null;
  }): Promise<{ inserted: boolean }>;
}

export interface SilenceSweepSummary {
  pointers_scanned: number;
  pointers_gated_out: number;
  enrolled: number;
  skipped_existing: number;
  /** Pulados pelo cooldown de 24h — tiveram enrollment iniciado há pouco. */
  skipped_cooldown: number;
}

/** Cooldown org-wide de re-inscrição por contato (ver header). */
export const SILENCE_REENROLL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface SilenceSweepDeps {
  db: SilenceSweepDb;
  gateDb: FollowupGateDb;
  clock: () => Date;
}

export async function runSilenceSweep(deps: SilenceSweepDeps): Promise<SilenceSweepSummary> {
  const { db, gateDb, clock } = deps;
  const summary: SilenceSweepSummary = {
    pointers_scanned: 0,
    pointers_gated_out: 0,
    enrolled: 0,
    skipped_existing: 0,
    skipped_cooldown: 0,
  };

  const pointers = await db.loadActiveSilencePointers();
  summary.pointers_scanned = pointers.length;

  // Memoiza a resolução do agente por pointer dentro desta varredura — nada
  // impede 2 pointers silence na mesma org, e a query do gate já é 1 por org
  // (não precisa repetir). `null` = gate-out (nenhum agente publicado arma o
  // pointer); qualquer agent_id = habilitado E já pinado (o mesmo id que vai
  // pro enrollment). Colapsa gate + pick numa chamada só (Task 8.6).
  const agentCache = new Map<string, Promise<string | null>>();
  const resolveAgent = (orgId: string, pointerId: string): Promise<string | null> => {
    const key = `${orgId}:${pointerId}`;
    let hit = agentCache.get(key);
    if (!hit) {
      hit = resolveAgentForAutomaticTrigger(gateDb, orgId, pointerId);
      agentCache.set(key, hit);
    }
    return hit;
  };

  // Cooldown é ORG-WIDE — memoiza o Set por org dentro desta varredura (2
  // pointers na mesma org não repetem a query), mesmo racional do agentCache.
  const cooldownCache = new Map<string, Promise<Set<string>>>();
  const loadCooldownSet = (orgId: string): Promise<Set<string>> => {
    let hit = cooldownCache.get(orgId);
    if (!hit) {
      hit =
        db.loadRecentEnrollmentContactIds === undefined
          ? Promise.resolve(new Set<string>())
          : db
              .loadRecentEnrollmentContactIds(
                orgId,
                new Date(clock().getTime() - SILENCE_REENROLL_COOLDOWN_MS).toISOString(),
              )
              .then((ids) => new Set(ids));
      cooldownCache.set(orgId, hit);
    }
    return hit;
  };

  for (const pointer of pointers) {
    const agentId = await resolveAgent(pointer.organization_id, pointer.id);
    if (agentId === null) {
      summary.pointers_gated_out++;
      continue;
    }

    const triggerNodeId = await db.loadTriggerNodeId(pointer.organization_id, pointer.active_version_id);
    if (!triggerNodeId) continue;

    const cutoffIso = new Date(clock().getTime() - pointer.threshold_minutes * 60_000).toISOString();
    const contactIds = await db.loadSilentContactIds(
      pointer.organization_id,
      cutoffIso,
      pointer.segments,
      pointer.includeNeverReplied,
    );
    const nextEvalAt = clock().toISOString();
    const emCooldown = await loadCooldownSet(pointer.organization_id);

    for (const contactId of contactIds) {
      if (emCooldown.has(contactId)) {
        summary.skipped_cooldown++;
        continue;
      }
      const { inserted } = await db.insertEnrollment({
        organization_id: pointer.organization_id,
        pointer_id: pointer.id,
        version_id: pointer.active_version_id,
        contact_id: contactId,
        current_node_id: triggerNodeId,
        next_eval_at: nextEvalAt,
        agent_id: agentId,
      });
      if (inserted) summary.enrolled++;
      else summary.skipped_existing++;
    }
  }

  return summary;
}

type ContactEmbed = { tags: string[] | null; is_blocked: boolean | null } | null;

/** Production adapter: `SilenceSweepDb` sobre o client service-role real. */
export function createSupabaseSilenceSweepDb(admin: SupabaseClient): SilenceSweepDb {
  return {
    async loadActiveSilencePointers() {
      const { data, error } = await admin
        .from("followup_flow_pointers")
        .select("id, organization_id, active_version_id, trigger_config")
        .eq("status", "active")
        .not("active_version_id", "is", null);
      if (error) throw new Error(error.message);

      const pointers: SilencePointer[] = [];
      for (const row of (data ?? []) as Array<{
        id: string;
        organization_id: string;
        active_version_id: string | null;
        trigger_config: unknown;
      }>) {
        if (!row.active_version_id) continue;
        const parsed = triggerConfigSchema.safeParse(row.trigger_config);
        if (!parsed.success || parsed.data.kind !== "silence") continue;
        pointers.push({
          id: row.id,
          organization_id: row.organization_id,
          active_version_id: row.active_version_id,
          threshold_minutes: parsed.data.params.threshold_minutes,
          segments: parsed.data.params.segments ?? [],
          includeNeverReplied: parsed.data.params.include_never_replied ?? false,
        });
      }
      return pointers;
    },

    async loadSilentContactIds(orgId, cutoffIso, segments, includeNeverReplied = false) {
      // last_inbound_at é POR CONVERSA; o enrollment é POR CONTATO — reduz
      // client-side pro MAIS RECENTE `last_inbound_at` entre as conversas do
      // contato (um contato com 2+ channel_sessions não pode ser marcado
      // silencioso por causa da conversa mais antiga se a mais nova respondeu).
      //
      // Com `includeNeverReplied`, a conversa SEM inbound deixa de ser
      // descartada e passa a valer pelo `last_outbound_at`. O filtro de linhas
      // afrouxa, mas a redução por contato NÃO: qualquer inbound real, em
      // qualquer conversa, continua ganhando do outbound — senão um contato que
      // respondeu numa conversa e só ouviu na outra entraria como silencioso.
      const query = admin
        .from("conversations")
        .select("contact_id, last_inbound_at, last_outbound_at, contacts:contact_id(tags, is_blocked)")
        .eq("organization_id", orgId);
      const { data, error } = includeNeverReplied
        ? await query.or("last_inbound_at.not.is.null,last_outbound_at.not.is.null")
        : await query.not("last_inbound_at", "is", null);
      if (error) throw new Error(error.message);

      type Row = {
        contact_id: string;
        last_inbound_at: string | null;
        last_outbound_at: string | null;
        contacts: ContactEmbed;
      };
      const cutoff = new Date(cutoffIso).getTime();
      // `replied` marca que o instante veio de um inbound de verdade. Inbound
      // sempre vence outbound na redução, por mais velho que seja: quem já
      // respondeu não é "nunca respondeu", e a régua dele é a do silêncio
      // clássico.
      const latest = new Map<string, { at: number; replied: boolean; tags: string[]; blocked: boolean }>();
      for (const row of (data ?? []) as unknown as Row[]) {
        const inboundAt = row.last_inbound_at === null ? null : new Date(row.last_inbound_at).getTime();
        const outboundAt =
          !includeNeverReplied || row.last_outbound_at === null
            ? null
            : new Date(row.last_outbound_at).getTime();
        const replied = inboundAt !== null;
        const at = replied ? inboundAt : outboundAt;
        if (at === null || Number.isNaN(at)) continue; // conversa muda dos dois lados: nada a medir

        const prev = latest.get(row.contact_id);
        const ganha =
          !prev ||
          (replied && !prev.replied) || // inbound sempre bate outbound
          (replied === prev.replied && at > prev.at); // mesma natureza: o mais recente
        if (ganha) {
          latest.set(row.contact_id, {
            at,
            replied,
            tags: row.contacts?.tags ?? [],
            blocked: row.contacts?.is_blocked ?? false,
          });
        }
      }

      const silentIds: string[] = [];
      for (const [contactId, v] of latest) {
        if (v.blocked) continue;
        if (v.at > cutoff) continue; // conversou depois do corte — não é silêncio
        if (segments.length > 0 && !segments.some((s) => v.tags.includes(s))) continue;
        silentIds.push(contactId);
      }
      return silentIds;
    },

    async loadTriggerNodeId(orgId, versionId) {
      const { data, error } = await admin
        .from("followup_flow_versions")
        .select("graph")
        .eq("organization_id", orgId)
        .eq("id", versionId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const graph = flowGraphSchema.parse(data.graph);
      return graph.nodes.find((n) => n.type === "trigger")?.id ?? null;
    },

    async loadRecentEnrollmentContactIds(orgId, sinceIso) {
      const { data, error } = await admin
        .from("followup_enrollments")
        .select("contact_id")
        .eq("organization_id", orgId)
        .gte("started_at", sinceIso);
      if (error) throw new Error(error.message);
      return [...new Set(((data ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id))];
    },

    async insertEnrollment(input) {
      // 23505 aqui agora é o índice ORG-WIDE (organization_id, contact_id) —
      // um contato já vivo em QUALQUER fluxo da org barra este insert (Task
      // 8.6: 1 follow-up vivo por lead). Vira skip silencioso, nunca erro.
      const { error } = await admin.from("followup_enrollments").insert(input);
      if (error) {
        if (error.code === "23505") return { inserted: false };
        throw new Error(error.message);
      }
      return { inserted: true };
    },
  };
}
