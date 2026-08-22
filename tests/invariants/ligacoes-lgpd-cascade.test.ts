import { beforeAll, describe, expect, it } from "vitest";

import { sql, tableExists } from "./gov-helpers";

/**
 * O que este invariante protege: **anonimizar um contato tem de apagar a voz
 * dele.**
 *
 * A transcrição de uma ligação é a conversa do titular palavra por palavra, e o
 * áudio é a voz dele. É o material mais denso em dado pessoal que este produto
 * guarda — e é também o mais fácil de esquecer, porque a cascata LGPD
 * (`fn_lgpd_cascade_redact_contact`) é uma função longa que ninguém relê ao
 * criar uma tabela nova. O modo de falha não tem sintoma nenhum: a tela diz
 * "Contato anonimizado", a auditoria registra `lgpd.redact_executed`, e a
 * gravação continua no banco e no bucket. Só um teste vê isso.
 *
 * Roda contra o Postgres efêmero do `pnpm test:db`, que nasce do `baseline.sql`
 * versionado — ou seja, prova o arquivo que o self-hoster de fato aplica, não o
 * banco de dev de quem escreveu.
 */

const ORG = "d9d9d9d9-0000-4000-8000-000000000001";
const USER = "d9d9d9d9-1111-4000-8000-000000000001";
const CONTACT = "d9d9d9d9-3333-4000-8000-000000000001";
const CALL = "d9d9d9d9-4444-4000-8000-000000000001";
const REQUEST = "d9d9d9d9-5555-4000-8000-000000000001";
const AUDIO_PATH = `${ORG}/${CONTACT}/${CALL}.webm`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER}', 'ligacoes-lgpd@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'ligacoes-lgpd', 'Ligacoes LGPD', 'Ligacoes LGPD')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER}', '${ORG}', 'admin', now())
      on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name, phone_number)
      values ('${CONTACT}', '${ORG}', 'Contato Sintetico Ligacoes', '+5577900000000')
      on conflict (id) do nothing;

    -- O pedido LGPD tem de existir de verdade: storage_redaction_queue.request_id
    -- é FK para cá. Sem esta linha o enfileiramento do áudio estoura com violação
    -- de FK — e foi exatamente assim que a primeira execução deste teste PROVOU
    -- que o caminho novo passa mesmo pela fila, em vez de passar verde por
    -- vacuidade.
    insert into public.lgpd_requests (id, organization_id, request_type, source, contact_id, due_at)
      values ('${REQUEST}', '${ORG}', 'redact', 'manual', '${CONTACT}', now() + interval '15 days')
      on conflict (id) do nothing;

    -- Conteúdo sintético: nenhum dado real entra num teste (LGPD).
    insert into public.crm_call_recordings
      (id, organization_id, contact_id, status, outcome, score, storage_path, transcript, analysis, error_detail, sdr_notes, live_state)
      values (
        '${CALL}', '${ORG}', '${CONTACT}', 'done', 'agendou', 8.0,
        '${AUDIO_PATH}',
        'SDR: bom dia. LEAD: aqui e o Fulano Sintetico, meu telefone e 77900000000.',
        '{"resultado":"agendou","nota_geral":8}'::jsonb,
        'detalhe sintetico',
        'o socio sintetico e quem decide, ligar depois das 18h',
        '{"fase":"decisor","sugestao":"pergunte quem decide com voce","cobertura":{"dor_declarada":true}}'::jsonb
      )
      on conflict (id) do nothing;

    select public.fn_lgpd_cascade_redact_contact('${ORG}', '${CONTACT}', '${REQUEST}');
  `);
});

describe("cascata LGPD alcança as gravações de ligação (migration 0100)", () => {
  it("a tabela existe no baseline", () => {
    // Guarda contra verde vácuo: sem a tabela, todo `select` abaixo devolveria
    // zero linhas e os testes passariam sem ter verificado nada.
    expect(tableExists("crm_call_recordings")).toBe(true);
  });

  it("a transcrição foi zerada", () => {
    const n = Number(
      sql(
        `select count(*) from public.crm_call_recordings where id = '${CALL}' and transcript is null;`,
      ),
    );
    expect(n).toBe(1);
  });

  it("a análise e o detalhe de erro foram zerados", () => {
    const n = Number(
      sql(
        `select count(*) from public.crm_call_recordings
          where id = '${CALL}' and analysis is null and error_detail is null;`,
      ),
    );
    expect(n).toBe(1);
  });

  it("a anotação do SDR e o estado do copiloto foram zerados (0106)", () => {
    // As duas colunas nasceram DEPOIS desta cascata existir, e é exatamente aí
    // que uma coluna de PII escapa: ninguém relê uma função de 200 linhas ao
    // acrescentar um campo. `sdr_notes` é uma pessoa escrevendo sobre outra
    // ("o sócio é quem decide"); `live_state` carrega a última sugestão, que
    // cita o que o lead falou.
    const n = Number(
      sql(
        `select count(*) from public.crm_call_recordings
          where id = '${CALL}' and sdr_notes is null and live_state = '{}'::jsonb;`,
      ),
    );
    expect(n).toBe(1);
  });

  it("o áudio foi enfileirado para exclusão NO BUCKET CERTO", () => {
    // O bucket errado é a falha traiçoeira: o worker de storage procuraria o
    // objeto em `whatsapp-media`, não acharia, marcaria como apagado — e o áudio
    // continuaria no `call-recordings`, com a auditoria dizendo que sumiu.
    const n = Number(
      sql(
        `select count(*) from public.storage_redaction_queue
          where organization_id = '${ORG}'
            and bucket = 'call-recordings'
            and object_path = '${AUDIO_PATH}';`,
      ),
    );
    expect(n).toBe(1);
  });

  it("o ponteiro para o áudio saiu da linha DEPOIS de entrar na fila", () => {
    // Zerar `storage_path` antes de coletar deixaria o objeto órfão no bucket:
    // inalcançável e não apagado. Este teste só passa se a ordem estiver certa,
    // porque a asserção anterior exige o caminho na fila.
    const n = Number(
      sql(
        `select count(*) from public.crm_call_recordings where id = '${CALL}' and storage_path is null;`,
      ),
    );
    expect(n).toBe(1);
  });

  it("status e desfecho PERMANECEM — são fato operacional, não dado pessoal", () => {
    // Mesmo critério que preserva valor e estágio do negócio: "houve uma ligação
    // e ela agendou reunião" é sobre a empresa. Apagar isso destruiria o
    // histórico de prospecção sem proteger ninguém.
    const linha = sql(
      `select status || '|' || coalesce(outcome, '') from public.crm_call_recordings where id = '${CALL}';`,
    );
    expect(linha).toBe("done|agendou");
  });

  it("a auditoria conta quantas gravações foram enfileiradas", () => {
    const n = Number(
      sql(
        `select count(*) from public.api_audit_log
          where organization_id = '${ORG}'
            and action = 'lgpd.redact_executed'
            and (metadata->>'call_recordings_queued')::int >= 1;`,
      ),
    );
    expect(n).toBeGreaterThanOrEqual(1);
  });
});
