/** Screen G01 — dashboard figures tie to the ledger and respect permissions. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx;
const A: Record<string, string> = {};
const base = () => `/api/entities/${c.T}`;
const periodId = async (fy: string, no: number) =>
  (await c.call('frank', 'GET', `${base()}/periods`)).json().find((f: any) => f.label === fy).periods.find((p: any) => p.period_no === no).id;

beforeAll(async () => {
  c = await setup();
  for (const code of ['1100', '1300', '2100', '3100', '4100', '5100', '6200']) A[code] = await c.acct(c.T, code);
  await postJournal(c, { journalDate: '2025-01-05', description: 'Capital', lines: [{ accountId: A['1100'], debit: '100000.00' }, { accountId: A['3100'], credit: '100000.00' }] });
  await postJournal(c, { journalDate: '2025-03-10', description: 'FY25 sale', lines: [{ accountId: A['1100'], debit: '40000.00' }, { accountId: A['4100'], credit: '40000.00' }] });
  await postJournal(c, { journalDate: '2026-03-10', description: 'FY26 sale', lines: [{ accountId: A['1100'], debit: '50000.00' }, { accountId: A['4100'], credit: '50000.00' }] });
  await postJournal(c, { journalDate: '2026-04-02', description: 'Rent', lines: [{ accountId: A['6200'], debit: '5000.00' }, { accountId: A['1100'], credit: '5000.00' }] });
  await c.call('ama', 'POST', `${base()}/journals`, { journalDate: '2026-04-03', description: 'draft only',
    lines: [{ accountId: A['1100'], debit: '999.00' }, { accountId: A['4100'], credit: '999.00' }] });
});
afterAll(async () => c.teardown());

describe('Dashboard (G01)', () => {
  it('KPIs come from posted lines, with a stated comparison basis', async () => {
    const d = (await c.call('frank', 'GET', `${base()}/dashboard?periodId=${await periodId('2026', 4)}`)).json();
    expect(d.kpis.revenue).toMatchObject({ value: '50000.00', comparative: '40000.00', changePct: '25.0', basis: 'same period last year' });
    expect(d.kpis.expenses.value).toBe('5000.00');
    expect(d.kpis.netProfit.value).toBe('45000.00');
    expect(d.kpis.cash).toMatchObject({ value: '185000.00', comparative: '190000.00', basis: 'end of last month' });
  });

  it('financial position balances and includes profit to date in equity', async () => {
    const d = (await c.call('frank', 'GET', `${base()}/dashboard?periodId=${await periodId('2026', 4)}`)).json();
    expect(d.position).toMatchObject({ assets: '185000.00', liabilities: '0.00', equity: '185000.00', balances: true });
  });

  it('twelve months, zero-filled, future months flagged', async () => {
    const d = (await c.call('frank', 'GET', `${base()}/dashboard?periodId=${await periodId('2026', 4)}`)).json();
    expect(d.monthly).toHaveLength(12);
    expect(d.monthly[2]).toMatchObject({ month: '2026-03', revenue: '50000.00', netProfit: '50000.00', inFuture: false });
    expect(d.monthly[4].inFuture).toBe(true);
  });

  it('tasks are filtered by permission', async () => {
    const frank = (await c.call('frank', 'GET', `${base()}/dashboard`)).json();
    const ama = (await c.call('ama', 'GET', `${base()}/dashboard`)).json();
    expect(ama.tasks.find((t: any) => t.key === 'journals_draft')?.count).toBe(1);
    expect(ama.tasks.some((t: any) => t.key === 'periods_overdue')).toBe(false);
    expect(frank.tasks.some((t: any) => t.key === 'periods_overdue')).toBe(true);
    expect(ama.auditChain).toBeNull();
  });

  it('isolation: other entity users get 404; admin without reports.read gets 403', async () => {
    expect((await c.call('esi', 'GET', `${base()}/dashboard`)).statusCode).toBe(404);
    expect((await c.call('admin', 'GET', `${base()}/dashboard`)).statusCode).toBe(403);
  });
});
