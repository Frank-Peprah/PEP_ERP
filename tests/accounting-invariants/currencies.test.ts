/**
 * Blueprint Phase 1 (decision D5) — room for foreign currency. Trulander posts only in GHS today; a currency
 * must be enabled before use, rates are append-only evidence, and journals take the rate in force by default.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, type Ctx } from '../helpers.js';

let c: Ctx;
const A: Record<string, string> = {};
const E = () => `/api/entities/${c.T}`;
const usd = (extra: any = {}) => ({ journalDate: '2025-03-10', description: 'Survey fee paid in USD', currency: 'USD',
  lines: [{ accountId: A['6200'], debit: '100.00' }, { accountId: A['1100'], credit: '100.00' }], ...extra });

beforeAll(async () => {
  c = await setup();
  for (const code of ['1100', '6200']) A[code] = await c.acct(c.T, code);
});
afterAll(async () => { await c.teardown(); });

describe('Currencies and exchange rates', () => {
  it('GHS only by default: a USD journal is refused until USD is enabled (API and database)', async () => {
    expect((await c.call('ama', 'POST', `${E()}/journals`, usd({ fxRate: '15' }))).json().error.code).toBe('CURRENCY_NOT_ENABLED');
    await expect(c.adminDb.query(
      `INSERT INTO journal_entries (entity_id, journal_type, journal_date, period_id, description, currency, fx_rate, prepared_by)
       SELECT $1, 'manual', '2025-03-10', p.id, 'x', 'USD', 15, $2 FROM accounting_periods p WHERE p.entity_id = $1 AND '2025-03-10' BETWEEN p.start_date AND p.end_date`,
      [c.T, (await c.adminDb.query(`SELECT id FROM users WHERE email = 'ama@pep.local'`)).rows[0].id])).rejects.toThrow(/CURRENCY_NOT_ENABLED/);
    const cur = (await c.call('frank', 'GET', `${E()}/currencies`)).json();
    expect(cur).toEqual({ functional: 'GHS', enabled: [] });
  });

  it('a GHS journal must use a rate of 1 (database)', async () => {
    const d = await c.call('ama', 'POST', `${E()}/journals`, { ...usd(), currency: 'GHS' });
    expect(d.statusCode, d.body).toBe(201);
    await expect(c.adminDb.query(`UPDATE journal_entries SET fx_rate = 2 WHERE id = $1`, [d.json().id])).rejects.toThrow(/INVALID_FX_RATE/);
    await c.call('ama', 'DELETE', `${E()}/journals/${d.json().id}`);
  });

  it('only a controller enables a currency; it is audited', async () => {
    expect((await c.call('ama', 'POST', `${E()}/currencies`, { code: 'USD' })).json().error.code).toBe('FORBIDDEN');
    expect((await c.call('frank', 'POST', `${E()}/currencies`, { code: 'GHS' })).json().error.code).toBe('INVALID_CURRENCY');
    expect((await c.call('frank', 'POST', `${E()}/currencies`, { code: 'usd' })).json()).toEqual({ code: 'USD', enabled: true });
    const a = await c.adminDb.query(`SELECT count(*)::int n FROM audit_events WHERE action = 'currency.enable'`);
    expect(a.rows[0].n).toBe(1);
  });

  it('without a recorded rate, a USD journal asks for one', async () => {
    expect((await c.call('ama', 'POST', `${E()}/journals`, usd())).json().error.code).toBe('FX_RATE_REQUIRED');
  });

  it('rates: Bank of Ghana reference by default; bank or manual rates need a reason; never edited', async () => {
    const bog = await c.call('frank', 'POST', `${E()}/exchange-rates`, { currency: 'USD', rateDate: '2025-03-01', rate: '15.25' });
    expect(bog.statusCode, bog.body).toBe(201);
    expect(bog.json()).toMatchObject({ currency: 'USD', rate: '15.25000000', source: 'bog_reference' });
    expect((await c.call('frank', 'POST', `${E()}/exchange-rates`, { currency: 'USD', rateDate: '2025-03-05', rate: '15.40', source: 'bank' })).json().error.code).toBe('REASON_REQUIRED');
    expect((await c.call('frank', 'POST', `${E()}/exchange-rates`, { currency: 'USD', rateDate: '2025-03-05', rate: '15.40', source: 'bank', reason: 'Actual GCB conversion' })).statusCode).toBe(201);
    expect((await c.call('frank', 'POST', `${E()}/exchange-rates`, { currency: 'EUR', rateDate: '2025-03-05', rate: '17' })).json().error.code).toBe('CURRENCY_NOT_ENABLED');
    expect((await c.call('frank', 'POST', `${E()}/exchange-rates`, { currency: 'USD', rateDate: '2025-03-05', rate: '0' })).json().error.code).toBe('INVALID_FX_RATE');
    expect((await c.call('ama', 'POST', `${E()}/exchange-rates`, { currency: 'USD', rateDate: '2025-03-05', rate: '15' })).json().error.code).toBe('FORBIDDEN');
    await expect(c.adminDb.query(`UPDATE exchange_rates SET rate = 1`)).rejects.toThrow(/RATE_IMMUTABLE/);
    await expect(c.adminDb.query(`DELETE FROM exchange_rates`)).rejects.toThrow(/RATE_IMMUTABLE/);
  });

  it('a USD journal takes the rate in force on its date and records GHS amounts', async () => {
    expect((await c.call('ama', 'GET', `${E()}/exchange-rates/lookup?currency=USD&date=2025-03-04`)).json().rate).toBe('15.25000000');
    const d = await c.call('ama', 'POST', `${E()}/journals`, usd());
    expect(d.statusCode, d.body).toBe(201);
    expect(d.json()).toMatchObject({ currency: 'USD', fx_rate: '15.40000000' });   // 10 March: the 5 March bank rate is latest
    expect(d.json().totals.debit).toBe('1540.00');
    const typed = await c.call('ama', 'POST', `${E()}/journals`, usd({ fxRate: '15.30' }));
    expect(typed.json().fx_rate).toBe('15.30000000');
    const cur = (await c.call('ama', 'GET', `${E()}/currencies`)).json();
    expect(cur.enabled[0]).toMatchObject({ code: 'USD', latestRate: { rate: '15.40000000', source: 'bank' } });
  });
});
