/**
 * Session tokens: HMAC-SHA256 signed, short-lived. This is a DEVELOPMENT
 * authentication layer. Production requires an identity provider with MFA for
 * privileged roles (see SECURITY.md — tracked as a release blocker).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, type JWTPayload } from 'jose';
import { audit, withTx, type Db } from './db.js';
import { DomainError } from '@pep/accounting-domain';
import { getConfig } from './config.js';

const TTL_SECONDS = 8 * 3600;

function secret(): string {
  const s = getConfig('AUTH_SECRET');
  if (!s || s.length < 32) {
    throw new DomainError('AUTH_NOT_CONFIGURED',
      'Sign-in is not configured on the server. An administrator must set the AUTH_SECRET secret (at least 32 characters).');
  }
  return s;
}

export function issueToken(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + TTL_SECONDS })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined): string {
  if (!token) throw new DomainError('UNAUTHENTICATED', 'Missing bearer token');
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw new DomainError('UNAUTHENTICATED', 'Malformed token');
  const expected = createHmac('sha256', secret()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new DomainError('UNAUTHENTICATED', 'Invalid token');
  }
  const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (typeof exp !== 'number' || exp < Date.now() / 1000) throw new DomainError('UNAUTHENTICATED', 'Token expired');
  return sub;
}

export interface Actor {
  id: string; email: string; fullName: string;
  /** How the caller signed in: Supabase Auth (production path) or the dev/staging demo login. */
  method?: 'supabase' | 'dev';
  /** True when the session completed two-step verification (Supabase aal2). */
  mfa?: boolean;
}

// ── Supabase Auth ─────────────────────────────────────────────────────────────
// Access tokens are JWTs. Current Supabase projects sign them with asymmetric keys published at
// <SUPABASE_URL>/auth/v1/.well-known/jwks.json; legacy projects use a shared HS256 secret.
// Both are supported; the token's own header decides which check applies (alg must match).
let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;
function remoteKeys(url: string) {
  if (!jwks || jwks.url !== url) jwks = { url, set: createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 600_000 }) };
  return jwks.set;
}
export const isJwt = (token: string) => token.split('.').length === 3;

export async function verifySupabaseJwt(token: string): Promise<JWTPayload> {
  const base = getConfig('SUPABASE_URL')?.replace(/\/$/, '');
  let alg: string | undefined;
  try { alg = decodeProtectedHeader(token).alg; } catch { throw new DomainError('UNAUTHENTICATED', 'Malformed token'); }
  const common = { audience: 'authenticated', ...(base ? { issuer: `${base}/auth/v1` } : {}) };
  try {
    if (alg === 'HS256') {
      const secret = getConfig('SUPABASE_JWT_SECRET');
      if (!secret) throw new DomainError('UNAUTHENTICATED', 'HS256 tokens are not accepted by this server');
      return (await jwtVerify(token, new TextEncoder().encode(secret), { ...common, algorithms: ['HS256'] })).payload;
    }
    if (!base) throw new DomainError('AUTH_NOT_CONFIGURED', 'SUPABASE_URL is not configured on the server');
    return (await jwtVerify(token, remoteKeys(`${base}/auth/v1/.well-known/jwks.json`), { ...common, algorithms: ['ES256', 'RS256', 'EdDSA'] })).payload;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError('UNAUTHENTICATED', 'Invalid or expired session');
  }
}

