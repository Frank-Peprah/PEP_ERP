/**
 * Release 2 — financial statement engine, workflow and controls.
 * Spec §12: #10 statements from posted ledger only, #11 statements tie (SFP balances, CF reconciles,
 * SoCE ties, notes cast), #12 comparatives from approved snapshot, #16 SoD on approval,
 * #18 final packs immutable and reproducible, #21 unmapped balances block finalisation.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx;
const A: Record<string, string> = {};
const base = () => `/api/entities/${c.T}`;
const periods = async () => (await c.call('frank', 'GET', `${base()}/periods`)).json();
const periodId = async (fy: string, no: number) => (await periods()).find((f: any) => f.label === fy).periods.find((p: any) => p.period_no === no).id;
const line = (pack: any, code: string) => pack.sfp.sections.flatMap((s: any) => s.lines).find((l: any) => l.code === code);
const pl = (pack: any, key: string) => pack.pl.lines.find((l: any) => l.key === key);
const cfTotal = (pack: any, key: string) => pack.cf.sections.find((s: any) => s.key === key).total.current;
const act = (user: string, id: string, action: string, body?: unknown) => c.call(user, 'POST', `${base()}/statement-runs/${id}/${action}`, body);

beforeAll(async () => {
  c = await setup();
  for (const code of ['1100', '1300', '2100', '3100', '4100', '5100', '6200', '6900']) A[code] = await c.acct(c.T, code);
  // FY2025: capital 100,000; land 50,000 (30,000 cash, 20,000 on credit); sale 40,000; cost of land sold 20,000; rent 5,000.
  await postJournal(c, { journalDate: '2025-01-05', description: 'Capital', lines: [{ accountId: A['1100'], debit: '100000.00' }, { accountId: A['3100'], credit: '100000.00' }] });
  await postJournal(c, { journalDate: '2025-02-10', description: 'Land purchase', lines: [{ accountId: A['1300'], debit: '50000.00' }, { accountId: A['1100'], credit: '30000.00' }, { accountId: A['2100'], credit: '20000.00' }] });
  await postJournal(c, { journalDate: '2025-06-01', description: 'Plot sale', lines: [{ accountId: A['1100'], debit: '40000.00' }, { accountId: A['4100'], credit: '40000.00' }] });
  await postJournal(c, { journalDate: '2025-06-01', description: 'Cost of plot', lines: [{ accountId: A['5100'], debit: '20000.00' }, { accountId: A['1300'], credit: '20000.00' }] });
  await postJournal(c, { journalDate: '2025-07-01', description: 'Rent', lines: [{ accountId: A['6200'], debit: '5000.00' }, { accountId: A['1100'], credit: '5000.00' }] });
  // A draft that must never reach the statements.
  await c.call('ama', 'POST', `${base()}/journals`, { journalDate: '2025-08-01', description: 'draft only',
    lines: [{ accountId: A['1100'], debit: '777777.00' }, { accountId: A['4100'], credit: '777777.00' }] });
});
afterAll(async () => c.teardown());

describe('Statement engine (FY2025 year-end)', () => {
  let pack: any;
  beforeAll(async () => {
    const r = await c.call('ama', 'GET', `${base()}/statement-preview?periodId=${await periodId('2025', 12)}`);
    expect(r.statusCode).toBe(200);
    pack = r.json();
  });

  it('#10 derives from posted lines only (draft excluded)', () => {
    expect(line(pack, 'SFP_CASH').current).toBe('105000.00');
    expect(pl(pack, 'PL_REVENUE').current).toBe('40000.00');
    expect(pack.meta.source).toMatch(/posted/i);
  });

  it('#11 financial position balances and maps through the template', () => {
    expect(line(pack, 'SFP_INVENTORY').current).toBe('30000.00');
    expect(line(pack, 'SFP_PAYABLES').current).toBe('20000.00');
    expect(line(pack, 'EQ_CAPITAL').current).toBe('100000.00');
    expect(line(pack, 'EQ_RETAINED').current).toBe('15000.00');
    expect(pack.sfp.totals.current.assets).toBe('135000.00');
    expect(pack.sfp.totals.current.equityAndLiabilities).toBe('135000.00');
  });

  it('#11 profit or loss subtotals', () => {
    expect(pl(pack, 'PL_COST_OF_SALES').current).toBe('-20000.00');
    expect(pl(pack, 'gross_profit').current).toBe('20000.00');
    expect(pl(pack, 'operating_profit').current).toBe('15000.00');
    expect(pl(pack, 'profit').current).toBe('15000.00');
    expect(pack.pl.tci.current).toBe('15000.00');
  });

  it('#11 cash flows (indirect) reconcile to the movement in cash', () => {
    expect(cfTotal(pack, 'operating')).toBe('5000.00');
    expect(cfTotal(pack, 'investing')).toBe('0.00');
    expect(cfTotal(pack, 'financing')).toBe('100000.00');
    expect(pack.cf.net.current).toBe('105000.00');
    expect(pack.cf.closing.current).toBe('105000.00');
    expect(pack.cf.difference).toBe('0.00');
  });

  it('#11 changes in equity tie and notes cast', () => {
    const closing = pack.soce.current.find((r: any) => r.key === 'closing');
    expect(closing.total).toBe('115000.00');
    for (const ck of pack.checks) expect({ code: ck.code, passed: ck.passed }).toEqual({ code: ck.code, passed: true });
    const inv = pack.notes.find((n: any) => n.statementLine === 'SFP_INVENTORY');
    expect(inv.total).toBe('30000.00');
    expect(line(pack, 'SFP_INVENTORY').note).toBe(inv.no);
  });

  it('carries the draft / not audited disclaimer', () => {
    expect(pack.meta.disclaimer).toMatch(/Not audited/i);
  });
});

describe('Workflow, segregation of duties and immutability', () => {
  let finalId = '';

  it('open periods are a blocking exception; finalisation refused', async () => {
    const g = await c.call('ama', 'POST', `${base()}/statement-runs`, { periodId: await periodId('2025', 12) });
    expect(g.statusCode).toBe(201);
    const run = g.json();
    expect(run.status).toBe('draft');
    expect(run.exceptions.some((e: any) => e.code === 'PERIODS_NOT_LOCKED' && e.severity === 'blocking')).toBe(true);
    expect((await act('ama', run.id, 'submit')).statusCode).toBe(200);
    expect((await act('frank', run.id, 'approve')).statusCode).toBe(200);
    const f = await act('frank', run.id, 'finalize');
    expect(f.statusCode).toBe(422);
    expect(f.json().error.code).toBe('STATEMENT_HAS_BLOCKING_EXCEPTIONS');
  });

  it('#16 preparer cannot approve; approver role lacks statement approval; controller approves and finalises', async () => {
    for (const p of (await periods()).find((f: any) => f.label === '2025').periods) {
      const r = await c.call('frank', 'POST', `${base()}/periods/${p.id}/lock`, {});
      expect(r.statusCode).toBe(200);
    }
    const g = await c.call('ama', 'POST', `${base()}/statement-runs`, { periodId: await periodId('2025', 12) });
    const run = g.json();
    expect(run.blocking_count).toBe(0);
    expect(run.supersedes_run_id).toBeTruthy();
    const old = (await c.call('ama', 'GET', `${base()}/statement-runs/${run.supersedes_run_id}`)).json();
    expect(old.status).toBe('superseded');

    expect((await act('ama', run.id, 'approve')).statusCode).toBe(409); // still draft
    expect((await act('ama', run.id, 'submit')).statusCode).toBe(200);
    expect((await act('ama', run.id, 'approve')).statusCode).toBe(403);
    expect((await act('kofi', run.id, 'approve')).statusCode).toBe(403);
    expect((await act('frank', run.id, 'approve')).statusCode).toBe(200);
    expect((await act('kofi', run.id, 'finalize')).statusCode).toBe(403);
    const f = await act('frank', run.id, 'finalize');
    expect(f.statusCode).toBe(200);
    expect(f.json().status).toBe('final');
    finalId = run.id;
  });

  it('controller cannot approve a run they generated', async () => {
    const g = (await c.call('frank', 'POST', `${base()}/statement-runs`, { periodId: await periodId('2026', 3) })).json();
    expect((await act('frank', g.id, 'submit')).statusCode).toBe(200);
    const r = await act('frank', g.id, 'approve');
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await act('frank', g.id, 'reject', {})).statusCode).toBe(422); // reason required
    expect((await act('frank', g.id, 'reject', { reason: 'test' })).statusCode).toBe(200);
  });

  it('#18 final pack is hashed by the database and cannot be altered, re-statused or deleted', async () => {
    const run = (await c.call('auditor', 'GET', `${base()}/statement-runs/${finalId}`)).json();
    const row = (await c.db.query('SELECT pack::text AS p, content_hash FROM financial_statement_runs WHERE id = $1', [finalId])).rows[0];
    expect(row.content_hash).toBe(createHash('sha256').update(row.p).digest('hex'));
    expect(run.content_hash).toBe(row.content_hash);
    await expect(c.db.query(`UPDATE financial_statement_runs SET pack = '{}'::jsonb WHERE id = $1`, [finalId])).rejects.toThrow(/IMMUTABLE/);
    await expect(c.db.query(`UPDATE financial_statement_runs SET status = 'draft' WHERE id = $1`, [finalId])).rejects.toThrow(/IMMUTABLE/);
    await expect(c.db.query(`DELETE FROM financial_statement_runs WHERE id = $1`, [finalId])).rejects.toThrow(/DELETE_FORBIDDEN/);
    await expect(c.db.query(`UPDATE report_templates SET definition = '{}'::jsonb`)).rejects.toThrow(/TEMPLATE_IMMUTABLE/);
  });

  it('a run cannot be inserted already final, nor finalised without an independent approver (DB check)', async () => {
    await expect(c.db.query(
      `INSERT INTO financial_statement_runs (entity_id, run_no, period_id, period_end, fy_label, template_id, status, pack, blocking_count, source_fingerprint, content_hash, generated_by)
       SELECT entity_id, 999, period_id, period_end, fy_label, template_id, 'final', pack, 0, 'x', 'x', generated_by FROM financial_statement_runs WHERE id = $1`, [finalId]))
      .rejects.toThrow(/MUST_START_AS_DRAFT/);
  });

  it('#12 next year uses the final FY2025 pack as comparatives, unaffected by later mapping changes', async () => {
    await postJournal(c, { journalDate: '2026-02-01', description: 'FY26 sale', lines: [{ accountId: A['1100'], debit: '60000.00' }, { accountId: A['4100'], credit: '60000.00' }] });
    // Remap rent after FY2025 was finalised.
    expect((await c.call('frank', 'PATCH', `${base()}/accounts/${A['6200']}`, { statementLineCode: 'PL_OTHER_EXP' })).statusCode).toBe(200);
    const pack = (await c.call('ama', 'GET', `${base()}/statement-preview?periodId=${await periodId('2026', 12)}`)).json();
    expect(pack.meta.comparative.source).toBe('approved_snapshot');
    expect(line(pack, 'SFP_CASH').comparative).toBe('105000.00');
    expect(line(pack, 'SFP_CASH').current).toBe('165000.00');
    expect(pl(pack, 'PL_ADMIN_EXP').comparative).toBe('-5000.00'); // as approved, not as remapped
    expect(line(pack, 'EQ_RETAINED').current).toBe('75000.00');
    const opening = pack.soce.current.find((r: any) => r.key === 'opening');
    expect(opening.total).toBe('115000.00');
    expect(pack.cf.opening.current).toBe('105000.00');
    // The frozen FY2025 pack still shows rent under administrative expenses.
    const frozen = (await c.call('ama', 'GET', `${base()}/statement-runs/${finalId}`)).json();
    expect(pl(frozen.pack, 'PL_ADMIN_EXP').current).toBe('-5000.00');
    await c.call('frank', 'PATCH', `${base()}/accounts/${A['6200']}`, { statementLineCode: 'PL_ADMIN_EXP' });
  });

  it('#12 interim comparatives: position from the final year-end pack, performance for the same months from the ledger', async () => {
    const pack = (await c.call('ama', 'GET', `${base()}/statement-preview?periodId=${await periodId('2026', 6)}`)).json();
    expect(pack.meta.comparative).toMatchObject({ source: 'snapshot_and_ledger', periodEnd: '2025-12-31', plPeriodEnd: '2025-06-30' });
    expect(line(pack, 'SFP_CASH').comparative).toBe('105000.00');
    expect(pl(pack, 'PL_REVENUE').comparative).toBe('40000.00');
    expect(pl(pack, 'PL_ADMIN_EXP')?.comparative ?? '0.00').toBe('0.00'); // rent was July 2025
    expect(pack.exceptions.some((e: any) => e.code === 'COMPARATIVE_NOT_FROM_APPROVED_SNAPSHOT')).toBe(false);
  });

  it('a run goes stale if the ledger changes before approval', async () => {
    const run = (await c.call('ama', 'POST', `${base()}/statement-runs`, { periodId: await periodId('2026', 12) })).json();
    expect((await act('ama', run.id, 'submit')).statusCode).toBe(200);
    await postJournal(c, { journalDate: '2026-03-01', description: 'late entry', lines: [{ accountId: A['6200'], debit: '100.00' }, { accountId: A['1100'], credit: '100.00' }] });
    const r = await act('frank', run.id, 'approve');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('STATEMENT_STALE');
  });

  it('#21 unmapped balances block above materiality and warn below it', async () => {
    await postJournal(c, { journalDate: '2026-03-05', description: 'suspense', lines: [{ accountId: A['1100'], debit: '500.00' }, { accountId: A['6900'], credit: '500.00' }] });
    const p = await periodId('2026', 12);
    let pack = (await c.call('ama', 'GET', `${base()}/statement-preview?periodId=${p}`)).json();
    let run = (await c.call('ama', 'POST', `${base()}/statement-runs`, { periodId: p })).json();
    const un = run.exceptions.find((e: any) => e.code === 'UNMAPPED_BALANCE');
    expect(un).toMatchObject({ severity: 'blocking', accountCode: '6900' });
    expect(pack.checks.find((x: any) => x.code === 'ALL_MAPPED').passed).toBe(false);
    expect(pack.sfp.totals.current.assets).toBe(pack.sfp.totals.current.equityAndLiabilities); // still balances
    await c.db.query('UPDATE entities SET materiality_threshold = 1000 WHERE id = $1', [c.T]);
    run = (await c.call('ama', 'POST', `${base()}/statement-runs`, { periodId: p })).json();
    expect(run.exceptions.find((e: any) => e.code === 'UNMAPPED_BALANCE').severity).toBe('warning');
    await c.db.query('UPDATE entities SET materiality_threshold = 0 WHERE id = $1', [c.T]);
    pack = null;
  });

  it('entity isolation and read-only roles', async () => {
    expect((await c.call('esi', 'GET', `${base()}/statement-runs`)).statusCode).toBe(404);
    expect((await c.call('auditor', 'GET', `${base()}/statement-runs`)).statusCode).toBe(200);
    expect((await c.call('auditor', 'POST', `${base()}/statement-runs`, { periodId: await periodId('2026', 12) })).statusCode).toBe(403);
    expect((await c.call('admin', 'GET', `${base()}/statement-runs`)).statusCode).toBe(403);
  });

  it('every workflow step is in the hash-chained audit log', async () => {
    const r = await c.db.query(`SELECT action FROM audit_events WHERE object_type = 'statement_run' AND object_id = $1 ORDER BY id`, [finalId]);
    expect(r.rows.map((x) => x.action)).toEqual(['statements.generate', 'statements.submit', 'statements.approve', 'statements.finalize']);
    expect((await c.db.query('SELECT verify_audit_chain() AS b')).rows[0].b).toBeNull();
  });
});
