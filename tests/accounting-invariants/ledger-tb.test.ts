/** Spec §12 #7, #8, #15 and TB year-boundary behaviour. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx;
const A: Record<string, string> = {};
beforeAll(async () => {
  c = await setup();
  for (const code of ['1100', '1300', '3100', '4100', '5100', '6200', '6900']) A[code] = await c.acct(c.T, code);
  await postJournal(c, { journalDate: '2025-01-05', description: 'Capital', lines: [{ accountId: A['1100'], debit: '100000.00' }, { accountId: A['3100'], credit: '100000.00' }] });
  await postJournal(c, { journalDate: '2025-06-01', description: 'FY25 sale', lines: [{ accountId: A['1100'], debit: '40000.00' }, { accountId: A['4100'], credit: '40000.00' }] });
  await postJournal(c, { journalDate: '2025-06-01', description: 'FY25 rent', lines: [{ accountId: A['6200'], debit: '15000.00' }, { accountId: A['1100'], credit: '15000.00' }] });
  await postJournal(c, { journalDate: '2026-02-01', description: 'FY26 sale', lines: [{ accountId: A['1100'], debit: '60000.00', description: 'Plot 9' }, { accountId: A['4100'], credit: '60000.00' }] });
  await postJournal(c, { journalDate: '2026-03-01', description: 'FY26 suspense', lines: [{ accountId: A['1100'], debit: '500.00' }, { accountId: A['6900'], credit: '500.00' }] });
  // drafts / submitted must never reach the ledger
  await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, { journalDate: '2026-03-02', description: 'draft only',
    lines: [{ accountId: A['1100'], debit: '999999.00' }, { accountId: A['4100'], credit: '999999.00' }] });
});
afterAll(async () => c.teardown());

const periodId = async (fy: string, no: number) =>
  (await c.call('frank', 'GET', `/api/entities/${c.T}/periods`)).json().find((f: any) => f.label === fy).periods.find((p: any) => p.period_no === no).id;

describe('Trial balance', () => {
  it('#7 balances; derives only from posted lines; drafts excluded', async () => {
    const tb = (await c.call('ama', 'GET', `/api/entities/${c.T}/trial-balance?periodId=${await periodId('2026', 12)}`)).json();
    expect(tb.balanced).toBe(true);
    expect(tb.totals.closing.debit).toBe(tb.totals.closing.credit);
    const bank = tb.rows.find((r: any) => r.code === '1100');
    expect(bank.closing.debit).toBe('185500.00'); // 100000+40000-15000+60000+500; draft 999,999 excluded
    expect(tb.parameters.source).toContain('posted');
  });

  it('income statement accounts reset at FY start; prior-year result shown explicitly on retained earnings', async () => {
    const tb = (await c.call('ama', 'GET', `/api/entities/${c.T}/trial-balance?periodId=${await periodId('2026', 12)}`)).json();
    const rev = tb.rows.find((r: any) => r.code === '4100' && !r.synthetic);
    expect(rev.opening).toEqual({ debit: '0.00', credit: '0.00' });
    expect(rev.closing.credit).toBe('60000.00');
    const re = tb.rows.find((r: any) => r.synthetic);
    expect(re.code).toBe('3200');
    expect(re.closing.credit).toBe('25000.00'); // FY25 profit 40,000 − 15,000
    expect(tb.exceptions.map((e: any) => e.code)).toContain('PRIOR_YEAR_NOT_CLOSED');
  });

  it('period basis: opening = position at period start, movement = period only', async () => {
    const tb = (await c.call('ama', 'GET', `/api/entities/${c.T}/trial-balance?periodId=${await periodId('2026', 3)}&basis=period`)).json();
    const bank = tb.rows.find((r: any) => r.code === '1100');
    expect(bank.opening.debit).toBe('185000.00');
    expect(bank.movement.debit).toBe('500.00');
    expect(tb.balanced).toBe(true);
  });

  it('flags balances on unmapped accounts (suspense) as exceptions', async () => {
    const tb = (await c.call('ama', 'GET', `/api/entities/${c.T}/trial-balance?periodId=${await periodId('2026', 12)}`)).json();
    expect(tb.exceptions).toContainEqual(expect.objectContaining({ code: 'UNMAPPED_ACCOUNT', accountCode: '6900' }));
  });

  it('flags abnormal balances (asset in credit)', async () => {
    await postJournal(c, { journalDate: '2026-05-01', description: 'Oversold land', lines: [{ accountId: A['5100'], debit: '1000.00' }, { accountId: A['1300'], credit: '1000.00' }] });
    const tb = (await c.call('ama', 'GET', `/api/entities/${c.T}/trial-balance?periodId=${await periodId('2026', 12)}`)).json();
    expect(tb.exceptions).toContainEqual(expect.objectContaining({ code: 'ABNORMAL_BALANCE', accountCode: '1300' }));
  });

  it('#7 remains balanced after a reversal is posted', async () => {
    const j = await postJournal(c, { journalDate: '2026-04-10', description: 'Rent', lines: [{ accountId: A['6200'], debit: '3333.33' }, { accountId: A['1100'], credit: '3333.33' }] });
    const r = (await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${j.id}/reverse`, { reversalDate: '2026-04-30', reason: 'test' })).json();
    for (const [u, a] of [['ama', 'submit'], ['kofi', 'approve'], ['kofi', 'post']]) await c.call(u, 'POST', `/api/entities/${c.T}/journals/${r.id}/${a}`);
    const tb = (await c.call('ama', 'GET', `/api/entities/${c.T}/trial-balance?periodId=${await periodId('2026', 4)}&basis=period`)).json();
    const rent = tb.rows.find((x: any) => x.code === '6200');
    expect(rent.movement).toEqual({ debit: '3333.33', credit: '3333.33' });
    expect(rent.closing).toEqual({ debit: '0.00', credit: '0.00' });
    expect(tb.balanced).toBe(true);
  });
});

describe('General ledger', () => {
  it('#8 drill-down: ledger lines link to journal, carry running balance and source refs', async () => {
    const l = (await c.call('ama', 'GET', `/api/entities/${c.T}/ledger?accountId=${A['1100']}&from=2026-01-01&to=2026-12-31`)).json();
    expect(l.opening).toBe('125000.00'); // balance-sheet account carries forward
    expect(l.lines[0]).toMatchObject({ journal_date: '2026-02-01', debit: '60000.00', line_description: 'Plot 9', running_balance: '185000.00' });
    const j = (await c.call('ama', 'GET', `/api/entities/${c.T}/journals/${l.lines[0].journal_id}`)).json();
    expect(j.journal_no).toBe(l.lines[0].journal_no);
  });

  it('revenue ledger opens at zero in a new financial year', async () => {
    const l = (await c.call('ama', 'GET', `/api/entities/${c.T}/ledger?accountId=${A['4100']}&from=2026-01-01&to=2026-12-31`)).json();
    expect(l.opening).toBe('0.00');
    expect(l.closing).toBe('60000.00');
  });
});

describe('Audit trail', () => {
  it('#15 posting, reversal and period actions create hash-chained audit events', async () => {
    const a = (await c.call('frank', 'GET', `/api/entities/${c.T}/audit?limit=500`)).json();
    const actions = new Set(a.events.map((e: any) => e.action));
    for (const x of ['journal.create', 'journal.submit', 'journal.approve', 'journal.post', 'journal.reversal_created', 'journal.reversed', 'fy.create'])
      expect(actions).toContain(x);
    expect(a.chainIntact).toBe(true);
  });

  it('auditor can read but not prepare; board viewer-style restrictions hold', async () => {
    expect((await c.call('auditor', 'GET', `/api/entities/${c.T}/trial-balance`)).statusCode).toBe(200);
    expect((await c.call('auditor', 'GET', `/api/entities/${c.T}/audit`)).statusCode).toBe(200);
    const w = await c.call('auditor', 'POST', `/api/entities/${c.T}/journals`, { journalDate: '2026-05-01', description: 'x',
      lines: [{ accountId: A['1100'], debit: '1' }, { accountId: A['3100'], credit: '1' }] });
    expect(w.statusCode).toBe(403);
    // system admin has NO financial authority
    expect((await c.call('admin', 'GET', `/api/entities/${c.T}/trial-balance`)).statusCode).toBe(403);
  });
});
