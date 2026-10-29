/**
 * S06 System health (Blueprint 04 §7 business monitors). One read-only view of whether the platform
 * and this entity's books are in a trustworthy state. Each check states what it proves.
 * Requires audit.read or users.manage (administrators and auditors), never financial write rights.
 */
import { DomainError } from '@pep/accounting-domain';
import type { Db } from '../lib/db.js';
import type { EntityScope } from '../lib/auth.js';

export const API_VERSION = '0.5.0-dev';

type Check = { key: string; label: string; ok: boolean; detail: string };

export async function systemHealth(db: Db, scope: EntityScope) {
  if (!scope.permissions.has('audit.read') && !scope.permissions.has('users.manage')) {
    throw new DomainError('FORBIDDEN', 'System health needs audit.read or users.manage');
  }
  const t0 = Date.now();
  await db.query('SELECT 1');
  const dbMs = Date.now() - t0;
  const checks: Check[] = [];

  const chain = await db.query('SELECT verify_audit_chain() AS broken_at');
  const broken = chain.rows[0].broken_at;
  const events = await db.query('SELECT count(*)::int AS n, max(occurred_at) AS last FROM audit_events');
  checks.push({ key: 'audit_chain', label: 'Audit trail hash chain', ok: broken === null,
    detail: broken === null ? `${events.rows[0].n.toLocaleString('en-GB')} events, chain intact` : `Chain breaks at event ${broken}` });

  // Posted ledger balances (all time and per financial year) for this entity.
  const tb = await db.query(
    `SELECT fy.label, coalesce(sum(lp.debit),0)::numeric AS dr, coalesce(sum(lp.credit),0)::numeric AS cr
       FROM financial_years fy
       LEFT JOIN accounting_periods p ON p.financial_year_id = fy.id
       LEFT JOIN ledger_postings lp ON lp.period_id = p.id
      WHERE fy.entity_id = $1 GROUP BY fy.label, fy.start_date ORDER BY fy.start_date`, [scope.entityId]);
  const unbalanced = tb.rows.filter((r) => r.dr !== r.cr);
  checks.push({ key: 'ledger_balanced', label: 'Posted ledger balances (debits = credits) per financial year', ok: unbalanced.length === 0,
    detail: unbalanced.length ? `Out of balance: ${unbalanced.map((r) => r.label).join(', ')}` : `${tb.rowCount} financial year(s) balance` });

  const stale = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries
      WHERE entity_id = $1 AND status IN ('submitted','approved') AND updated_at < now() - interval '7 days'`, [scope.entityId]);
  checks.push({ key: 'approvals_backlog', label: 'Journals waiting more than 7 days for approval or posting', ok: stale.rows[0].n === 0,
    detail: stale.rows[0].n === 0 ? 'None' : `${stale.rows[0].n} waiting` });

  const mig = await db.query(`SELECT count(*)::int AS n, max(filename) AS last FROM schema_migrations`).catch(() => null);
  return {
    api: { version: API_VERSION, dbLatencyMs: dbMs, checkedAt: new Date().toISOString() },
    migrations: mig ? { applied: mig.rows[0].n, latest: mig.rows[0].last } : null,
    lastAuditEvent: events.rows[0].last,
    checks,
    ok: checks.every((c) => c.ok),
  };
}
