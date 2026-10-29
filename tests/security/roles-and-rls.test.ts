/**
 * Blueprint Phase 0 — migration 005: least-privilege API role and RLS for Supabase Auth users.
 *  - pep_app (the role the API runs as) cannot change schema, disable triggers, delete evidence
 *    or read migration history.
 *  - authenticated users read only entities where they hold the permission, only with MFA (aal2),
 *    never sensitive columns, and can never write.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { setup, postJournal, type Ctx } from '../helpers.js';

let c: Ctx;
const authIds: Record<string, string> = {};

/** Run SQL inside a transaction as `role` with the given JWT claims (what PostgREST does). */
async function as<T>(role: string, claims: object | null, fn: (q: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await c.adminDb.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if (claims) await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
const user = (name: string, aal = 'aal2') => ({ sub: authIds[name], aal, role: 'authenticated' });
const count = async (q: pg.PoolClient, sql: string, params: unknown[] = []) => Number((await q.query(sql, params)).rows[0].n);

beforeAll(async () => {
  c = await setup();
  const bank = await c.acct(c.T, '1100'); const cap = await c.acct(c.T, '3100');
  await postJournal(c, { journalDate: '2026-10-05', description: 'RLS fixture', lines: [{ accountId: bank, debit: '10.00' }, { accountId: cap, credit: '10.00' }] });
  for (const u of ['frank', 'ama', 'kofi', 'auditor', 'admin', 'esi']) {
    authIds[u] = randomUUID();
    await c.adminDb.query('UPDATE users SET auth_user_id = $1 WHERE email = $2', [authIds[u], `${u}@pep.local`]);
  }
});
afterAll(async () => { await c.teardown(); });

describe('pep_app — the API role is least-privilege', () => {
  const refused = (sql: string, re: RegExp) => as('pep_app', null, (q) => expect(q.query(sql)).rejects.toThrow(re));

  it('is not a superuser and cannot bypass RLS', async () => {
    const r = (await c.adminDb.query(`SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'pep_app'`)).rows[0];
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
  });
  it('cannot alter tables or disable the invariant triggers', async () => {
    await refused('ALTER TABLE journal_lines DISABLE TRIGGER lines_frozen', /must be owner/);
    await refused('ALTER TABLE journal_entries ADD COLUMN x int', /must be owner/);
    await refused('DROP TABLE audit_events', /must be owner/);
    await refused(`SET session_replication_role = replica`, /permission denied/);
  });
  it('cannot update or delete the audit log, delete statement runs or rewrite templates', async () => {
    await refused(`UPDATE audit_events SET action = 'x'`, /permission denied/);
    await refused('DELETE FROM audit_events', /permission denied/);
    await refused('TRUNCATE audit_events', /permission denied/);
    await refused('DELETE FROM financial_statement_runs', /permission denied/);
    await refused(`UPDATE report_templates SET name = 'x'`, /permission denied/);
  });
  it('cannot read migration history or write configuration', async () => {
    await refused('SELECT * FROM schema_migrations', /permission denied/);
    await refused(`INSERT INTO app_config (key, value) VALUES ('X_KEY', 'y')`, /permission denied/);
  });
  it('can still run the full workflow (the 74 existing tests run as pep_app)', async () => {
    const who = (await c.db.query('SELECT current_user AS u')).rows[0].u;
    expect(who).toBe('pep_app');
  });
});

describe('authenticated — Supabase Auth users read through RLS only', () => {
  it('a controller with MFA sees both of their entities and their journals', async () => {
    await as('authenticated', user('frank'), async (q) => {
      expect(await count(q, 'SELECT count(*) n FROM entities')).toBe(2);
      expect(await count(q, 'SELECT count(*) n FROM journal_entries WHERE entity_id = $1', [c.T])).toBeGreaterThan(0);
      expect(await count(q, 'SELECT count(*) n FROM journal_lines')).toBeGreaterThan(0);
      expect(await count(q, 'SELECT count(*) n FROM ledger_postings')).toBeGreaterThan(0);
    });
  });
  it('without MFA (aal1) the same user sees nothing financial', async () => {
    await as('authenticated', user('frank', 'aal1'), async (q) => {
      for (const t of ['entities', 'accounts', 'journal_entries', 'journal_lines', 'audit_events', 'financial_statement_runs', 'ledger_postings']) {
        expect(await count(q, `SELECT count(*) n FROM ${t}`), t).toBe(0);
      }
    });
  });
  it('entity isolation: a Pep Landbank-only user never sees Trulander rows', async () => {
    await as('authenticated', user('esi'), async (q) => {
      expect(await count(q, 'SELECT count(*) n FROM entities WHERE id = $1', [c.T])).toBe(0);
      expect(await count(q, 'SELECT count(*) n FROM journal_entries WHERE entity_id = $1', [c.T])).toBe(0);
      expect(await count(q, 'SELECT count(*) n FROM accounts WHERE entity_id = $1', [c.T])).toBe(0);
      expect(await count(q, 'SELECT count(*) n FROM entities WHERE id = $1', [c.L])).toBe(1);
    });
  });
  it('permissions, not just membership: the system admin cannot read journals; the auditor can read the audit log', async () => {
    await as('authenticated', user('admin'), async (q) => {
      expect(await count(q, 'SELECT count(*) n FROM entities WHERE id = $1', [c.T])).toBe(1);
      expect(await count(q, 'SELECT count(*) n FROM journal_entries')).toBe(0);
      expect(await count(q, 'SELECT count(*) n FROM journal_lines')).toBe(0);
    });
    await as('authenticated', user('auditor'), async (q) => {
      expect(await count(q, 'SELECT count(*) n FROM audit_events WHERE entity_id = $1', [c.T])).toBeGreaterThan(0);
    });
  });
  it('a token for an unknown user, or no token, sees nothing', async () => {
    await as('authenticated', { sub: randomUUID(), aal: 'aal2' }, async (q) => {
      expect(await count(q, 'SELECT count(*) n FROM entities')).toBe(0);
    });
    await as('authenticated', null, async (q) => {
      expect(await count(q, 'SELECT count(*) n FROM journal_entries')).toBe(0);
    });
  });
  it('sensitive columns and internal tables are not readable', async () => {
    await as('authenticated', user('frank'), (q) => expect(q.query('SELECT tin_encrypted FROM entities')).rejects.toThrow(/permission denied/));
    await as('authenticated', user('frank'), (q) => expect(q.query('SELECT * FROM app_config')).rejects.toThrow(/permission denied/));
    await as('authenticated', user('frank'), (q) => expect(q.query('SELECT * FROM journal_sequences')).rejects.toThrow(/permission denied/));
    await as('authenticated', user('frank'), (q) => expect(q.query('SELECT * FROM schema_migrations')).rejects.toThrow(/permission denied/));
  });
  it('can never write — every change must go through the command API', async () => {
    await as('authenticated', user('frank'), (q) => expect(q.query(`UPDATE entities SET legal_name = 'x'`)).rejects.toThrow(/permission denied/));
    await as('authenticated', user('frank'), (q) => expect(q.query(`DELETE FROM journal_entries`)).rejects.toThrow(/permission denied/));
    await as('authenticated', user('frank'), (q) => expect(q.query(`INSERT INTO audit_events (action, object_type) VALUES ('x','y')`)).rejects.toThrow(/permission denied/));
  });
  it('users see their own profile only', async () => {
    await as('authenticated', user('ama'), async (q) => {
      const rows = (await q.query('SELECT email FROM users')).rows;
      expect(rows).toEqual([{ email: 'ama@pep.local' }]);
    });
  });
  it('anon sees nothing at all', async () => {
    // anon has no USAGE on the schema, so the tables are not even resolvable.
    await as('anon', null, (q) => expect(q.query('SELECT * FROM entities')).rejects.toThrow(/permission denied|does not exist/));
  });
});
