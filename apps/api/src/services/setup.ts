import { Decimal, DomainError } from '@pep/accounting-domain';
import { audit, withTx, type Db } from '../lib/db.js';
import { requirePerm, type Actor, type EntityScope } from '../lib/auth.js';

// ───────────────────────────── Entity ─────────────────────────────
export async function getEntity(db: Db, scope: EntityScope) {
  requirePerm(scope, 'entity.read');
  const r = await db.query(
    `SELECT e.id, e.code, e.legal_name, e.trading_name, e.registration_no, e.jurisdiction, e.industry,
            e.reporting_framework, e.functional_currency, e.presentation_currency, e.segregation_enabled,
            e.retained_earnings_account_id, (e.tin_encrypted IS NOT NULL) AS has_tin
       FROM entities e WHERE e.id = $1`, [scope.entityId]);
  // TIN is never decrypted for display — only presence is disclosed (masked).
  return { ...r.rows[0], tin_display: r.rows[0].has_tin ? '••••••••' : null, roles: scope.roles, permissions: [...scope.permissions] };
}

// ───────────────────────────── Financial years & periods ─────────────────────────────
export async function listPeriods(db: Db, scope: EntityScope) {
  requirePerm(scope, 'entity.read');
  const fys = await db.query('SELECT * FROM financial_years WHERE entity_id = $1 ORDER BY start_date DESC', [scope.entityId]);
  const ps = await db.query(
    `SELECT p.*, u.full_name AS locked_by_name,
            (SELECT count(*) FROM journal_entries j WHERE j.period_id = p.id AND j.status = 'posted')::int AS posted_count,
            (SELECT count(*) FROM journal_entries j WHERE j.period_id = p.id AND j.status IN ('draft','submitted','approved'))::int AS open_count
       FROM accounting_periods p LEFT JOIN users u ON u.id = p.locked_by
      WHERE p.entity_id = $1 ORDER BY p.start_date`, [scope.entityId]);
  return fys.rows.map((fy) => ({ ...fy, periods: ps.rows.filter((p) => p.financial_year_id === fy.id) }));
}

