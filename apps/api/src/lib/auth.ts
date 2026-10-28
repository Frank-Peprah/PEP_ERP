/**
 * Session tokens: HMAC-SHA256 signed, short-lived. This is a DEVELOPMENT
 * authentication layer. Production requires an identity provider with MFA for
 * privileged roles (see SECURITY.md — tracked as a release blocker).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';
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

export interface Actor { id: string; email: string; fullName: string }
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
