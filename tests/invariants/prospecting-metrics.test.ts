import { beforeAll, describe, expect, it } from "vitest";

import { indexExists, lastLine, sql } from "./gov-helpers";

/**
 * 0093 — fn_prospecting_metrics (seção "// prospecção" do Painel). Dataset
 * SEED CONHECIDO e números EXATOS, no molde da gov-8-metrics.
 *
 * O que cada lead/contato do seed PROVA:
 *   · L1: dialeto HTTP do payload ({from_stage_id, to_stage_id});
 *   · L2: dialeto do agente ({de, para}) + atividade DUPLICADA → conta UMA vez;
 *   · L3: lead criado DIRETO na etapa (sem stage_changed) → nascimento conta;
 *   · L4: nascimento na etapa de entrada dentro da janela;
 *   · L5: movimento FORA da janela não conta;
 *   · L6: movimento na janela ANTERIOR → entered_prev=1 (e null sem p_prev_*);
 *   · CT4: outbound da IA (sent_by_user_id null) CONTA como contato;
 *   · CT5: inbound ANTES do 1º outbound não é resposta;
 *   · CT3: 1º outbound antes da janela → fora da coorte do período;
 *   · E4a+E4b: exausto que REENTROU na cadência não é vácuo;
 *   · org B: invocador da org A vê ZERO da org B (RLS, não seed vazio —
 *     o manager da própria org B vê os dados dela).
 *
 * Namespace d9930808… (exclusivo deste arquivo). Sem PII: e-mails
 * @invariant.test, títulos sintéticos, timestamps LITERAIS fixos.
 */

const ORG = "d9930808-0000-4000-8000-000000000001";
const MANAGER = "d9930808-1111-4000-8000-000000000001";
const SESSION = "d9930808-2222-4000-8000-000000000001";
const CT1 = "d9930808-3333-4000-8000-000000000001";
const CT2 = "d9930808-3333-4000-8000-000000000002";
const CT3 = "d9930808-3333-4000-8000-000000000003";
const CT4 = "d9930808-3333-4000-8000-000000000004";
const CT5 = "d9930808-3333-4000-8000-000000000005";
const CV1 = "d9930808-4444-4000-8000-000000000001";
const CV2 = "d9930808-4444-4000-8000-000000000002";
const CV3 = "d9930808-4444-4000-8000-000000000003";
const CV4 = "d9930808-4444-4000-8000-000000000004";
const CV5 = "d9930808-4444-4000-8000-000000000005";
const PIPELINE = "d9930808-5555-4000-8000-000000000001";
const CAPT = "d9930808-5555-4000-8000-000000000002";
const R1A = "d9930808-5555-4000-8000-000000000003";
const R1F = "d9930808-5555-4000-8000-000000000004";
const L1 = "d9930808-6666-4000-8000-000000000001";
const L2 = "d9930808-6666-4000-8000-000000000002";
const L3 = "d9930808-6666-4000-8000-000000000003";
const L4 = "d9930808-6666-4000-8000-000000000004";
const L5 = "d9930808-6666-4000-8000-000000000005";
const L6 = "d9930808-6666-4000-8000-000000000006";
const FP = "d9930808-7777-4000-8000-000000000001";
const FV = "d9930808-7777-4000-8000-000000000002";
const E1 = "d9930808-8888-4000-8000-000000000001";
const E2 = "d9930808-8888-4000-8000-000000000002";
const E3 = "d9930808-8888-4000-8000-000000000003";
const E4A = "d9930808-8888-4000-8000-000000000004";
const E4B = "d9930808-8888-4000-8000-000000000005";

// Org B — só para provar o isolamento RLS.
const ORG_B = "d9930808-0000-4000-8000-0000000000b1";
const MANAGER_B = "d9930808-1111-4000-8000-0000000000b1";
const SESSION_B = "d9930808-2222-4000-8000-0000000000b1";
const CTB = "d9930808-3333-4000-8000-0000000000b1";
const CVB = "d9930808-4444-4000-8000-0000000000b1";
const PIPE_B = "d9930808-5555-4000-8000-0000000000b1";
const SB = "d9930808-5555-4000-8000-0000000000b2";
const LB = "d9930808-6666-4000-8000-0000000000b1";

