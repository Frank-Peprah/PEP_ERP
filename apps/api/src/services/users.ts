/**
 * Users, invitations and approval policies (Blueprint Phase 0 · M0 Platform).
 * Controls: users.manage to invite/assign; nobody invites or grants roles to themselves; every
 * change audited; approval policies are append-only and effective-dated.
 */
import { Decimal, DomainError } from '@pep/accounting-domain';
import { audit, withTx, type Db } from '../lib/db.js';
import { requirePerm, type Actor, type EntityScope } from '../lib/auth.js';
import { canInvite, sendInvite } from '../lib/supabase-admin.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function listUsers(db: Db, scope: EntityScope) {
  if (!scope.permissions.has('users.manage') && !scope.permissions.has('users.read')) requirePerm(scope, 'users.manage');
  const r = await db.query(
    `SELECT u.id, u.email, u.full_name, u.is_active, (u.auth_user_id IS NOT NULL) AS can_sign_in,
            array_agg(DISTINCT uer.role_code ORDER BY uer.role_code) AS roles,
            (SELECT json_build_object('status', i.status, 'sent_at', i.sent_at, 'accepted_at', i.accepted_at)
               FROM user_invitations i WHERE i.user_id = u.id AND i.entity_id = $1 ORDER BY i.sent_at DESC LIMIT 1) AS invitation
       FROM user_entity_roles uer JOIN users u ON u.id = uer.user_id
      WHERE uer.entity_id = $1
      GROUP BY u.id ORDER BY u.full_name`, [scope.entityId]);
  return { users: r.rows, canSendInvites: canInvite() };
}

export async function listRoles(db: Db) {
  const r = await db.query(
    `SELECT r.code, r.name, r.description, array_agg(rp.permission ORDER BY rp.permission) AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_code = r.code GROUP BY r.code ORDER BY r.name`);
  return r.rows;
}