/** Create a financial year with 12 calendar-month periods (or custom count of months). */
export async function createFinancialYear(db: Db, scope: EntityScope, actor: Actor,
                                          input: { label: string; startDate: string; months?: number }) {
  requirePerm(scope, 'periods.manage');
  const months = input.months ?? 12;
  if (months < 1 || months > 18) throw new DomainError('INVALID_FY', 'A financial year must have 1–18 monthly periods');
  if (!/^\d{4}-\d{2}-01$/.test(input.startDate)) throw new DomainError('INVALID_FY', 'Financial year must start on the first day of a month');
  return withTx(db, async (tx) => {
    const end = await tx.query(`SELECT ($1::date + ($2 || ' months')::interval - interval '1 day')::date AS d`, [input.startDate, months]);
    const fy = await tx.query(
      `INSERT INTO financial_years (entity_id, label, start_date, end_date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [scope.entityId, input.label.trim(), input.startDate, end.rows[0].d]);
    for (let i = 0; i < months; i++) {
      await tx.query(
        `INSERT INTO accounting_periods (entity_id, financial_year_id, period_no, name, start_date, end_date)
         SELECT $1, $2, $3, to_char(s, 'Mon YYYY'), s, (s + interval '1 month' - interval '1 day')::date
           FROM (SELECT ($4::date + ($5 || ' months')::interval)::date AS s) x`,
        [scope.entityId, fy.rows[0].id, i + 1, input.startDate, i]);
    }
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'fy.create', objectType: 'financial_year',
      objectId: fy.rows[0].id, after: fy.rows[0] });
    return fy.rows[0];
  });
}

export async function setPeriodStatus(db: Db, scope: EntityScope, actor: Actor, periodId: string,
                                      action: 'lock' | 'reopen', reason?: string) {
  requirePerm(scope, action === 'lock' ? 'periods.lock' : 'periods.reopen');
  if (action === 'reopen' && !reason?.trim()) throw new DomainError('REASON_REQUIRED', 'Re-opening a period requires a reason');
  return withTx(db, async (tx) => {
    const r = await tx.query('SELECT * FROM accounting_periods WHERE id = $1 AND entity_id = $2 FOR UPDATE', [periodId, scope.entityId]);
    if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Period not found');
    const p = r.rows[0];
    if (action === 'lock') {
      if (p.status === 'locked') throw new DomainError('ALREADY_LOCKED', 'Period is already locked');
      // Close gate (R1 minimum): trial balance for the period must balance.
      const tb = await tx.query(
        `SELECT COALESCE(sum(debit),0) AS dr, COALESCE(sum(credit),0) AS cr FROM ledger_postings
          WHERE entity_id = $1 AND period_id = $2`, [scope.entityId, periodId]);
      if (tb.rows[0].dr !== tb.rows[0].cr) throw new DomainError('CLOSE_CHECK_FAILED', 'Period movements do not balance — investigate before locking');
      await tx.query(`UPDATE accounting_periods SET status='locked', locked_by=$1, locked_at=now() WHERE id=$2`, [actor.id, periodId]);
    } else {
      if (p.status === 'open') throw new DomainError('ALREADY_OPEN', 'Period is already open');
      await tx.query(`UPDATE accounting_periods SET status='open', locked_by=NULL, locked_at=NULL WHERE id=$1`, [periodId]);
      // Re-opening any period of a closed year re-opens the year: its result may change, so the close
      // must be reviewed (reverse the closing journal and close again if figures move).
      const fy = await tx.query(
        `UPDATE financial_years SET is_closed = false, closed_at = NULL, closed_by = NULL
          WHERE id = $1 AND is_closed RETURNING id, label`, [p.financial_year_id]);
      if (fy.rowCount) {
        await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'year.reopen', objectType: 'financial_year',
          objectId: fy.rows[0].id, reason: reason ?? null, after: { label: fy.rows[0].label, reopenedPeriod: p.name } });
      }
    }
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: `period.${action}`, objectType: 'period', objectId: periodId,
      before: { status: p.status }, after: { status: action === 'lock' ? 'locked' : 'open' }, reason: reason ?? null });
    return (await tx.query('SELECT * FROM accounting_periods WHERE id = $1', [periodId])).rows[0];
  });
}

// ───────────────────────────── Chart of accounts ─────────────────────────────
const NORMAL: Record<string, 'debit' | 'credit'> = { asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit' };

export async function listAccounts(db: Db, scope: EntityScope) {
  requirePerm(scope, 'coa.read');
  const r = await db.query(
    `SELECT a.*, p.code AS parent_code,
            EXISTS (SELECT 1 FROM ledger_postings lp WHERE lp.account_id = a.id) AS has_activity
       FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
      WHERE a.entity_id = $1 ORDER BY a.code`, [scope.entityId]);
  return r.rows;
}

export interface AccountInput {
  code: string; name: string; accountType: string; normalBalance?: string; parentCode?: string | null;
  isPostable?: boolean; isControl?: boolean; requiresReconciliation?: boolean; cashFlowClass?: string;
  statementLineCode?: string | null; noteRef?: string | null; isActive?: boolean;
}

export async function createAccount(db: Db, scope: EntityScope, actor: Actor, input: AccountInput) {
  requirePerm(scope, 'coa.manage');
  if (!NORMAL[input.accountType]) throw new DomainError('INVALID_ACCOUNT_TYPE', `Unknown account type ${input.accountType}`);
  const normal = input.normalBalance ?? NORMAL[input.accountType];
  return withTx(db, async (tx) => {
    let parentId: string | null = null;
    if (input.parentCode) {
      const p = await tx.query('SELECT id, is_postable FROM accounts WHERE entity_id = $1 AND code = $2', [scope.entityId, input.parentCode]);
      if (!p.rowCount) throw new DomainError('INVALID_PARENT', `Parent account ${input.parentCode} not found`);
      if (p.rows[0].is_postable) throw new DomainError('INVALID_PARENT', `Parent ${input.parentCode} is a posting account; parents must be header accounts`);
      parentId = p.rows[0].id;
    }
    const r = await tx.query(
      `INSERT INTO accounts (entity_id, code, name, account_type, normal_balance, parent_id, is_postable, is_control,
                             requires_reconciliation, cash_flow_class, statement_line_code, note_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [scope.entityId, input.code.trim().toUpperCase(), input.name.trim(), input.accountType, normal, parentId,
       input.isPostable ?? true, input.isControl ?? false, input.requiresReconciliation ?? false,
       input.cashFlowClass ?? 'none', input.statementLineCode ?? null, input.noteRef ?? null]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'account.create', objectType: 'account',
      objectId: r.rows[0].id, after: r.rows[0] });
    return r.rows[0];
  });
}

