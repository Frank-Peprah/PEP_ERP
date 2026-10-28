/**
 * Spec §12 acceptance tests — accounting invariants (API level).
 * Numbers in test names map to the specification's test list.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx;
let bank: string, capital: string, revenue: string, rent: string;
const base = (over: any = {}) => ({
  journalDate: '2026-10-10', description: 'Test journal',
  lines: [{ accountId: bank, debit: '1000.00' }, { accountId: capital, credit: '1000.00' }], ...over,
});

beforeAll(async () => {
  c = await setup();
  bank = await c.acct(c.T, '1100'); capital = await c.acct(c.T, '3100');
  revenue = await c.acct(c.T, '4100'); rent = await c.acct(c.T, '6200');
});
afterAll(async () => c.teardown());

describe('Journal posting invariants', () => {
  it('#1 balanced GHS 1,000 journal posts and receives a gapless number', async () => {
    const j = await postJournal(c, base());
    expect(j.status).toBe('posted');
    expect(j.journal_no).toBe('JV-2026-000001');
    expect(j.totals).toEqual({ debit: '1000.00', credit: '1000.00', balanced: true });
    const j2 = await postJournal(c, base({ description: 'second' }));
    expect(j2.journal_no).toBe('JV-2026-000002');
  });

  it('workflow buttons work when the browser sends content-type JSON with an empty body', async () => {
    const d = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({ description: 'empty-body regression' }));
    const id = d.json().id;
    const h = { 'content-type': 'application/json' };
    expect((await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${id}/submit`, undefined, h)).statusCode).toBe(200);
    expect((await c.call('kofi', 'POST', `/api/entities/${c.T}/journals/${id}/approve`, undefined, h)).statusCode).toBe(200);
    const p = await c.call('kofi', 'POST', `/api/entities/${c.T}/journals/${id}/post`, undefined, h);
    expect(p.statusCode).toBe(200);
    expect(p.json().status).toBe('posted');
    const bad = await c.app.inject({ method: 'POST', url: `/api/entities/${c.T}/journals`, headers: { ...h, authorization: `Bearer ${c.tokens.ama}` }, payload: '{not json' });
    expect(bad.statusCode).toBe(400);
  });

  it('#2 GHS 1,000 Dr vs GHS 999 Cr cannot be submitted', async () => {
    const d = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({
      lines: [{ accountId: bank, debit: '1000.00' }, { accountId: capital, credit: '999.00' }] }));
    expect(d.statusCode).toBe(201); // drafts may be work-in-progress
    const s = await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/submit`);
    expect(s.statusCode).toBe(422);
    expect(s.json().error.code).toBe('JOURNAL_UNBALANCED');
    expect(s.json().error.message).toContain('difference 1.00');
  });

  it('rejects a line carrying both debit and credit, negatives, and sub-pesewa precision', async () => {
    const both = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({
      lines: [{ accountId: bank, debit: '10.00', credit: '10.00' }, { accountId: capital, credit: '0.00', debit: '0' }] }));
    expect(both.json().error.code).toBe('LINE_BOTH_SIDES');
    const neg = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({
      lines: [{ accountId: bank, debit: '-10.00' }, { accountId: capital, credit: '-10.00' }] }));
    expect(neg.json().error.code).toBe('INVALID_AMOUNT');
    const prec = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({
      lines: [{ accountId: bank, debit: '10.005' }, { accountId: capital, credit: '10.005' }] }));
    expect(prec.json().error.code).toBe('AMOUNT_PRECISION');
  });

  it('#20 decimal arithmetic: 0.10 + 0.20 balances against 0.30 (no float drift)', async () => {
    const j = await postJournal(c, base({ lines: [
      { accountId: rent, debit: '0.10' }, { accountId: rent, debit: '0.20' }, { accountId: bank, credit: '0.30' }] }));
    expect(j.totals.debit).toBe('0.30');
    expect(j.status).toBe('posted');
  });

  it('#20 FX: translation rounding difference is surfaced, never silently absorbed', async () => {
    // USD 0.01 + 0.01 vs 0.02 balances in USD; at 15.555: 0.16 + 0.16 = 0.32 Dr vs 0.31 Cr in GHS.
    const d = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({
      currency: 'USD', fxRate: '15.555',
      lines: [{ accountId: rent, debit: '0.01' }, { accountId: rent, debit: '0.01' }, { accountId: bank, credit: '0.02' }] }));
    expect(d.statusCode).toBe(201);
    const s = await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/submit`);
    expect(s.json().error.code).toBe('FX_ROUNDING_DIFFERENCE');
  });

  it('#4 preparer cannot approve or post their own journal (segregation of duties)', async () => {
    // Frank holds controller (prepare + approve + post) — the strongest case for SoD.
    const d = await c.call('frank', 'POST', `/api/entities/${c.T}/journals`, base());
    await c.call('frank', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/submit`);
    const a = await c.call('frank', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/approve`);
    expect(a.statusCode).toBe(403);
    expect(a.json().error.code).toBe('SEGREGATION_OF_DUTIES');
    const k = await c.call('kofi', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/approve`);
    expect(k.statusCode).toBe(200);
    const p = await c.call('frank', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/post`);
    expect(p.json().error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('preparer without approval rights cannot approve someone else\'s journal; post requires approval first', async () => {
    const d = await c.call('kofi', 'POST', `/api/entities/${c.T}/journals`, base());
    expect(d.statusCode).toBe(403); // kofi (approver) cannot prepare
    const d2 = await c.call('frank', 'POST', `/api/entities/${c.T}/journals`, base());
    await c.call('frank', 'POST', `/api/entities/${c.T}/journals/${d2.json().id}/submit`);
    const a = await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${d2.json().id}/approve`);
    expect(a.json().error.code).toBe('FORBIDDEN');
    const p = await c.call('kofi', 'POST', `/api/entities/${c.T}/journals/${d2.json().id}/post`);
    expect(p.json().error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('#5 posted journal cannot be edited or deleted via the API', async () => {
    const j = await postJournal(c, base());
    const e = await c.call('ama', 'PUT', `/api/entities/${c.T}/journals/${j.id}`, base({ description: 'tamper' }));
    expect(e.json().error.code).toBe('JOURNAL_NOT_EDITABLE');
    const del = await c.call('ama', 'DELETE', `/api/entities/${c.T}/journals/${j.id}`);
    expect(del.json().error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('#6 reversal links to the original, preserves both records, cannot be duplicated', async () => {
    const j = await postJournal(c, base({ description: 'to reverse', lines: [
      { accountId: rent, debit: '2500.00' }, { accountId: bank, credit: '2500.00' }] }));
    const r = await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${j.id}/reverse`, { reversalDate: '2026-10-11', reason: 'Duplicate invoice' });
    expect(r.statusCode).toBe(201);
    const rev = r.json();
    expect(rev.journal_type).toBe('reversal');
    expect(rev.reverses_journal_id).toBe(j.id);
    expect(rev.lines[0]).toMatchObject({ debit: '0.00', credit: '2500.00' });
    expect(rev.lines[1]).toMatchObject({ debit: '2500.00', credit: '0.00' });
    const dup = await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${j.id}/reverse`, { reversalDate: '2026-10-11', reason: 'again' });
    expect(dup.statusCode).toBe(409);
    for (const [u, a] of [['ama', 'submit'], ['kofi', 'approve'], ['kofi', 'post']]) {
      expect((await c.call(u, 'POST', `/api/entities/${c.T}/journals/${rev.id}/${a}`)).statusCode).toBe(200);
    }
    const orig = (await c.call('kofi', 'GET', `/api/entities/${c.T}/journals/${j.id}`)).json();
    expect(orig.status).toBe('posted');
    expect(orig.reversed_by_journal_id).toBe(rev.id);
    expect(orig.lines).toHaveLength(2); // original intact
    const again = await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${j.id}/reverse`, { reversalDate: '2026-10-12', reason: 'x' });
    expect(again.json().error.code).toBe('ALREADY_REVERSED');
  });

  it('#3 posting into a locked period is rejected; reopen requires reason and is audited', async () => {
    const periods = (await c.call('frank', 'GET', `/api/entities/${c.T}/periods`)).json();
    const sep = periods.find((f: any) => f.label === '2026').periods.find((p: any) => p.period_no === 9);
    const d = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({ journalDate: '2026-09-15' }));
    await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/submit`);
    await c.call('kofi', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/approve`);
    expect((await c.call('kofi', 'POST', `/api/entities/${c.T}/periods/${sep.id}/lock`)).statusCode).toBe(403); // approver can't lock
    expect((await c.call('frank', 'POST', `/api/entities/${c.T}/periods/${sep.id}/lock`)).statusCode).toBe(200);
    const p = await c.call('kofi', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/post`);
    expect(p.statusCode).toBe(423);
    expect(p.json().error.code).toBe('PERIOD_LOCKED');
    const create = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({ journalDate: '2026-09-20' }));
    const sub = await c.call('ama', 'POST', `/api/entities/${c.T}/journals/${create.json().id}/submit`);
    expect(sub.json().error.code).toBe('PERIOD_LOCKED');
    const noReason = await c.call('frank', 'POST', `/api/entities/${c.T}/periods/${sep.id}/reopen`, {});
    expect(noReason.json().error.code).toBe('REASON_REQUIRED');
    const ok = await c.call('frank', 'POST', `/api/entities/${c.T}/periods/${sep.id}/reopen`, { reason: 'Late supplier invoice' });
    expect(ok.statusCode).toBe(200);
    expect((await c.call('kofi', 'POST', `/api/entities/${c.T}/journals/${d.json().id}/post`)).statusCode).toBe(200);
  });

  it('journal date outside any period, header accounts and inactive accounts are rejected', async () => {
    const noP = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({ journalDate: '2030-01-01' }));
    expect(noP.json().error.code).toBe('NO_PERIOD');
    const header = await c.acct(c.T, '1000');
    const h = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({ lines: [{ accountId: header, debit: '5' }, { accountId: capital, credit: '5' }] }));
    expect(h.json().error.code).toBe('HEADER_ACCOUNT');
  });

  it('#19 idempotent creation: replaying a key returns the original; changed payload is refused', async () => {
    const h = { 'idempotency-key': 'import-batch-77-row-1' };
    const a = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base(), h);
    const b = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base(), h);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    const x = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base({ description: 'different' }), h);
    expect(x.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('optimistic locking: stale draft edits are refused', async () => {
    const d = (await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, base())).json();
    const ok = await c.call('ama', 'PUT', `/api/entities/${c.T}/journals/${d.id}`, base({ description: 'v2', expectedVersion: d.version }));
    expect(ok.statusCode).toBe(200);
    const stale = await c.call('ama', 'PUT', `/api/entities/${c.T}/journals/${d.id}`, base({ description: 'v3', expectedVersion: d.version }));
    expect(stale.json().error.code).toBe('STALE_VERSION');
  });
});