export async function inviteUser(db: Db, scope: EntityScope, actor: Actor,
                                 input: { email?: string; fullName?: string; roles?: string[] }) {
  requirePerm(scope, 'users.manage');
  const email = String(input.email ?? '').trim().toLowerCase();
  const fullName = String(input.fullName ?? '').trim();
  const roles = [...new Set((input.roles ?? []).map(String))];
  if (!EMAIL.test(email)) throw new DomainError('INVALID_EMAIL', 'Enter a valid e-mail address');
  if (fullName.length < 2) throw new DomainError('INVALID_NAME', 'Enter the person’s full name');
  if (!roles.length) throw new DomainError('ROLES_REQUIRED', 'Choose at least one role');
  if (email === actor.email.toLowerCase()) {
    throw new DomainError('SEGREGATION_OF_DUTIES', 'You cannot invite yourself or change your own roles; ask another administrator');
  }

  const out = await withTx(db, async (tx) => {
    const known = await tx.query('SELECT code FROM roles WHERE code = ANY($1::text[])', [roles]);
    if (known.rowCount !== roles.length) throw new DomainError('UNKNOWN_ROLE', 'One or more roles do not exist');
    const existing = await tx.query('SELECT id, auth_user_id, is_active FROM users WHERE email = $1 FOR UPDATE', [email]);
    let userId: string;
    let linked = false;
    if (existing.rowCount) {
      if (!existing.rows[0].is_active) throw new DomainError('USER_INACTIVE', 'This user is deactivated; reactivate them first');
      userId = existing.rows[0].id;
      linked = existing.rows[0].auth_user_id !== null;
    } else {
      userId = (await tx.query('INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id', [email, fullName])).rows[0].id;
    }
    if (userId === actor.id) throw new DomainError('SEGREGATION_OF_DUTIES', 'You cannot change your own roles');
    const added: string[] = [];
    for (const role of roles) {
      const ins = await tx.query(
        `INSERT INTO user_entity_roles (user_id, entity_id, role_code, granted_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING RETURNING role_code`, [userId, scope.entityId, role, actor.id]);
      if (ins.rowCount) added.push(role);
    }
    const inv = await tx.query(
      `INSERT INTO user_invitations (entity_id, user_id, email, roles, invited_by, status, accepted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [scope.entityId, userId, email, roles, actor.id, linked ? 'accepted' : 'sent', linked ? new Date() : null]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'user.invite', objectType: 'user', objectId: userId,
      after: { email, roles, rolesAdded: added, invitationId: inv.rows[0].id, alreadyLinked: linked } });
    return { userId, invitationId: inv.rows[0].id as string, linked, added };
  });

  if (out.linked) return { ...out, status: 'roles_updated', emailSent: false };
  const sent = await sendInvite(email, { pep_user_id: out.userId });
  if (sent.authUserId) {
    await withTx(db, async (tx) => {
      await tx.query('UPDATE users SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL', [sent.authUserId, out.userId]);
      await tx.query('UPDATE user_invitations SET auth_user_id = $1 WHERE id = $2', [sent.authUserId, out.invitationId]);
    });
  }
  return {
    ...out,
    status: sent.emailSent ? 'invitation_sent' : sent.alreadyRegistered ? 'link_on_next_sign_in' : 'created_without_email',
    emailSent: sent.emailSent,
  };
}

export { claimInvitation } from '../lib/auth.js';

// ───────────────────────────── Approval policies ─────────────────────────────
const DOC_TYPES = ['journal', 'bill', 'payment', 'payout_detail_change', 'refund', 'role_change', 'contract'];

export async function listPolicies(db: Db, scope: EntityScope) {
  requirePerm(scope, 'policies.read');
  const r = await db.query(
    `SELECT p.*, u.full_name AS created_by_name FROM approval_policies p JOIN users u ON u.id = p.created_by
      WHERE p.entity_id = $1 ORDER BY p.document_type, p.effective_from DESC, p.threshold`, [scope.entityId]);
  return r.rows;
}

export async function createPolicy(db: Db, scope: EntityScope, actor: Actor,
  input: { documentType?: string; threshold?: string; approvalsRequired?: number; effectiveFrom?: string; reason?: string }) {
  requirePerm(scope, 'policies.manage');
  if (!DOC_TYPES.includes(String(input.documentType))) throw new DomainError('INVALID_DOCUMENT_TYPE', `Document type must be one of: ${DOC_TYPES.join(', ')}`);
  let threshold: string;
  try { threshold = new Decimal(String(input.threshold ?? '')).toFixed(2); } catch { throw new DomainError('INVALID_AMOUNT', 'Threshold must be an amount'); }
  if (new Decimal(threshold).isNegative()) throw new DomainError('INVALID_AMOUNT', 'Threshold cannot be negative');
  const n = Number(input.approvalsRequired);
  if (!Number.isInteger(n) || n < 1 || n > 3) throw new DomainError('INVALID_APPROVALS', 'Approvals required must be 1, 2 or 3');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.effectiveFrom ?? ''))) throw new DomainError('INVALID_DATE', 'Effective date must be YYYY-MM-DD');
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError('REASON_REQUIRED', 'Give a reason for the policy');
  return withTx(db, async (tx) => {
    const r = await tx.query(
      `INSERT INTO approval_policies (entity_id, document_type, threshold, approvals_required, effective_from, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [scope.entityId, input.documentType, threshold, n, input.effectiveFrom, reason, actor.id]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'policy.create', objectType: 'approval_policy',
      objectId: r.rows[0].id, after: r.rows[0], reason });
    return r.rows[0];
  });
}

export async function approvalsRequired(db: Db, scope: EntityScope, documentType: string, amount: string, on: string) {
  requirePerm(scope, 'policies.read');
  const r = await db.query('SELECT approvals_required($1,$2,$3::numeric,$4::date) AS n', [scope.entityId, documentType, amount, on]);
  return { documentType, amount, on, approvalsRequired: Number(r.rows[0].n) };
}