// Janela do teste (semiaberta) e janela anterior.
const FROM = "2026-07-01T00:00:00+00";
const TO = "2026-07-31T00:00:00+00";
const PREV_FROM = "2026-06-01T00:00:00+00";
const PREV_TO = "2026-07-01T00:00:00+00";
const IN = "2026-07-10T12:00:00+00";
const IN_2 = "2026-07-10T13:00:00+00";
const IN_3 = "2026-07-10T14:00:00+00";
const BEFORE_IN = "2026-07-09T12:00:00+00";
const PREV_IN = "2026-06-15T12:00:00+00";
const OLD = "2026-05-01T12:00:00+00";
const OLD_2 = "2026-05-01T13:00:00+00";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${MANAGER}',   'm93-manager-a@invariant.test'),
      ('${MANAGER_B}', 'm93-manager-b@invariant.test')
    on conflict do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}',   'prospecting-inv-a', 'Prospecting Inv A', 'Prosp A'),
      ('${ORG_B}', 'prospecting-inv-b', 'Prospecting Inv B', 'Prosp B')
    on conflict do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MANAGER}',   '${ORG}',   'manager', now()),
      ('${MANAGER_B}', '${ORG_B}', 'manager', now())
    on conflict do nothing;

    do $p93$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSION}', '${ORG}', 'prospecting-inv-a', '\\x00'::bytea);
    exception when unique_violation then null; end $p93$;
    do $p93b$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSION_B}', '${ORG_B}', 'prospecting-inv-b', '\\x00'::bytea);
    exception when unique_violation then null; end $p93b$;

    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${PIPELINE}', '${ORG}',   'Prospecção Inv', 'prospecting-inv'),
      ('${PIPE_B}',   '${ORG_B}', 'Prospecção B',   'prospecting-inv-b')
    on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${CAPT}', '${ORG}',   '${PIPELINE}', 'Captação',    'captacao',    1000),
      ('${R1A}',  '${ORG}',   '${PIPELINE}', 'R1 agendada', 'r1-agendada', 2000),
      ('${R1F}',  '${ORG}',   '${PIPELINE}', 'R1 feita',    'r1-feita',    3000),
      ('${SB}',   '${ORG_B}', '${PIPE_B}',   'Novo',        'novo',        1000)
    on conflict do nothing;

    insert into public.contacts (id, organization_id, display_name) values
      ('${CT1}', '${ORG}',   'P93 Contato 1'),
      ('${CT2}', '${ORG}',   'P93 Contato 2'),
      ('${CT3}', '${ORG}',   'P93 Contato 3'),
      ('${CT4}', '${ORG}',   'P93 Contato 4'),
      ('${CT5}', '${ORG}',   'P93 Contato 5'),
      ('${CTB}', '${ORG_B}', 'P93 Contato B')
    on conflict do nothing;

    -- LEADS. current stage/status fixos; "entrou na etapa" vem das atividades
    -- (ou do nascimento), NÃO do stage_id atual.
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status, created_at) values
      ('${L1}', '${ORG}', '${PIPELINE}', '${R1A}',  '${CT1}', 'P93 L1', 'open', '${OLD}'),
      ('${L2}', '${ORG}', '${PIPELINE}', '${R1A}',  '${CT2}', 'P93 L2', 'open', '${OLD}'),
      ('${L3}', '${ORG}', '${PIPELINE}', '${R1A}',  '${CT3}', 'P93 L3', 'open', '${IN}'),
      ('${L4}', '${ORG}', '${PIPELINE}', '${CAPT}', '${CT4}', 'P93 L4', 'open', '${IN}'),
      ('${L5}', '${ORG}', '${PIPELINE}', '${R1A}',  '${CT5}', 'P93 L5', 'open', '${OLD}'),
      ('${L6}', '${ORG}', '${PIPELINE}', '${R1A}',  null,     'P93 L6', 'open', '${OLD}')
    on conflict do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status, created_at) values
      ('${LB}', '${ORG_B}', '${PIPE_B}', '${SB}', '${CTB}', 'P93 LB', 'open', '${IN}')
    on conflict do nothing;

    -- ATIVIDADES stage_changed nos DOIS dialetos + duplicata + fora da janela.
    insert into public.crm_lead_activities (organization_id, lead_id, source_module, type, payload, performed_at)
    select * from (values
      -- L1: dialeto HTTP, na janela
      ('${ORG}'::uuid, '${L1}'::uuid, 'crm', 'stage_changed',
       '{"from_stage_id":"${CAPT}","to_stage_id":"${R1A}","pipeline_id":"${PIPELINE}"}'::jsonb, '${IN}'::timestamptz),
      -- L2: dialeto do AGENTE, na janela…
      ('${ORG}'::uuid, '${L2}'::uuid, 'crm', 'stage_changed',
       '{"passo_do_agente":"qualifying","de":"${CAPT}","para":"${R1A}"}'::jsonb, '${IN}'::timestamptz),
      -- …e a DUPLICATA (rota + sync emitindo o mesmo movimento)
      ('${ORG}'::uuid, '${L2}'::uuid, 'crm', 'stage_changed',
       '{"from_stage_id":"${CAPT}","to_stage_id":"${R1A}","pipeline_id":"${PIPELINE}"}'::jsonb, '${IN_2}'::timestamptz),
      -- L5: movimento FORA da janela
      ('${ORG}'::uuid, '${L5}'::uuid, 'crm', 'stage_changed',
       '{"from_stage_id":"${CAPT}","to_stage_id":"${R1A}","pipeline_id":"${PIPELINE}"}'::jsonb, '${OLD}'::timestamptz),
      -- L6: movimento na janela ANTERIOR
      ('${ORG}'::uuid, '${L6}'::uuid, 'crm', 'stage_changed',
       '{"from_stage_id":"${CAPT}","to_stage_id":"${R1A}","pipeline_id":"${PIPELINE}"}'::jsonb, '${PREV_IN}'::timestamptz)
    ) v(organization_id, lead_id, source_module, type, payload, performed_at)
    where not exists (
      select 1 from public.crm_lead_activities
      where lead_id = '${L1}' and type = 'stage_changed'
    );

    -- CONVERSAS (1 por contato — unique 1:1 por contato+sessão).
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CV1}', '${ORG}',   '${CT1}', '${SESSION}',   'open'),
      ('${CV2}', '${ORG}',   '${CT2}', '${SESSION}',   'open'),
      ('${CV3}', '${ORG}',   '${CT3}', '${SESSION}',   'open'),
      ('${CV4}', '${ORG}',   '${CT4}', '${SESSION}',   'open'),
      ('${CV5}', '${ORG}',   '${CT5}', '${SESSION}',   'open'),
      ('${CVB}', '${ORG_B}', '${CTB}', '${SESSION_B}', 'open')
    on conflict do nothing;

    -- MENSAGENS da taxa de resposta.
    insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, sent_via, sent_by_user_id, sent_at)
    select * from (values
      -- CT1: contatado na janela E respondeu depois
      ('${ORG}'::uuid, '${CV1}'::uuid, '${SESSION}'::uuid, '${CT1}'::uuid, 'text', 'outbound', 'crm', null::uuid, '${IN}'::timestamptz),
      ('${ORG}'::uuid, '${CV1}'::uuid, '${SESSION}'::uuid, '${CT1}'::uuid, 'text', 'inbound',  'crm', null::uuid, '${IN_2}'::timestamptz),
      -- CT2: contatado, NUNCA respondeu
      ('${ORG}'::uuid, '${CV2}'::uuid, '${SESSION}'::uuid, '${CT2}'::uuid, 'text', 'outbound', 'crm', null::uuid, '${IN}'::timestamptz),
      -- CT3: 1º outbound ANTES da janela (fora da coorte do período)
      ('${ORG}'::uuid, '${CV3}'::uuid, '${SESSION}'::uuid, '${CT3}'::uuid, 'text', 'outbound', 'crm', null::uuid, '${OLD}'::timestamptz),
      ('${ORG}'::uuid, '${CV3}'::uuid, '${SESSION}'::uuid, '${CT3}'::uuid, 'text', 'inbound',  'crm', null::uuid, '${OLD_2}'::timestamptz),
      -- CT4: outbound da IA conta como contato; respondeu depois
      ('${ORG}'::uuid, '${CV4}'::uuid, '${SESSION}'::uuid, '${CT4}'::uuid, 'text', 'outbound', 'ai',  null::uuid, '${IN}'::timestamptz),
      ('${ORG}'::uuid, '${CV4}'::uuid, '${SESSION}'::uuid, '${CT4}'::uuid, 'text', 'inbound',  'crm', null::uuid, '${IN_3}'::timestamptz),
      -- CT5: inbound ANTES do 1º outbound NÃO é resposta
      ('${ORG}'::uuid, '${CV5}'::uuid, '${SESSION}'::uuid, '${CT5}'::uuid, 'text', 'inbound',  'crm', null::uuid, '${BEFORE_IN}'::timestamptz),
      ('${ORG}'::uuid, '${CV5}'::uuid, '${SESSION}'::uuid, '${CT5}'::uuid, 'text', 'outbound', 'crm', null::uuid, '${IN}'::timestamptz),
      -- Org B: 1 contatado (sanidade do isolamento)
      ('${ORG_B}'::uuid, '${CVB}'::uuid, '${SESSION_B}'::uuid, '${CTB}'::uuid, 'text', 'outbound', 'crm', null::uuid, '${IN}'::timestamptz)
    ) v(organization_id, conversation_id, channel_session_id, contact_id, type, direction, sent_via, sent_by_user_id, sent_at)
    where not exists (
      select 1 from public.messages where conversation_id = '${CV1}'
    );

    -- FOLLOW-UP: fluxo + enrollments.
    insert into public.followup_flow_versions (id, organization_id, graph)
      values ('${FV}', '${ORG}', '{"nodes":[]}') on conflict do nothing;
    insert into public.followup_flow_pointers (id, organization_id, name, status, active_version_id)
      values ('${FP}', '${ORG}', 'P93 Cadência', 'active', '${FV}') on conflict do nothing;
    insert into public.followup_enrollments (id, organization_id, pointer_id, version_id, contact_id, current_node_id, status, next_eval_at, outcome, started_at, completed_at) values
      -- vivos: D2 (espera) e D5 (aguardando resposta)
      ('${E1}',  '${ORG}', '${FP}', '${FV}', '${CT1}', 'espera_d2', 'active',        '2026-09-01T00:00:00+00', null, '${IN}', null),
      ('${E2}',  '${ORG}', '${FP}', '${FV}', '${CT2}', 'espera_d5', 'waiting_reply', '2026-09-01T00:00:00+00', null, '${IN}', null),
      -- CT3: terminou a cadência sem responder ⇒ NO VÁCUO
      ('${E3}',  '${ORG}', '${FP}', '${FV}', '${CT3}', 'fim_sem_resposta', 'completed', null, 'exhausted', '${IN}', '${IN_2}'),
      -- CT4: exausto ANTIGO + reentrou vivo ⇒ não é vácuo (e soma no D2)
      ('${E4A}', '${ORG}', '${FP}', '${FV}', '${CT4}', 'fim_sem_resposta', 'completed', null, 'exhausted', '${OLD}', '${OLD_2}'),
      ('${E4B}', '${ORG}', '${FP}', '${FV}', '${CT4}', 'envia_d2', 'active', '2026-09-01T00:00:00+00', null, '${IN}', null)
    on conflict do nothing;
  `);
});

// Claims silenciosos (DO block não polui o stdout do psql -tA).
function asRole(actorId: string): string {
  return `set role authenticated;
    do $c$ begin perform set_config('request.jwt.claims', '{"sub":"${actorId}"}', false); end $c$;`;
}

function fnCall(org: string, pipeline: string, prev: boolean): string {
  const prevArgs = prev ? `, '${PREV_FROM}', '${PREV_TO}'` : "";
  return `public.fn_prospecting_metrics('${org}', '${pipeline}', '${FROM}', '${TO}'${prevArgs})`;
}

/** Campo de uma etapa do funnel; 'null' para JSON null; 'MISSING' se a etapa sumiu. */
function funnelField(
  actor: string,
  stageId: string,
  field: string,
  opts: { org?: string; pipeline?: string; prev?: boolean } = {},
): string {
  const out = sql(`
    ${asRole(actor)}
    select 'VAL:' || coalesce((
      select coalesce(f->>'${field}', 'null')
      from jsonb_array_elements(${fnCall(opts.org ?? ORG, opts.pipeline ?? PIPELINE, opts.prev ?? false)} -> 'funnel') f
      where f->>'stage_id' = '${stageId}'
    ), 'MISSING');
  `);
  return lastLine(out).replace(/^VAL:/, "");
}

/** Valor escalar por caminho jsonb ('{response,contacted}'); 'null' p/ JSON null. */
function scalarAt(
  actor: string,
  path: string,
  opts: { org?: string; pipeline?: string; prev?: boolean } = {},
): string {
  const out = sql(`
    ${asRole(actor)}
    select 'VAL:' || coalesce(
      ${fnCall(opts.org ?? ORG, opts.pipeline ?? PIPELINE, opts.prev ?? false)} #>> '${path}',
      'null'
    );
  `);
  return lastLine(out).replace(/^VAL:/, "");
}

function dayCount(actor: string, day: string): string {
  const out = sql(`
    ${asRole(actor)}
    select 'VAL:' || coalesce((
      select d->>'count'
      from jsonb_array_elements(${fnCall(ORG, PIPELINE, false)} #> '{followup,by_day}') d
      where d->>'day' = '${day}'
    ), '0');
  `);
  return lastLine(out).replace(/^VAL:/, "");
}

describe("0093 — fn_prospecting_metrics (números exatos)", () => {
  // ---- funil: entradas por etapa ----
  it("R1 agendada: entered=3 (dialeto HTTP + dialeto agente dedupado + nascimento; OLD e prev fora)", () => {
    expect(funnelField(MANAGER, R1A, "entered")).toBe("3");
  });

  it("Captação: entered=1 (só o nascimento na janela; nascidos antes não contam)", () => {
    expect(funnelField(MANAGER, CAPT, "entered")).toBe("1");
  });

  it("R1 feita: entered=0 (etapa presente no payload mesmo zerada)", () => {
    expect(funnelField(MANAGER, R1F, "entered")).toBe("0");
  });

  it("open_now é ESTOQUE: R1A=5 e Captação=1, independente da janela", () => {
    expect(funnelField(MANAGER, R1A, "open_now")).toBe("5");
    expect(funnelField(MANAGER, CAPT, "open_now")).toBe("1");
  });

  it("entered_prev: null SEM p_prev_*; 1 COM a janela anterior (o movimento de junho)", () => {
    expect(funnelField(MANAGER, R1A, "entered_prev")).toBe("null");
    expect(funnelField(MANAGER, R1A, "entered_prev", { prev: true })).toBe("1");
  });

  // ---- taxa de resposta ----
  it("contacted=4 (CT1, CT2, CT4-IA, CT5; CT3 foi contatado antes da janela)", () => {
    expect(scalarAt(MANAGER, "{response,contacted}")).toBe("4");
  });

  it("replied=2 (CT1 e CT4; inbound ANTES do 1º outbound do CT5 não é resposta)", () => {
    expect(scalarAt(MANAGER, "{response,replied}")).toBe("2");
  });

  it("prev_contacted: null sem p_prev_*; 0 com janela anterior (ninguém contatado em junho)", () => {
    expect(scalarAt(MANAGER, "{response,prev_contacted}")).toBe("null");
    expect(scalarAt(MANAGER, "{response,prev_contacted}", { prev: true })).toBe("0");
  });

  // ---- follow-up ----
  it("live_total=3 (espera_d2 + espera_d5 + envia_d2 reentrado)", () => {
    expect(scalarAt(MANAGER, "{followup,live_total}")).toBe("3");
  });

  it("by_day: D2=2 (envia+espera contam no mesmo dia) e D5=1", () => {
    expect(dayCount(MANAGER, "D2")).toBe("2");
    expect(dayCount(MANAGER, "D5")).toBe("1");
  });

  it("vácuo=1 (CT3; o exausto que REENTROU na cadência — CT4 — não conta)", () => {
    expect(scalarAt(MANAGER, "{followup,vacuo}")).toBe("1");
  });

  // ---- isolamento RLS ----
  it("manager da org A pedindo a org B vê ZERO em tudo (funnel vazio — RLS esconde as etapas)", () => {
    const out = sql(`
      ${asRole(MANAGER)}
      select 'VAL:' || (${fnCall(ORG_B, PIPE_B, false)} -> 'funnel')::text;
    `);
    expect(lastLine(out).replace(/^VAL:/, "")).toBe("[]");
    expect(scalarAt(MANAGER, "{response,contacted}", { org: ORG_B, pipeline: PIPE_B })).toBe("0");
    expect(scalarAt(MANAGER, "{followup,live_total}", { org: ORG_B, pipeline: PIPE_B })).toBe("0");
    expect(scalarAt(MANAGER, "{followup,vacuo}", { org: ORG_B, pipeline: PIPE_B })).toBe("0");
  });

  it("sanidade do isolamento: o manager da PRÓPRIA org B vê os dados dela", () => {
    expect(funnelField(MANAGER_B, SB, "entered", { org: ORG_B, pipeline: PIPE_B })).toBe("1");
    expect(scalarAt(MANAGER_B, "{response,contacted}", { org: ORG_B, pipeline: PIPE_B })).toBe("1");
  });

  // ---- índice da coorte de resposta ----
  it("índice idx_messages_org_contact_dir_sent existe (a coorte lê messages por contato)", () => {
    expect(indexExists("idx_messages_org_contact_dir_sent")).toBe(true);
  });
});
