/**
 * Blueprint Phase 0 — Supabase Auth replaces custom tokens (ADR-006).
 * Covers both signing modes Supabase uses (asymmetric keys via JWKS; legacy HS256 secret),
 * the MFA gate (aal2) on financial routes, and rejection of every malformed/forged/expired case.
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { setup, type Ctx } from '../helpers.js';

let c: Ctx;
let server: Server;
let base = '';
let es: { privateKey: CryptoKey; kid: string };
const HS_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const ids: Record<string, string> = {};
const saved = { ...process.env };

async function token(opts: { sub?: string; aal?: string; alg?: 'ES256' | 'HS256'; exp?: string | number; aud?: string; iss?: string; key?: CryptoKey | Uint8Array } = {}) {
  const alg = opts.alg ?? 'ES256';
  const jwt = new SignJWT({ aal: opts.aal ?? 'aal2', role: 'authenticated' })
    .setProtectedHeader(alg === 'ES256' ? { alg, kid: es.kid } : { alg })
    .setSubject(opts.sub ?? ids.frank).setAudience(opts.aud ?? 'authenticated')
    .setIssuer(opts.iss ?? `${base}/auth/v1`).setIssuedAt().setExpirationTime(opts.exp ?? '1h');
  return jwt.sign(opts.key ?? (alg === 'ES256' ? es.privateKey : new TextEncoder().encode(HS_SECRET)));
}
const get = (t: string, url: string) => c.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${t}` } });

beforeAll(async () => {
  c = await setup();
  const kp = await generateKeyPair('ES256', { extractable: true });
  es = { privateKey: kp.privateKey as CryptoKey, kid: 'test-key-1' };
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: es.kid, alg: 'ES256', use: 'sig' };
  server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const u of ['frank', 'esi']) {
    ids[u] = randomUUID();
    await c.adminDb.query('UPDATE users SET auth_user_id = $1 WHERE email = $2', [ids[u], `${u}@pep.local`]);
  }
});
afterEach(() => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'REQUIRE_MFA', 'NODE_ENV']) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});
afterAll(async () => { server.close(); await c.teardown(); });

describe('Supabase access tokens', () => {
  it('asymmetric (JWKS) token with MFA reaches financial data', async () => {
    process.env.SUPABASE_URL = base;
    const t = await token();
    const me = await get(t, '/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: 'frank@pep.local', method: 'supabase', mfa: true });
    expect((await get(t, `/api/entities/${c.T}/journals`)).statusCode).toBe(200);
  });
  it('legacy HS256 token is accepted only when the shared secret is configured', async () => {
    process.env.SUPABASE_URL = base;
    const t = await token({ alg: 'HS256' });
    expect((await get(t, '/api/me')).statusCode).toBe(401);
    process.env.SUPABASE_JWT_SECRET = HS_SECRET;
    expect((await get(t, `/api/entities/${c.T}/journals`)).statusCode).toBe(200);
  });
  it('without two-step verification (aal1): profile yes, financial data no (MFA_REQUIRED)', async () => {
    process.env.SUPABASE_URL = base;
    const t = await token({ aal: 'aal1' });
    const me = await get(t, '/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user.mfa).toBe(false);
    const r = await get(t, `/api/entities/${c.T}/journals`);
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('MFA_REQUIRED');
  });
  it('REQUIRE_MFA=false relaxes the gate (staging only, documented)', async () => {
    process.env.SUPABASE_URL = base; process.env.REQUIRE_MFA = 'false';
    expect((await get(await token({ aal: 'aal1' }), `/api/entities/${c.T}/journals`)).statusCode).toBe(200);
  });
  it('entity isolation still applies to Supabase sessions', async () => {
    process.env.SUPABASE_URL = base;
    const r = await get(await token({ sub: ids.esi }), `/api/entities/${c.T}/journals`);
    expect(r.statusCode).toBe(404);
  });
  it('refuses forged, expired, wrong-audience, wrong-issuer and unlinked tokens', async () => {
    process.env.SUPABASE_URL = base;
    const other = (await generateKeyPair('ES256')).privateKey as CryptoKey;
    const bad = [
      await token({ key: other }),                                     // signed by an unknown key
      await token({ exp: Math.floor(Date.now() / 1000) - 60 }),        // expired
      await token({ aud: 'anon' }),                                    // wrong audience
      await token({ iss: 'https://evil.example.com/auth/v1' }),        // wrong issuer
      await token({ sub: randomUUID() }),                              // not linked to a PEP user
      'a.b.c',                                                         // malformed
    ];
    for (const t of bad) expect((await get(t, '/api/me')).statusCode, t.slice(0, 20)).toBe(401);
  });
  it('HS256 token signed with the wrong secret is refused (no algorithm confusion)', async () => {
    process.env.SUPABASE_URL = base; process.env.SUPABASE_JWT_SECRET = HS_SECRET;
    const t = await token({ alg: 'HS256', key: new TextEncoder().encode('x'.repeat(40)) });
    expect((await get(t, '/api/me')).statusCode).toBe(401);
  });
  it('the demo (HMAC) token is refused in production', async () => {
    process.env.NODE_ENV = 'production';
    expect((await get(c.tokens.frank, '/api/me')).statusCode).toBe(401);
  });
});
