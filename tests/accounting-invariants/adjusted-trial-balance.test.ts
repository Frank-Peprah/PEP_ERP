/**
 * Blueprint Phase 1 — adjusting entries and the adjusted trial balance (unadjusted + adjustments = adjusted).
 * Trulander FY2025: rent paid 12,000 in March (prepaid asset); December accrual of audit fee 3,000
 * and prepayment release 9,000 are adjusting entries.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx;
const A: Record<string, string> = {};
const E = () => `/api/entities/${c.T}`;
let dec = '';
let accrual: any, release: any;
const row = (tb: any, code: string) => tb.rows.find((r: any) => r.accountId === A[code]);

beforeAll(async () => {
  c = await setup();
  for (const code of ['1100', '1300', '2100', '6200', '3100']) A[code] = await c.acct(c.T, code);
  await postJournal(c, { journalDate: '2025-01-05', description: 'Capital', lines: [{ accountId: A['1100'], debit: '50000.00' }, { accountId: A['3100'], credit: '50000.00' }] });
  await postJournal(c, { journalDate: '2025-03-01', description: 'Rent paid in advance', lines: [{ accountId: A['1300'], debit: '12000.00' }, { accountId: A['1100'], credit: '12000.00' }] });
  accrual = await postJournal(c, { journalDate: '2025-12-31', description: 'Audit fee accrual', journalType: 'accrual',
    lines: [{ accountId: A['6200'], debit: '3000.00' }, { accountId: A['2100'], credit: '3000.00' }] });
  release = await postJournal(c, { journalDate: '2025-12-31', description: 'Rent for the year', journalType: 'manual', isAdjustment: true,
    lines: [{ accountId: A['6200'], debit: '9000.00' }, { accountId: A['1300'], credit: '9000.00' }] });
  const fy = (await (await c.call('frank', 'GET', `${E()}/periods`)).json()).find((f: any) => f.label === '2025');
  dec = fy.periods.find((p: any) => p.period_no === 12).id;
});
afterAll(async () => { await c.teardown(); });

describe('Adjusted trial balance', () => {
  it('flags adjusting entries by type, or explicitly; ordinary entries are not adjustments', async () => {
    expect(accrual.is_adjustment).toBe(true);
    expect(release.is_adjustment).toBe(true);
    const list = (await c.call('frank', 'GET', `${E()}/journals`)).json();
    expect(list.find((j: any) => j.description === 'Capital').is_adjustment).toBe(false);
    const notAdj = await c.call('ama', 'POST', `${E()}/journals`, { journalDate: '2025-12-31', description: 'Accrual, not an adjustment',
      journalType: 'accrual', isAdjustment: false, lines: [{ accountId: A['6200'], debit: '1.00' }, { accountId: A['2100'], credit: '1.00' }] });
    expect(notAdj.json().is_adjustment).toBe(false);
    await c.call('ama', 'DELETE', `${E()}/journals/${notAdj.json().id}`);
  });

  it('unadjusted + adjustments = adjusted for every account, and each column balances', async () => {
    const tb = (await c.call('frank', 'GET', `${E()}/trial-balance?periodId=${dec}`)).json();
    expect(tb.balanced).toBe(true);
    expect(row(tb, '6200')).toMatchObject({ unadjusted: { debit: '0.00', credit: '0.00' }, adjustments: { debit: '12000.00', credit: '0.00' }, closing: { debit: '12000.00' } });
    expect(row(tb, '1300')).toMatchObject({ unadjusted: { debit: '12000.00' }, adjustments: { credit: '9000.00' }, closing: { debit: '3000.00' } });
    expect(row(tb, '2100')).toMatchObject({ unadjusted: { credit: '0.00' }, adjustments: { credit: '3000.00' }, closing: { credit: '3000.00' } });
    expect(tb.totals.unadjusted.debit).toBe(tb.totals.unadjusted.credit);
    expect(tb.totals.adjustments).toEqual({ debit: '12000.00', credit: '12000.00' });
    for (const r of tb.rows) {
      const net = (x: any) => Number(x.debit) - Number(x.credit);
      expect(net(r.unadjusted) + net(r.adjustments)).toBeCloseTo(net(r.closing), 2);
    }
  });

  it('a reversal of an adjusting entry is itself an adjustment (both sit in the column and net to nil)', async () => {
    const rv = await c.call('ama', 'POST', `${E()}/journals/${accrual.id}/reverse`, { reversalDate: '2025-12-31', reason: 'Fee was invoiced' });
    expect(rv.statusCode, rv.body).toBe(201);
    expect(rv.json().is_adjustment).toBe(true);
  });

  it('the database freezes the flag once a journal leaves draft', async () => {
    await expect(c.adminDb.query(`UPDATE journal_entries SET is_adjustment = false WHERE id = $1`, [release.id])).rejects.toThrow(/IMMUTABLE|FROZEN/);
  });
});
