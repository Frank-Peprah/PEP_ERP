import 'dotenv/config';
import { migrate } from '../database/migrate.js';
import { seedBase } from '../database/seeds/seed.js';
import { createPool, type Db } from '../apps/api/src/lib/db.js';
import { buildApp } from '../apps/api/src/app.js';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://pep:pep@localhost:5432/pep_test';
process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-123';

export async function setup() {
  await migrate(TEST_URL, { reset: true, quiet: true });
  // Run the whole suite as the least-privilege API role (migration 005), as production does.
  const db = createPool(TEST_URL, { role: process.env.PEP_DB_ROLE ?? 'pep_app' });
  // Owner-level connection: platform configuration (app_config) and tamper tests that prove the
  // database refuses changes even from a privileged role, not just from the API role.
  const adminDb = createPool(TEST_URL, { max: 2 });
  const base = await seedBase(db);
  const app = buildApp(db, { allowDevLogin: true });
  await app.ready();
  const tokens: Record<string, string> = {};
  for (const u of ['frank', 'ama', 'kofi', 'auditor', 'admin', 'esi']) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/dev-login', payload: { email: `${u}@pep.local` } });
    tokens[u] = r.json().token;
  }
  const T = base.entities.trulander, L = base.entities.landbank;
  const acct = async (entityId: string, code: string) =>
    (await db.query('SELECT id FROM accounts WHERE entity_id = $1 AND code = $2', [entityId, code])).rows[0].id as string;
  const call = (user: string, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${tokens[user]}`, ...headers } });
  return { db, adminDb, app, base, T, L, acct, call, tokens, teardown: async () => { await app.close(); await db.end(); await adminDb.end(); } };
}
export type Ctx = Awaited<ReturnType<typeof setup>>;

/** Prepare (ama) → submit → approve (kofi) → post (kofi). Returns final response JSON. */
export async function postJournal(c: Ctx, body: any, entityId = c.T) {
  const d = await c.call('ama', 'POST', `/api/entities/${entityId}/journals`, body);
  if (d.statusCode !== 201) throw new Error(`create failed: ${d.body}`);
  const id = d.json().id;
  for (const [u, a] of [['ama', 'submit'], ['kofi', 'approve'], ['kofi', 'post']] as const) {
    const r = await c.call(u, 'POST', `/api/entities/${entityId}/journals/${id}/${a}`);
    if (r.statusCode !== 200) throw new Error(`${a} failed: ${r.body}`);
  }
  return (await c.call('kofi', 'GET', `/api/entities/${entityId}/journals/${id}`)).json();
}
