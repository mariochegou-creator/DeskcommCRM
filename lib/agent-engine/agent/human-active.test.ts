/**
 * Trava "humano no volante": o agente não responde por cima do atendente.
 *
 * O caso que originou o teste é de produção (05/08/2026): o time atende pelo
 * CELULAR — `sent_via='external_device'`, ninguém clica em "Assumir" — e o bot
 * respondeu no mesmo thread de um lead que um humano já estava tocando. O gate
 * de handoff não pegava: não houve handoff, só um humano trabalhando.
 */
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { HUMAN_ACTIVE_WINDOW_HOURS, isHumanHandlingConversation } from './human-handoff';

function poolAnswering(humano: boolean | null): { pool: pg.Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ rows: humano === null ? [] : [{ humano }] });
  return { pool: { query } as unknown as pg.Pool, query };
}

describe('isHumanHandlingConversation', () => {
  it('bloqueia o turno quando o banco acusa mão humana na conversa', async () => {
    const { pool } = poolAnswering(true);
    await expect(isHumanHandlingConversation(pool, 'org1', 'conv1')).resolves.toBe(true);
  });

  it('libera o turno quando não há humano na conversa', async () => {
    const { pool } = poolAnswering(false);
    await expect(isHumanHandlingConversation(pool, 'org1', 'conv1')).resolves.toBe(false);
  });

  it('libera o turno quando a conversa não existe (0 linhas) em vez de travar para sempre', async () => {
    const { pool } = poolAnswering(null);
    await expect(isHumanHandlingConversation(pool, 'org1', 'conv1')).resolves.toBe(false);
  });

  it('filtra por organization_id — sem isso a conversa de outro tenant calaria este bot', async () => {
    const { pool, query } = poolAnswering(false);
    await isHumanHandlingConversation(pool, 'org1', 'conv1');
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('v.organization_id = $1');
    expect(sql).toContain('m.organization_id = $1');
    expect(params[0]).toBe('org1');
    expect(params[1]).toBe('conv1');
  });

  it('conta como humano external_device, user e crm — e NUNCA ai/automation/system', async () => {
    const { pool, query } = poolAnswering(false);
    await isHumanHandlingConversation(pool, 'org1', 'conv1');
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    const sentVia = params[2] as string[];
    expect(sentVia).toEqual(['external_device', 'user', 'crm']);
    // A resposta do próprio agente é 'ai': se entrasse aqui, o bot se calaria
    // sozinho depois do primeiro turno e nunca mais responderia nada.
    expect(sentVia).not.toContain('ai');
    expect(sentVia).not.toContain('automation');
    expect(sentVia).not.toContain('system');
  });

  it('só olha outbound — mensagem do lead não é mão humana do nosso lado', async () => {
    const { pool, query } = poolAnswering(false);
    await isHumanHandlingConversation(pool, 'org1', 'conv1');
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain("m.direction = 'outbound'");
  });

  it('aplica a janela padrão de 24h e aceita override', async () => {
    const { pool, query } = poolAnswering(false);
    await isHumanHandlingConversation(pool, 'org1', 'conv1');
    expect((query.mock.calls[0] as [string, unknown[]])[1][3]).toBe(HUMAN_ACTIVE_WINDOW_HOURS);
    expect(HUMAN_ACTIVE_WINDOW_HOURS).toBe(24);

    const outra = poolAnswering(false);
    await isHumanHandlingConversation(outra.pool, 'org1', 'conv1', 2);
    expect((outra.query.mock.calls[0] as [string, unknown[]])[1][3]).toBe(2);
  });

  it('assignee_kind nulo não vira null propagado — coalesce mantém o resultado booleano', async () => {
    const { pool, query } = poolAnswering(false);
    await isHumanHandlingConversation(pool, 'org1', 'conv1');
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain("coalesce(v.assignee_kind = 'user', false)");
  });
});
