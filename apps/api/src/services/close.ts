/**
 * Year-end close (Blueprint Phase 1; decision D4 default: closing journal to retained earnings).
 *   1. preview  — what the closing journal will contain and which preconditions are unmet;
 *   2. generate — system-computed draft closing journal (controller, year.close), dated the last day of
 *                 the year, then the normal workflow: submit → another person approves → post;
 *   3. finalise — lock any open period and mark the year closed (database guard re-checks everything).
 * Profit or loss excludes earlier closing journals, so re-running after a reversal is exact.
 */
import { Decimal, DomainError } from '@pep/accounting-domain';
import { audit, withTx, type Db } from '../lib/db.js';
import { requirePerm, type Actor, type EntityScope } from '../lib/auth.js';
import { createDraft } from './journals.js';

const D = (v: string | number) => new Decimal(v);

async function yearOf(db: Db, entityId: string, fyId: string) {
  const r = await db.query('SELECT * FROM financial_years WHERE id = $1 AND entity_id = $2', [fyId, entityId]);
  if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Financial year not found');
  return r.rows[0];
}

export async function previewClose(db: Db, scope: EntityScope, fyId: string) {
  requirePerm(scope, 'reports.read');
  const fy = await yearOf(db, scope.entityId, fyId);
  const ent = (await db.query(
    `SELECT e.retained_earnings_account_id AS re_id, a.code AS re_code, a.name AS re_name
       FROM entities e LEFT JOIN accounts a ON a.id = e.retained_earnings_account_id WHERE e.id = $1`, [scope.entityId])).rows[0];
  const nets = await db.query(
    `SELECT a.id, a.code, a.name, a.account_type, COALESCE(sum(lp.net), 0) AS net
       FROM ledger_postings lp JOIN accounts a ON a.id = lp.account_id
      WHERE lp.entity_id = $1 AND a.account_type IN ('revenue','expense')
        AND lp.journal_date BETWEEN $2 AND $3 AND lp.journal_type <> 'year_end_close'
      GROUP BY a.id ORDER BY a.code`, [scope.entityId, fy.start_date, fy.end_date]);
  const periods = (await db.query(
    `SELECT id, period_no, name, status FROM accounting_periods WHERE financial_year_id = $1 ORDER BY period_no`, [fyId])).rows;
  const live = (await db.query(
    `SELECT id, status, draft_no, journal_no FROM journal_entries
      WHERE closes_financial_year_id = $1 AND status <> 'rejected' AND reversed_by_journal_id IS NULL`, [fyId])).rows[0] ?? null;

  const lines: { accountId: string; code: string; name: string; debit: string; credit: string }[] = [];
  let profitNet = D(0);                                   // net debit of all P&L accounts (negative = profit)
  for (const r of nets.rows) {
    const n = D(r.net);
    if (n.eq(0)) continue;
    profitNet = profitNet.plus(n);
    lines.push({ accountId: r.id, code: r.code, name: r.name,
      debit: n.lt(0) ? n.neg().toFixed(2) : '0.00', credit: n.gt(0) ? n.toFixed(2) : '0.00' });
  }
  const profit = profitNet.neg();                         // positive = profit for the year
  if (!profitNet.eq(0) && ent.re_id) {
    lines.push({ accountId: ent.re_id, code: ent.re_code, name: ent.re_name,
      debit: profitNet.gt(0) ? profitNet.toFixed(2) : '0.00', credit: profitNet.lt(0) ? profitNet.neg().toFixed(2) : '0.00' });
  }

  const last = periods[periods.length - 1];
  const blockers: { code: string; message: string }[] = [];
  if (fy.is_closed) blockers.push({ code: 'YEAR_ALREADY_CLOSED', message: `${fy.label} is already closed` });
  if (!ent.re_id) blockers.push({ code: 'RETAINED_EARNINGS_NOT_CONFIGURED', message: 'Set the retained earnings account on the entity first' });
  const openEarlier = periods.slice(0, -1).filter((p: any) => p.status !== 'locked');
  if (openEarlier.length) blockers.push({ code: 'EARLIER_PERIODS_OPEN', message: `Lock ${openEarlier.map((p: any) => p.name).join(', ')} before closing the year` });
  if (last && last.status === 'locked' && !live) blockers.push({ code: 'LAST_PERIOD_LOCKED', message: `${last.name} must be open to post the closing journal` });
  if (lines.length === 0) blockers.push({ code: 'NOTHING_TO_CLOSE', message: 'No profit or loss has been posted in this year' });
  const pending = await db.query(
    `SELECT count(*)::int AS n FROM journal_entries j JOIN accounting_periods p ON p.id = j.period_id
      WHERE p.financial_year_id = $1 AND j.status IN ('draft','submitted','approved') AND j.journal_type <> 'year_end_close'`, [fyId]);
  const priorOpen = (await db.query(
    `SELECT label FROM financial_years WHERE entity_id = $1 AND end_date < $2 AND NOT is_closed ORDER BY start_date`,
    [scope.entityId, fy.start_date])).rows.map((r) => r.label);
  if (priorOpen.length) blockers.push({ code: 'PRIOR_YEAR_OPEN', message: `Close FY${priorOpen.join(', FY')} first` });
  if (pending.rows[0].n) blockers.push({ code: 'UNPOSTED_JOURNALS', message: `${pending.rows[0].n} journal(s) in ${fy.label} are not posted or rejected yet` });

  return {
    financialYear: { id: fy.id, label: fy.label, start: fy.start_date, end: fy.end_date, isClosed: fy.is_closed, closedAt: fy.closed_at },
    profitForYear: profit.toFixed(2),
    retainedEarnings: ent.re_id ? { accountId: ent.re_id, code: ent.re_code, name: ent.re_name } : null,
    lines, closingJournal: live, blockers,
    canGenerate: blockers.length === 0 && !live,
    canFinalise: !!live && live.status === 'posted' && !fy.is_closed && openEarlier.length === 0,
  };
}

