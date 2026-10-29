/**
 * Blueprint Phase 1 — year-end close (decision D4 default: closing journal to retained earnings).
 * FY2025 for Trulander: capital 100,000; sale 40,000; cost of land 20,000; rent 5,000 → profit 15,000.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx;
const A: Record<string, string> = {};
const E = () => `/api/entities/${c.T}`;
let fy25 = '', fy26 = '';
const periods = async () => (await c.call('frank', 'GET', `${E()}/periods`)).json();
const lockFy25UpTo = async (n: number) => {
  const fy = (await periods()).find((f: any) => f.label === '2025');
  for (const p of fy.periods.filter((x: any) => x.period_no <= n && x.status !== 'locked')) {
    const r = await c.call('frank', 'POST', `${E()}/periods/${p.id}/lock`);
    if (r.statusCode !== 200) throw new Error(r.body);
  }
};
const flow = async (id: string) => {
  for (const [u, a] of [['frank', 'submit'], ['kofi', 'approve'], ['kofi', 'post']] as const) {
    const r = await c.call(u, 'POST', `${E()}/journals/${id}/${a}`);
    if (r.statusCode !== 200) throw new Error(`${a}: ${r.body}`);
  }
};

beforeAll(async () => {
  c = await setup();
  for (const code of ['1100', '1300', '3100', '4100', '5100', '6200']) A[code] = await c.acct(c.T, code);
  await postJournal(c, { journalDate: '2025-01-05', description: 'Capital', lines: [{ accountId: A['1100'], debit: '100000.00' }, { accountId: A['3100'], credit: '100000.00' }] });
  await postJournal(c, { journalDate: '2025-02-10', description: 'Land', lines: [{ accountId: A['1300'], debit: '50000.00' }, { accountId: A['1100'], credit: '50000.00' }] });
  await postJournal(c, { journalDate: '2025-06-01', description: 'Plot sale', lines: [{ accountId: A['1100'], debit: '40000.00' }, { accountId: A['4100'], credit: '40000.00' }] });
  await postJournal(c, { journalDate: '2025-06-01', description: 'Cost of plot', lines: [{ accountId: A['5100'], debit: '20000.00' }, { accountId: A['1300'], credit: '20000.00' }] });
  await postJournal(c, { journalDate: '2025-12-15', description: 'Rent', lines: [{ accountId: A['6200'], debit: '5000.00' }, { accountId: A['1100'], credit: '5000.00' }] });
  await postJournal(c, { journalDate: '2026-01-10', description: 'FY2026 sale', lines: [{ accountId: A['1100'], debit: '7000.00' }, { accountId: A['4100'], credit: '7000.00' }] });
  const ps = await periods();
  fy25 = ps.find((f: any) => f.label === '2025').id;
  fy26 = ps.find((f: any) => f.label === '2026').id;
});
afterAll(async () => { await c.teardown(); });

describe('Year-end close', () => {
  it('preview: computes the closing lines and lists every blocker until earlier periods are locked', async () => {
    const pv = (await c.call('frank', 'GET', `${E()}/financial-years/${fy25}/close`)).json();
    expect(pv.profitForYear).toBe('15000.00');
    expect(pv.lines.find((l: any) => l.accountId === A['4100'])).toMatchObject({ debit: '40000.00', credit: '0.00' });
    expect(pv.lines.find((l: any) => l.accountId === A['5100'])).toMatchObject({ debit: '0.00', credit: '20000.00' });
    expect(pv.lines.find((l: any) => l.accountId === pv.retainedEarnings.accountId)).toMatchObject({ credit: '15000.00' });
    expect(pv.blockers.map((b: any) => b.code)).toContain('EARLIER_PERIODS_OPEN');
    expect(pv.canGenerate).toBe(false);
    // FY2026 cannot be closed while FY2025 is open.
    const pv26 = (await c.call('frank', 'GET', `${E()}/financial-years/${fy26}/close`)).json();
    expect(pv26.blockers.map((b: any) => b.code)).toContain('PRIOR_YEAR_OPEN');
    const g = await c.call('frank', 'POST', `${E()}/financial-years/${fy25}/close`);
    expect(g.json().error.code).toBe('CLOSE_PRECONDITIONS');
  });

  it('pre-close TB at FY2026 shows the unclosed FY2025 result as a system line (existing behaviour)', async () => {
    const p26 = (await periods()).find((f: any) => f.label === '2026').periods[0].id;
    const tb = (await c.call('frank', 'GET', `${E()}/trial-balance?periodId=${p26}`)).json();
    expect(tb.exceptions.map((x: any) => x.code)).toContain('PRIOR_YEAR_NOT_CLOSED');
  });

  it('only the controller (year.close) can generate; the accountant cannot', async () => {
    await lockFy25UpTo(11);
    expect((await c.call('ama', 'POST', `${E()}/financial-years/${fy25}/close`)).json().error.code).toBe('FORBIDDEN');
  });

  let closeId = '';
  it('generates a draft closing journal dated 31 Dec 2025 that the preparer cannot approve (SoD)', async () => {
    const r = await c.call('frank', 'POST', `${E()}/financial-years/${fy25}/close`);
    expect(r.statusCode, r.body).toBe(201);
    const j = r.json().journal;
    closeId = j.id;
    expect(j).toMatchObject({ journal_type: 'year_end_close', journal_date: '2025-12-31', status: 'draft' });
    expect(j.totals.debit).toBe(j.totals.credit);
    // Closing journals cannot be edited by hand.
    const edit = await c.call('frank', 'PUT', `${E()}/journals/${closeId}`, { journalDate: '2025-12-31', description: 'x', lines: [] });
    expect(edit.json().error.code).toBe('JOURNAL_NOT_EDITABLE');
    // A second close for the same year is refused while this one is live.
    expect((await c.call('frank', 'POST', `${E()}/financial-years/${fy25}/close`)).json().error.code).toBe('CLOSE_ALREADY_EXISTS');
    // The preparer may not approve their own closing journal.
    await c.call('frank', 'POST', `${E()}/journals/${closeId}/submit`);
    expect((await c.call('frank', 'POST', `${E()}/journals/${closeId}/approve`)).json().error.code).toBe('SEGREGATION_OF_DUTIES');
    for (const a of ['approve', 'post']) expect((await c.call('kofi', 'POST', `${E()}/journals/${closeId}/${a}`)).statusCode).toBe(200);
  });

  it('after posting: retained earnings carry the result; FY2026 TB has no prior-year system line', async () => {
    const p26 = (await periods()).find((f: any) => f.label === '2026').periods[0].id;
    const tb = (await c.call('frank', 'GET', `${E()}/trial-balance?periodId=${p26}`)).json();
    expect(tb.balanced).toBe(true);
    expect(tb.exceptions.map((x: any) => x.code)).not.toContain('PRIOR_YEAR_NOT_CLOSED');
    expect(tb.rows.some((r: any) => r.synthetic)).toBe(false);
    const pv = (await c.call('frank', 'GET', `${E()}/financial-years/${fy25}/close`)).json();
    const re = tb.rows.find((r: any) => r.accountId === pv.retainedEarnings.accountId);
    expect(re.closing.credit).toBe('15000.00');
    // FY2026 revenue opens at zero and shows only FY2026 activity.
    expect(tb.rows.find((r: any) => r.accountId === A['4100']).closing.credit).toBe('7000.00');
  });

  it('FY2025 year-end TB: post-close shows P&L at zero; pre-close shows the year for review', async () => {
    const p12 = (await periods()).find((f: any) => f.label === '2025').periods.find((p: any) => p.period_no === 12).id;
    const post = (await c.call('frank', 'GET', `${E()}/trial-balance?periodId=${p12}`)).json();
    const pre = (await c.call('frank', 'GET', `${E()}/trial-balance?periodId=${p12}&stage=pre_close`)).json();
    const rev = (tb: any) => tb.rows.find((r: any) => r.accountId === A['4100'])?.closingNet ?? '0.00';
    expect(rev(post)).toBe('0.00');
    expect(rev(pre)).toBe('-40000.00');
    expect(post.balanced && pre.balanced).toBe(true);
  });

  it('FY2025 statements still report the year’s profit, and every statement cross-check passes', async () => {
    const p12 = (await periods()).find((f: any) => f.label === '2025').periods.find((p: any) => p.period_no === 12).id;
    const pack = (await c.call('frank', 'GET', `${E()}/statement-preview?periodId=${p12}`)).json();
    const blocking = pack.exceptions.filter((x: any) => x.severity === 'blocking' && /RECONCILE|BALANCE|CAST|EQUITY/.test(x.code));
    expect(blocking, JSON.stringify(blocking)).toEqual([]);
    const profit = pack.pl.lines.find((l: any) => l.key === 'profit' || /profit for the/i.test(l.label ?? ''));
    expect(profit?.current ?? profit?.value).toBe('15000.00');
  });

  it('finalise: locks December and marks FY2025 closed; posting into it is then refused', async () => {
    expect((await c.call('ama', 'POST', `${E()}/financial-years/${fy25}/close/finalise`)).json().error.code).toBe('FORBIDDEN');
    const r = await c.call('frank', 'POST', `${E()}/financial-years/${fy25}/close/finalise`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ label: '2025', periodsLocked: ['Dec 2025'], profitForYear: '15000.00' });
    const fy = (await periods()).find((f: any) => f.label === '2025');
    expect(fy.is_closed).toBe(true);
    const d = await c.call('ama', 'POST', `${E()}/journals`, { journalDate: '2025-12-20', description: 'late',
      lines: [{ accountId: A['6200'], debit: '1.00' }, { accountId: A['1100'], credit: '1.00' }] });
    expect(d.json().error?.code ?? 'created').toMatch(/PERIOD_LOCKED|created/);
    if (d.statusCode === 201) {
      expect((await c.call('ama', 'POST', `${E()}/journals/${d.json().id}/submit`)).json().error.code).toBe('PERIOD_LOCKED');
    }
  });

  it('re-opening a period in the closed year re-opens the year (audited) so the close is reviewed', async () => {
    const dec = (await periods()).find((f: any) => f.label === '2025').periods.find((p: any) => p.period_no === 12).id;
    const r = await c.call('frank', 'POST', `${E()}/periods/${dec}/reopen`, { reason: 'Auditor adjustment' });
    expect(r.statusCode, r.body).toBe(200);
    expect((await periods()).find((f: any) => f.label === '2025').is_closed).toBe(false);
    const a = await c.adminDb.query(`SELECT count(*)::int n FROM audit_events WHERE action = 'year.reopen' AND object_id = $1`, [fy25]);
    expect(a.rows[0].n).toBe(1);
  });

  it('database guards: closing journal must be dated year-end; a year cannot be flagged closed without a posted close', async () => {
    await expect(c.adminDb.query(`UPDATE journal_entries SET closes_financial_year_id = $1 WHERE id = (SELECT id FROM journal_entries WHERE journal_type='manual' LIMIT 1)`, [fy26]))
      .rejects.toThrow();
    await expect(c.adminDb.query(`UPDATE financial_years SET is_closed = true WHERE id = $1`, [fy26])).rejects.toThrow(/YEAR_NOT_CLOSABLE/);
  });
});