/** Resolve a bearer token (Supabase JWT, or the dev/staging HMAC token) to an active PEP user. */
export async function authenticateBearer(db: Db, token: string | undefined, opts: { allowDev: boolean }): Promise<Actor> {
  if (!token) throw new DomainError('UNAUTHENTICATED', 'Missing bearer token');
  if (isJwt(token)) {
    const claims = await verifySupabaseJwt(token);
    let r = await db.query('SELECT id, email, full_name FROM users WHERE auth_user_id = $1 AND is_active', [claims.sub]);
    // First sign-in after an invitation: link to the PEP user invited at this (provider-verified) e-mail.
    if (!r.rowCount && typeof claims.email === 'string' && claims.sub && await claimInvitation(db, claims.sub, claims.email)) {
      r = await db.query('SELECT id, email, full_name FROM users WHERE auth_user_id = $1 AND is_active', [claims.sub]);
    }
    if (!r.rowCount) throw new DomainError('UNAUTHENTICATED', 'This sign-in is not linked to an active PEP user. Ask an administrator for an invitation.');
    return { id: r.rows[0].id, email: r.rows[0].email, fullName: r.rows[0].full_name, method: 'supabase', mfa: claims.aal === 'aal2' };
  }
  if (!opts.allowDev || process.env.NODE_ENV === 'production') throw new DomainError('UNAUTHENTICATED', 'Unsupported token');
  const actor = await loadActor(db, verifyToken(token));
  // Demo sign-in exists only outside production and behind the staging access code.
  return { ...actor, method: 'dev', mfa: true };
}

/** Finance data requires a two-step-verified session unless REQUIRE_MFA is explicitly 'false'. */
export function assertMfa(actor: Actor) {
  if (getConfig('REQUIRE_MFA') === 'false') return;
  if (!actor.mfa) throw new DomainError('MFA_REQUIRED', 'Complete two-step verification to access financial data');
}
export interface EntityScope { entityId: string; roles: string[]; permissions: Set<string> }

export async function loadActor(db: Db, userId: string): Promise<Actor> {
  const r = await db.query('SELECT id, email, full_name FROM users WHERE id = $1 AND is_active', [userId]);
  if (!r.rowCount) throw new DomainError('UNAUTHENTICATED', 'User inactive or unknown');
  return { id: r.rows[0].id, email: r.rows[0].email, fullName: r.rows[0].full_name };
}

/** Entity-scoped permissions. No role on the entity ⇒ the entity does not exist for this user. */
export async function loadScope(db: Db, userId: string, entityId: string): Promise<EntityScope> {
  if (!/^[0-9a-f-]{36}$/i.test(entityId)) throw new DomainError('NOT_FOUND', 'Entity not found');
  const r = await db.query(
    `SELECT uer.role_code, rp.permission
       FROM user_entity_roles uer
       LEFT JOIN role_permissions rp ON rp.role_code = uer.role_code
      WHERE uer.user_id = $1 AND uer.entity_id = $2`,
    [userId, entityId],
  );
  if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Entity not found');
  return {
    entityId,
    roles: [...new Set(r.rows.map((x) => x.role_code as string))],
    permissions: new Set(r.rows.map((x) => x.permission as string).filter(Boolean)),
  };
}

export function requirePerm(scope: EntityScope, permission: string) {
  if (!scope.permissions.has(permission)) throw new DomainError('FORBIDDEN', `Missing permission ${permission}`);
}

/** Called on first sign-in by a Supabase user who is not yet linked: claim an open invitation for their verified e-mail. */
export async function claimInvitation(db: Db, authUserId: string, email: string): Promise<string | null> {
  return withTx(db, async (tx) => {
    const r = await tx.query(
      `SELECT u.id FROM users u
        WHERE u.email = $1 AND u.is_active AND u.auth_user_id IS NULL
          AND EXISTS (SELECT 1 FROM user_invitations i WHERE i.user_id = u.id AND i.status = 'sent')
        FOR UPDATE`, [email.toLowerCase()]);
    if (!r.rowCount) return null;
    const userId = r.rows[0].id as string;
    await tx.query('UPDATE users SET auth_user_id = $1 WHERE id = $2', [authUserId, userId]);
    const inv = await tx.query(
      `UPDATE user_invitations SET status = 'accepted', accepted_at = now(), auth_user_id = $2
        WHERE user_id = $1 AND status = 'sent' RETURNING entity_id`, [userId, authUserId]);
    for (const row of inv.rows) {
      await audit(tx, { entityId: row.entity_id, actorId: userId, action: 'user.invitation_accepted', objectType: 'user', objectId: userId });
    }
    return userId;
  });
}