export async function generateClose(db: Db, scope: EntityScope, actor: Actor, fyId: string) {
  requirePerm(scope, 'year.close');
  const pv = await previewClose(db, scope, fyId);
  if (pv.closingJournal) throw new DomainError('CLOSE_ALREADY_EXISTS', `A closing journal already exists for ${pv.financialYear.label}`);
  if (pv.blockers.length) throw new DomainError('CLOSE_PRECONDITIONS', pv.blockers.map((b) => b.message).join('; '), { blockers: pv.blockers });
  const j = await createDraft(db, scope, actor, {
    journalDate: pv.financialYear.end,
    description: `Year-end close ${pv.financialYear.label}: ${D(pv.profitForYear).gte(0) ? 'profit' : 'loss'} for the year to retained earnings`,
    reference: `CLOSE-${pv.financialYear.label}`,
    lines: pv.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: 'Year-end close' })),
  }, { journalType: 'year_end_close', closesFinancialYearId: fyId });
  return { journal: j, preview: pv };
}

export async function finaliseClose(db: Db, scope: EntityScope, actor: Actor, fyId: string) {
  requirePerm(scope, 'year.close');
  requirePerm(scope, 'periods.lock');
  const pv = await previewClose(db, scope, fyId);
  if (!pv.canFinalise) {
    throw new DomainError('YEAR_NOT_CLOSABLE', pv.financialYear.isClosed ? 'This year is already closed'
      : 'Post the closing journal (approved by someone other than its preparer) and lock earlier periods first');
  }
  return withTx(db, async (tx) => {
    const open = await tx.query(
      `UPDATE accounting_periods SET status = 'locked', locked_at = now(), locked_by = $2
        WHERE financial_year_id = $1 AND status <> 'locked' RETURNING id, name`, [fyId, actor.id]);
    for (const p of open.rows) {
      await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'period.lock', objectType: 'period', objectId: p.id, reason: 'Year-end close' });
    }
    const fy = await tx.query(
      `UPDATE financial_years SET is_closed = true, closed_at = now(), closed_by = $2, closing_journal_id = $3
        WHERE id = $1 RETURNING id, label, closed_at`, [fyId, actor.id, pv.closingJournal!.id]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'year.close', objectType: 'financial_year', objectId: fyId,
      after: { label: fy.rows[0].label, closingJournalId: pv.closingJournal!.id, profitForYear: pv.profitForYear, periodsLocked: open.rowCount } });
    return { ...fy.rows[0], periodsLocked: open.rows.map((p) => p.name), profitForYear: pv.profitForYear };
  });
}
