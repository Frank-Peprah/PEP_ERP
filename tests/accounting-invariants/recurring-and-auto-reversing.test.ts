/**
 * Blueprint Phase 1 — auto-reversing and recurring journals.
 * Trulander FY2025: January audit-fee accrual 3,000 reversing 1 Feb; monthly office rent 2,500 on the 15th.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';
import { runDate } from '../../apps/api/src/services/recurring.js';

let c: Ctx;
const A: Record<string, string> = {};
const E = () => `/api/entities/${c.T}`;
const flow = async (id: string) => {
  for (const [u, a] of [['ama', 'submit'], ['kofi', 'approve'], ['kofi', 'post']] as const) {
    const r = await c.call(u, 'POST', `${E()}/journals/${id}/${a}`);
    if (r.statusCode !== 200) throw new Error(`${a}: ${r.body}`);
  }
};
const fee = (date: string, extra: any = {}) => ({ journalDate: date, description: 'Audit fee accrual', journalType: 'accrual',
  lines: [{ accountId: A['6200'], debit: '3000.00' }, { accountId: A['2100'], credit: '3000.00' }], ...extra });
const rent = (extra: any = {}) => ({ name: 'Office rent', description: 'Office rent — monthly', frequency: 'monthly',
  startDate: '2025-01-15', endDate: '2025-04-15',
  lines: [{ accountId: A['6200'], debit: '2500.00' }, { accountId: A['1100'], credit: '2500.00' }], ...extra });

beforeAll(async () => {
  c = await setup();
  for (const code of ['1100', '2100', '3100', '6200']) A[code] = await c.acct(c.T, code);
  await postJournal(c, { journalDate: '2025-01-02', description: 'Capital', lines: [{ accountId: A['1100'], debit: '90000.00' }, { accountId: A['3100'], credit: '90000.00' }] });
});
afterAll(async () => { await c.teardown(); });

describe('Auto-reversing journals', () => {
  let orig: any;
  it('posting an accrual posts its reversal on the chosen date, in the same transaction', async () => {
    orig = await postJournal(c, fee('2025-01-31', { autoReverseDate: '2025-02-01' }));
    expect(orig.status).toBe('posted');
    expect(orig.auto_reverse_date).toBe('2025-02-01');
    expect(orig.reversed_by_journal_id).toBeTruthy();
    const rv = (await c.call('kofi', 'GET', `${E()}/journals/${orig.reversed_by_journal_id}`)).json();
    expect(rv).toMatchObject({ status: 'posted', journal_type: 'reversal', journal_date: '2025-02-01', source: 'auto_reversal',
      reverses_journal_id: orig.id, is_adjustment: true, prepared_by: orig.prepared_by, approved_by: orig.approved_by });
    expect(rv.totals).toEqual(orig.totals);
    expect(rv.lines.find((l: any) => l.account_id === A['6200']).credit).toBe('3000.00');
  });

  it('January carries the accrual; February year-to-date nets it to nil', async () => {
    const fy = (await (await c.call('frank', 'GET', `${E()}/periods`)).json()).find((f: any) => f.label === '2025');
    const tb = async (n: number) => (await c.call('frank', 'GET', `${E()}/trial-balance?periodId=${fy.periods[n - 1].id}`)).json();
    const fee = (t: any) => t.rows.find((r: any) => r.accountId === A['2100'])?.closingNet ?? '0.00';
    expect(fee(await tb(1))).toBe('-3000.00');
    expect(fee(await tb(2))).toBe('0.00');
  });

  it('an auto-reversed journal cannot be reversed again by hand', async () => {
    const r = await c.call('ama', 'POST', `${E()}/journals/${orig.id}/reverse`, { reversalDate: '2025-02-10', reason: 'x' });
    expect(r.json().error.code).toBe('ALREADY_REVERSED');
  });

  it('rejects a reversal date on or before the journal date, and on opening balances', async () => {
    expect((await c.call('ama', 'POST', `${E()}/journals`, fee('2025-01-31', { autoReverseDate: '2025-01-31' }))).json().error.code).toBe('INVALID_DATE');
    const ob = await c.call('ama', 'POST', `${E()}/journals`, { ...fee('2025-01-01', { autoReverseDate: '2025-02-01' }), journalType: 'opening_balance' });
    expect(ob.json().error.code).toBe('AUTO_REVERSE_NOT_ALLOWED');
  });

  it('refuses to submit when no accounting period exists for the reversal date', async () => {
    const d = await c.call('ama', 'POST', `${E()}/journals`, fee('2025-03-31', { autoReverseDate: '2031-01-01' }));
    expect(d.statusCode, d.body).toBe(201);
    const s = await c.call('ama', 'POST', `${E()}/journals/${d.json().id}/submit`);
    expect(s.json().error.code).toBe('AUTO_REVERSAL_PERIOD_UNAVAILABLE');
    await c.call('ama', 'DELETE', `${E()}/journals/${d.json().id}`);
  });

  it('the database freezes the reversal date once the journal leaves draft', async () => {
    await expect(c.adminDb.query(`UPDATE journal_entries SET auto_reverse_date = '2025-03-01' WHERE id = $1`, [orig.id]))
      .rejects.toThrow(/IMMUTABLE|FROZEN/);
    await expect(c.adminDb.query(`UPDATE journal_entries SET auto_reverse_date = journal_date WHERE status = 'draft'`)).resolves.toBeTruthy();
  });
});

describe('Recurring journals', () => {
  it('run dates keep the start day, clamp to short months, or follow month ends', () => {
    expect([0, 1, 2, 3].map((k) => runDate('2025-01-31', 'monthly', false, k))).toEqual(['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30']);
    expect([0, 1].map((k) => runDate('2025-01-15', 'quarterly', false, k))).toEqual(['2025-01-15', '2025-04-15']);
    expect(runDate('2024-02-10', 'monthly', true, 0)).toBe('2024-02-29');
    expect(runDate('2025-11-30', 'annually', false, 1)).toBe('2026-11-30');
  });

  it('templates must balance, use unique names, and only allowed types', async () => {
    const bad = await c.call('ama', 'POST', `${E()}/recurring-journals`, rent({ lines: [{ accountId: A['6200'], debit: '1.00' }, { accountId: A['1100'], credit: '2.00' }] }));
    expect(bad.json().error.code).toBe('JOURNAL_UNBALANCED');
    const ok = await c.call('ama', 'POST', `${E()}/recurring-journals`, rent());
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'active', next_run_date: '2025-01-15', amount: '2500.00' });
    expect((await c.call('ama', 'POST', `${E()}/recurring-journals`, rent())).json().error.code).toBe('NAME_TAKEN');
    expect((await c.call('ama', 'POST', `${E()}/recurring-journals`, rent({ name: 'X', journalType: 'opening_balance' }))).json().error.code).toBe('INVALID_JOURNAL_TYPE');
    expect((await c.call('auditor', 'POST', `${E()}/recurring-journals`, rent({ name: 'Y' }))).json().error.code).toBe('FORBIDDEN');
  });

  it('generates one draft per due date, catching up, and is idempotent', async () => {
    const g = (await c.call('ama', 'POST', `${E()}/recurring-journals/generate`, { asOf: '2025-03-20' })).json();
    expect(g.created.map((x: any) => x.runDate)).toEqual(['2025-01-15', '2025-02-15', '2025-03-15']);
    expect(g.skipped).toEqual([]);
    const again = (await c.call('ama', 'POST', `${E()}/recurring-journals/generate`, { asOf: '2025-03-20' })).json();
    expect(again.created).toEqual([]);
    const t = (await c.call('frank', 'GET', `${E()}/recurring-journals`)).json().find((x: any) => x.name === 'Office rent');
    expect(t).toMatchObject({ runs_generated: 3, next_run_date: '2025-04-15', status: 'active' });
    expect(t.last_journal).toMatchObject({ status: 'draft', date: '2025-03-15' });
  });

  it('generated drafts follow the normal workflow: the generator cannot approve their own draft', async () => {
    const list = (await c.call('ama', 'GET', `${E()}/journals?status=draft`)).json().filter((j: any) => j.description === 'Office rent — monthly');
    expect(list).toHaveLength(3);
    const id = list[0].id;
    await c.call('ama', 'POST', `${E()}/journals/${id}/submit`);
    expect((await c.call('ama', 'POST', `${E()}/journals/${id}/approve`)).json().error.code).toMatch(/SEGREGATION_OF_DUTIES|FORBIDDEN/);
    for (const a of ['approve', 'post']) expect((await c.call('kofi', 'POST', `${E()}/journals/${id}/${a}`)).statusCode).toBe(200);
    const j = (await c.call('kofi', 'GET', `${E()}/journals/${id}`)).json();
    expect(j).toMatchObject({ source: 'recurring', status: 'posted' });
  });

  it('the database allows one journal per template and run date', async () => {
    const j = (await c.adminDb.query(`SELECT * FROM journal_entries WHERE recurring_journal_id IS NOT NULL LIMIT 1`)).rows[0];
    await expect(c.adminDb.query(
      `INSERT INTO journal_entries (entity_id, journal_type, journal_date, period_id, description, currency, fx_rate, prepared_by,
                                    recurring_journal_id, recurring_run_date)
       VALUES ($1,'recurring',$2,$3,'dup',$4,1,$5,$6,$7)`,
      [j.entity_id, j.journal_date, j.period_id, j.currency, j.prepared_by, j.recurring_journal_id, j.recurring_run_date])).rejects.toThrow(/one_journal_per_recurring_run/);
  });

  it('paused templates are skipped; the last run ends the template', async () => {
    const t = (await c.call('frank', 'GET', `${E()}/recurring-journals`)).json().find((x: any) => x.name === 'Office rent');
    expect((await c.call('ama', 'POST', `${E()}/recurring-journals/${t.id}/status`, { status: 'paused' })).statusCode).toBe(200);
    expect((await c.call('ama', 'POST', `${E()}/recurring-journals/generate`, { asOf: '2025-12-31' })).json().created).toEqual([]);
    await c.call('ama', 'POST', `${E()}/recurring-journals/${t.id}/status`, { status: 'active' });
    const g = (await c.call('ama', 'POST', `${E()}/recurring-journals/generate`, { asOf: '2025-12-31' })).json();
    expect(g.created.map((x: any) => x.runDate)).toEqual(['2025-04-15']);
    const after = (await c.call('frank', 'GET', `${E()}/recurring-journals`)).json().find((x: any) => x.name === 'Office rent');
    expect(after).toMatchObject({ status: 'ended', next_run_date: null, runs_generated: 4 });
    expect((await c.call('ama', 'POST', `${E()}/recurring-journals/${t.id}/status`, { status: 'active' })).json().error.code).toBe('RECURRING_ENDED');
  });

  it('an auto-reversing recurring accrual dated month-end reverses on the 1st of the next month', async () => {
    const r = await c.call('ama', 'POST', `${E()}/recurring-journals`, { name: 'Audit fee accrual', description: 'Audit fee accrual — monthly',
      journalType: 'accrual', autoReverse: true, monthEnd: true, startDate: '2025-05-01', endDate: '2025-06-30',
      lines: [{ accountId: A['6200'], debit: '1000.00' }, { accountId: A['2100'], credit: '1000.00' }] });
    expect(r.json()).toMatchObject({ next_run_date: '2025-05-31', is_adjustment: true, auto_reverse: true });
    const g = (await c.call('ama', 'POST', `${E()}/recurring-journals/generate`, { asOf: '2025-06-30' })).json();
    expect(g.created.map((x: any) => [x.runDate, x.autoReverseDate])).toEqual([['2025-05-31', '2025-06-01'], ['2025-06-30', '2025-07-01']]);
    await flow(g.created[0].journalId);
    const j = (await c.call('kofi', 'GET', `${E()}/journals/${g.created[0].journalId}`)).json();
    expect(j.reversed_by_journal_id).toBeTruthy();
  });
});