export async function updateAccount(db: Db, scope: EntityScope, actor: Actor, id: string, input: Partial<AccountInput>) {
  requirePerm(scope, 'coa.manage');
  return withTx(db, async (tx) => {
    const cur = await tx.query('SELECT * FROM accounts WHERE id = $1 AND entity_id = $2 FOR UPDATE', [id, scope.entityId]);
    if (!cur.rowCount) throw new DomainError('NOT_FOUND', 'Account not found');
    const a = cur.rows[0];
    const fields: Record<string, unknown> = {
      name: input.name?.trim() ?? a.name,
      is_active: input.isActive ?? a.is_active,
      requires_reconciliation: input.requiresReconciliation ?? a.requires_reconciliation,
      cash_flow_class: input.cashFlowClass ?? a.cash_flow_class,
      statement_line_code: input.statementLineCode === undefined ? a.statement_line_code : input.statementLineCode,
      note_ref: input.noteRef === undefined ? a.note_ref : input.noteRef,
      account_type: input.accountType ?? a.account_type,
      normal_balance: input.normalBalance ?? (input.accountType ? NORMAL[input.accountType] : a.normal_balance),
      code: input.code?.trim().toUpperCase() ?? a.code,
    };
    if (fields.is_active === false && a.is_active) {
      const bal = await tx.query(`SELECT COALESCE(sum(net),0) AS b FROM ledger_postings WHERE account_id = $1`, [id]);
      if (!new Decimal(bal.rows[0].b).eq(0)) {
        throw new DomainError('ACCOUNT_HAS_BALANCE', `Account carries a balance of ${bal.rows[0].b}; clear it before deactivating`);
      }
    }
    const keys = Object.keys(fields);
    const r = await tx.query(
      `UPDATE accounts SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING *`,
      [...keys.map((k) => fields[k]), id]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'account.update', objectType: 'account', objectId: id,
      before: a, after: r.rows[0] });
    return r.rows[0];
  });
}

export async function deleteAccount(db: Db, scope: EntityScope, actor: Actor, id: string) {
  requirePerm(scope, 'coa.manage');
  return withTx(db, async (tx) => {
    const cur = await tx.query('SELECT * FROM accounts WHERE id = $1 AND entity_id = $2 FOR UPDATE', [id, scope.entityId]);
    if (!cur.rowCount) throw new DomainError('NOT_FOUND', 'Account not found');
    const used = await tx.query('SELECT 1 FROM journal_lines WHERE account_id = $1 LIMIT 1', [id]);
    if (used.rowCount) throw new DomainError('ACCOUNT_HAS_ACTIVITY', 'Account has journal activity; deactivate it instead');
    await tx.query('DELETE FROM accounts WHERE id = $1', [id]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'account.delete', objectType: 'account', objectId: id, before: cur.rows[0] });
    return { deleted: true };
  });
}

export async function listAudit(db: Db, scope: EntityScope, limit = 200) {
  requirePerm(scope, 'audit.read');
  const r = await db.query(
    `SELECT a.id, a.action, a.object_type, a.object_id, a.before, a.after, a.reason, a.occurred_at, a.hash, u.full_name AS actor_name
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity_id = $1 ORDER BY a.id DESC LIMIT $2`, [scope.entityId, Math.min(limit, 1000)]);
  const chain = await db.query('SELECT verify_audit_chain() AS broken_at');
  return { events: r.rows, chainIntact: chain.rows[0].broken_at === null, brokenAt: chain.rows[0].broken_at };
}
