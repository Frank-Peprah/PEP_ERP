/**
 * Spec §12 #17 (entity isolation) and defence-in-depth: the database itself refuses
 * to corrupt posted records even when the application layer is bypassed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx; let posted: any; let bankT: string; let capT: string;
beforeAll(async () => {
  c = await setup();
  bankT = await c.acct(c.T, '1100'); capT = await c.acct(c.T, '3100');
  posted = await postJournal(c, { journalDate: '2026-10-01', description: 'Posted',
    lines: [{ accountId: bankT, debit: '500.00' }, { accountId: capT, credit: '500.00' }] });
});
afterAll(async () => c.teardown());

describe('#17 entity isolation', () => {
  it('Landbank-only user cannot see Trulander entity, journals, TB or ledger (404, no existence leak)', async () => {
    for (const url of [`/api/entities/${c.T}`, `/api/entities/${c.T}/journals`, `/api/entities/${c.T}/journals/${posted.id}`,
                       `/api/entities/${c.T}/trial-balance`, `/api/entities/${c.T}/ledger?accountId=${bankT}`]) {
      const r = await c.call('esi', 'GET', url);
      expect(r.statusCode, url).toBe(404);
    }
  });

  it('cannot reach a Trulander journal by id through the Landbank scope', async () => {
    const r = await c.call('frank', 'GET', `/api/entities/${c.L}/journals/${posted.id}`);
    expect(r.statusCode).toBe(404);
  });

  it('cannot post Trulander accounts inside a Landbank journal', async () => {
    const capL = await c.acct(c.L, '3100');
    const r = await c.call('esi', 'POST', `/api/entities/${c.L}/journals`, { journalDate: '2026-10-01', description: 'cross',
      lines: [{ accountId: bankT, debit: '1.00' }, { accountId: capL, credit: '1.00' }] });
    expect(r.json().error.code).toBe('INVALID_ACCOUNT');
  });

  it('rejects missing, forged and tampered tokens', async () => {
    expect((await c.app.inject({ method: 'GET', url: `/api/entities/${c.T}` })).statusCode).toBe(401);
    const [p] = c.tokens.esi.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: c.base.users.frank, exp: 9999999999 })).toString('base64url');
    const r = await c.app.inject({ method: 'GET', url: `/api/entities/${c.T}`, headers: { authorization: `Bearer ${forgedPayload}.${c.tokens.esi.split('.')[1]}` } });
    expect(r.statusCode).toBe(401);
    void p;
  });
});

describe('Cross-origin access (web app on a separate host, e.g. SiteGround)', () => {
  it('preflight allows every method and header the web app uses', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await c.app.inject({ method: 'OPTIONS', url: `/api/entities/${c.T}/journals`, headers: {
        origin: 'https://erp.example.com', 'access-control-request-method': method,
        'access-control-request-headers': 'authorization,content-type,idempotency-key,x-access-code' } });
      expect(r.statusCode, method).toBe(204);
      expect(String(r.headers['access-control-allow-methods'])).toContain(method);
      expect(String(r.headers['access-control-allow-headers'])).toContain('x-access-code');
    }
  });
});

describe('Database-level controls (application bypassed)', () => {
  const expectDbError = async (sql: string, params: unknown[], code: string) => {
    await expect(c.db.query(sql, params)).rejects.toThrow(code);
  };

  it('#5 UPDATE of a posted journal line is refused by the database', async () => {
    await expectDbError('UPDATE journal_lines SET debit = 999 WHERE journal_id = $1', [posted.id], 'JOURNAL_LINES_IMMUTABLE');
  });
  it('#5 DELETE of a posted journal / its lines is refused', async () => {
    await expectDbError('DELETE FROM journal_lines WHERE journal_id = $1', [posted.id], 'JOURNAL_LINES_IMMUTABLE');
    await expectDbError('DELETE FROM journal_entries WHERE id = $1', [posted.id], 'JOURNAL_DELETE_FORBIDDEN');
  });
  it('#5 changing a posted header (date, description, status) is refused', async () => {
    await expectDbError(`UPDATE journal_entries SET description = 'x' WHERE id = $1`, [posted.id], 'POSTED_JOURNAL_IMMUTABLE');
    await expectDbError(`UPDATE journal_entries SET status = 'draft' WHERE id = $1`, [posted.id], 'POSTED_JOURNAL_IMMUTABLE');
  });
  it('#2 an unbalanced journal cannot be forced to posted via SQL', async () => {
    const j = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, { journalDate: '2026-10-02', description: 'unbal',
      lines: [{ accountId: bankT, debit: '1000.00' }, { accountId: capT, credit: '999.00' }] });
    const id = j.json().id;
    // walk the status machine by hand, then try to post
    await c.db.query(`UPDATE journal_entries SET status='submitted' WHERE id=$1`, [id]);
    await c.db.query(`UPDATE journal_entries SET status='approved', approved_by=$2 WHERE id=$1`, [id, c.base.users.kofi]);
    await expectDbError(`UPDATE journal_entries SET status='posted', journal_no='HACK-1', posted_by=$2, posted_at=now() WHERE id=$1`,
      [id, c.base.users.kofi], 'JOURNAL_UNBALANCED');
  });
  it('a journal cannot be inserted directly as posted, nor skip workflow states', async () => {
    const p = (await c.db.query(`SELECT id FROM accounting_periods WHERE entity_id=$1 AND '2026-10-03' BETWEEN start_date AND end_date`, [c.T])).rows[0].id;
    await expectDbError(`INSERT INTO journal_entries (entity_id, journal_date, period_id, description, currency, prepared_by, status, journal_no, posted_by, posted_at, approved_by)
      VALUES ($1,'2026-10-03',$2,'x','GHS',$3,'posted','X1',$3,now(),$3)`, [c.T, p, c.base.users.ama], 'JOURNAL_MUST_BE_POSTED_VIA_WORKFLOW');
    const d = await c.call('ama', 'POST', `/api/entities/${c.T}/journals`, { journalDate: '2026-10-03', description: 'skip',
      lines: [{ accountId: bankT, debit: '1.00' }, { accountId: capT, credit: '1.00' }] });
    await expectDbError(`UPDATE journal_entries SET status='approved' WHERE id=$1`, [d.json().id], 'INVALID_STATUS_TRANSITION');
  });
  it('the audit log cannot be updated, deleted or truncated; the hash chain verifies', async () => {
    await expectDbError('UPDATE audit_events SET action = $1', ['x'], 'AUDIT_LOG_APPEND_ONLY');
    await expectDbError('DELETE FROM audit_events', [], 'AUDIT_LOG_APPEND_ONLY');
    await expectDbError('TRUNCATE audit_events', [], 'AUDIT_LOG_APPEND_ONLY');
    expect((await c.db.query('SELECT verify_audit_chain() AS b')).rows[0].b).toBeNull();
  });
  it('account code/type are frozen once posted activity exists', async () => {
    await expectDbError(`UPDATE accounts SET account_type='expense' WHERE id=$1`, [bankT], 'ACCOUNT_HAS_POSTED_ACTIVITY');
    const del = await c.call('frank', 'DELETE', `/api/entities/${c.T}/accounts/${bankT}`);
    expect(del.json().error.code).toBe('ACCOUNT_HAS_ACTIVITY');
  });
  it('overlapping periods are refused', async () => {
    const r = await c.call('frank', 'POST', `/api/entities/${c.T}/financial-years`, { label: '2026B', startDate: '2026-07-01' });
    expect(r.json().error.code).toBe('OVERLAP');
  });
});
