/**
 * Blueprint Phase 0 · M0 Platform — invitations, first-sign-in claiming, approval policies.
 * The Supabase Auth admin API is replaced by a local HTTP server so every branch is exercised.
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { setup, type Ctx } from '../helpers.js';

let c: Ctx;
let server: Server;
let base = '';
const HS = 'platform-test-jwt-secret-with-enough-length-1234';
let next: { status: number; body: unknown } = { status: 200, body: {} };
const seen: { url: string; headers: Record<string, unknown>; body: any }[] = [];
const saved = { ...process.env };

const E = () => `/api/entities/${c.T}`;
async function jwtFor(sub: string, email: string, aal = 'aal2') {
  return new SignJWT({ aal, email, role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub).setAudience('authenticated').setIssuer(`${base}/auth/v1`).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(HS));
}
const asJwt = (t: string, method: string, url: string, payload?: unknown) =>
  c.app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${t}` } });
function supabase(on = true) {
  if (on) { process.env.SUPABASE_URL = base; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test'; process.env.SUPABASE_JWT_SECRET = HS; process.env.INVITE_REDIRECT_URL = 'https://app.example.com/'; }
}

beforeAll(async () => {
  c = await setup();
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.statusCode = next.status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(() => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'INVITE_REDIRECT_URL']) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  seen.length = 0;
});
afterAll(async () => { server.close(); await c.teardown(); });

describe('Invitations', () => {
  it('system admin invites a person; without Supabase configured the user and roles are created, no e-mail', async () => {
    const r = await c.call('admin', 'POST', `${E()}/users/invite`, { email: 'Yaw.Asante@Example.com', fullName: 'Yaw Asante', roles: ['accountant'] });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ status: 'created_without_email', emailSent: false, added: ['accountant'] });
    const list = (await c.call('admin', 'GET', `${E()}/users`)).json();
    const yaw = list.users.find((u: any) => u.email === 'yaw.asante@example.com');
    expect(yaw).toMatchObject({ roles: ['accountant'], can_sign_in: false, invitation: { status: 'sent' } });
    const a = await c.adminDb.query(`SELECT action FROM audit_events WHERE action = 'user.invite' AND after->>'email' = 'yaw.asante@example.com'`);
    expect(a.rowCount).toBe(1);
  });

  it('with Supabase configured: sends the invite with the service key and redirect, and links the Auth user', async () => {
    supabase();
    const authId = randomUUID();
    next = { status: 200, body: { id: authId, email: 'abena@example.com' } };
    const r = await c.call('admin', 'POST', `${E()}/users/invite`, { email: 'abena@example.com', fullName: 'Abena Mensah', roles: ['preparer'] });
    expect(r.json()).toMatchObject({ status: 'invitation_sent', emailSent: true });
    expect(seen[0].url).toBe(`/auth/v1/invite?redirect_to=${encodeURIComponent('https://app.example.com/')}`);
    expect(seen[0].headers.apikey).toBe('service-key-test');
    expect(seen[0].body).toMatchObject({ email: 'abena@example.com', data: { pep_user_id: r.json().userId } });
    const u = await c.adminDb.query('SELECT auth_user_id FROM users WHERE email = $1', ['abena@example.com']);
    expect(u.rows[0].auth_user_id).toBe(authId);
    // The invited person signs in (after setting a password and enrolling MFA) and reaches Trulander.
    const t = await jwtFor(authId, 'abena@example.com');
    expect((await asJwt(t, 'GET', `${E()}/journals`)).statusCode).toBe(200);
    // Their first visit to the app (GET /me) records the invitation as accepted, once.
    await asJwt(t, 'GET', '/api/me'); await asJwt(t, 'GET', '/api/me');
    const inv = await c.adminDb.query(`SELECT status FROM user_invitations WHERE email = 'abena@example.com'`);
    expect(inv.rows.map((r: any) => r.status)).toEqual(['accepted']);
    const aud = await c.adminDb.query(`SELECT count(*)::int n FROM audit_events WHERE action = 'user.invitation_accepted' AND object_id = $1`, [r.json().userId]);
    expect(aud.rows[0].n).toBe(1);
  });

  it('existing Supabase sign-in: linked automatically on first sign-in with the invited, verified e-mail', async () => {
    supabase();
    next = { status: 422, body: { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' } };
    const r = await c.call('admin', 'POST', `${E()}/users/invite`, { email: 'kwame@example.com', fullName: 'Kwame Boateng', roles: ['auditor'] });
    expect(r.json()).toMatchObject({ status: 'link_on_next_sign_in', emailSent: false });
    const sub = randomUUID();
    const me = await asJwt(await jwtFor(sub, 'kwame@example.com'), 'GET', '/api/me');
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json().user.email).toBe('kwame@example.com');
    const inv = await c.adminDb.query(`SELECT status, auth_user_id FROM user_invitations WHERE email = 'kwame@example.com'`);
    expect(inv.rows[0]).toEqual({ status: 'accepted', auth_user_id: sub });
    // auditor role: may read the audit trail, may not prepare journals
    const t = await jwtFor(sub, 'kwame@example.com');
    expect((await asJwt(t, 'GET', `${E()}/audit`)).statusCode).toBe(200);
    expect((await asJwt(t, 'POST', `${E()}/journals`, { journalDate: '2026-10-05', description: 'x', lines: [] })).statusCode).toBe(403);
  });

  it('a sign-in with a matching e-mail but no invitation is NOT linked (no account takeover by e-mail)', async () => {
    supabase();
    const r = await asJwt(await jwtFor(randomUUID(), 'kofi@pep.local'), 'GET', '/api/me');
    expect(r.statusCode).toBe(401);
    const u = await c.adminDb.query(`SELECT auth_user_id FROM users WHERE email = 'kofi@pep.local'`);
    expect(u.rows[0].auth_user_id).toBeNull();
  });

  it('segregation of duties and permissions', async () => {
    const self = await c.call('admin', 'POST', `${E()}/users/invite`, { email: 'admin@pep.local', fullName: 'Admin', roles: ['controller'] });
    expect(self.json().error.code).toBe('SEGREGATION_OF_DUTIES');
    expect(self.statusCode).toBe(403);
    const ama = await c.call('ama', 'POST', `${E()}/users/invite`, { email: 'z@example.com', fullName: 'Zee', roles: ['accountant'] });
    expect(ama.json().error.code).toBe('FORBIDDEN');
    // Database backstop: an invitation where inviter = invitee is refused even by direct SQL.
    await expect(c.adminDb.query(`INSERT INTO user_invitations (entity_id, user_id, email, roles, invited_by)
      SELECT $1, id, email, '{accountant}', id FROM users WHERE email = 'ama@pep.local'`, [c.T])).rejects.toThrow(/check constraint/);
  });

  it('validation: e-mail, name, roles', async () => {
    const bad = async (body: unknown) => (await c.call('admin', 'POST', `${E()}/users/invite`, body)).json().error.code;
    expect(await bad({ email: 'not-an-email', fullName: 'A B', roles: ['accountant'] })).toBe('INVALID_EMAIL');
    expect(await bad({ email: 'a@b.com', fullName: '', roles: ['accountant'] })).toBe('INVALID_NAME');
    expect(await bad({ email: 'a@b.com', fullName: 'A B', roles: [] })).toBe('ROLES_REQUIRED');
    expect(await bad({ email: 'a@b.com', fullName: 'A B', roles: ['emperor'] })).toBe('UNKNOWN_ROLE');
  });
});

describe('Approval policies (effective-dated, append-only)', () => {
  it('controller sets a two-approver tier above GHS 50,000 from 1 Nov; lookups respect amount and date', async () => {
    const r = await c.call('frank', 'POST', `${E()}/approval-policies`,
      { documentType: 'payment', threshold: '50000', approvalsRequired: 2, effectiveFrom: '2026-11-01', reason: 'Board resolution: dual control on large payments' });
    expect(r.statusCode, r.body).toBe(201);
    const req = async (amount: string, on: string) =>
      (await c.call('frank', 'GET', `${E()}/approval-policies/required?documentType=payment&amount=${amount}&on=${on}`)).json().approvalsRequired;
    expect(await req('60000', '2026-11-02')).toBe(2);
    expect(await req('50000', '2026-11-02')).toBe(1);   // "above" the threshold, not at it
    expect(await req('60000', '2026-10-30')).toBe(1);   // not yet effective
  });
  it('policies cannot be edited or deleted, only superseded', async () => {
    await expect(c.adminDb.query(`UPDATE approval_policies SET approvals_required = 1`)).rejects.toThrow(/APPEND_ONLY/);
    await expect(c.adminDb.query(`DELETE FROM approval_policies`)).rejects.toThrow(/APPEND_ONLY/);
  });
  it('only policies.manage may create; auditors may read', async () => {
    const r = await c.call('ama', 'POST', `${E()}/approval-policies`,
      { documentType: 'journal', threshold: '0', approvalsRequired: 2, effectiveFrom: '2026-11-01', reason: 'x' });
    expect(r.json().error.code).toBe('FORBIDDEN');
    expect((await c.call('auditor', 'GET', `${E()}/approval-policies`)).json().length).toBeGreaterThan(0);
  });
  it('validation and reason required', async () => {
    const bad = async (body: object) => (await c.call('frank', 'POST', `${E()}/approval-policies`,
      { documentType: 'journal', threshold: '10', approvalsRequired: 2, effectiveFrom: '2026-11-01', reason: 'ok', ...body })).json().error.code;
    expect(await bad({ documentType: 'lunch' })).toBe('INVALID_DOCUMENT_TYPE');
    expect(await bad({ approvalsRequired: 5 })).toBe('INVALID_APPROVALS');
    expect(await bad({ threshold: '-1' })).toBe('INVALID_AMOUNT');
    expect(await bad({ reason: ' ' })).toBe('REASON_REQUIRED');
  });
});

describe('System health (S06)', () => {
  it('administrators and auditors see live integrity checks; all pass on a clean ledger', async () => {
    for (const who of ['admin', 'auditor']) {
      const r = await c.call(who, 'GET', `${E()}/system-health`);
      expect(r.statusCode, r.body).toBe(200);
      const h = r.json();
      expect(h.api.version).toBe('0.5.2-dev');
      expect(h.checks.map((x: any) => x.key)).toEqual(['audit_chain', 'ledger_balanced', 'approvals_backlog']);
      expect(h.checks.find((x: any) => x.key === 'audit_chain').ok).toBe(true);
      expect(h.checks.find((x: any) => x.key === 'ledger_balanced').ok).toBe(true);
    }
  });
  it('preparers without audit or user-management rights cannot open it', async () => {
    expect((await c.call('ama', 'GET', `${E()}/system-health`)).json().error.code).toBe('FORBIDDEN');
  });
});
