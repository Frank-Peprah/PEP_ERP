import { Decimal, DomainError } from '@pep/accounting-domain';
import type { Db } from '../lib/db.js';
import { requirePerm, type EntityScope } from '../lib/auth.js';

const BS = ['asset', 'liability', 'equity'];
const D = (v: unknown) => new Decimal((v as string) ?? 0);
const split = (net: Decimal) => ({ debit: net.gt(0) ? net.toFixed(2) : '0.00', credit: net.lt(0) ? net.neg().toFixed(2) : '0.00' });

export async function resolvePeriod(db: Db, entityId: string, periodId?: string) {
  const r = periodId
    ? await db.query(`SELECT p.*, fy.start_date AS fy_start, fy.end_date AS fy_end, fy.label AS fy_label
                        FROM accounting_periods p JOIN financial_years fy ON fy.id = p.financial_year_id
                       WHERE p.id = $1 AND p.entity_id = $2`, [periodId, entityId])
    : await db.query(`SELECT p.*, fy.start_date AS fy_start, fy.end_date AS fy_end, fy.label AS fy_label
                        FROM accounting_periods p JOIN financial_years fy ON fy.id = p.financial_year_id
                       WHERE p.entity_id = $1
                       ORDER BY (CURRENT_DATE BETWEEN p.start_date AND p.end_date) DESC, p.start_date DESC LIMIT 1`, [entityId]);
  if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Period not found');
  return r.rows[0];
}

/**
 * Trial balance derived ONLY from posted journal lines.
 *  basis 'ytd'    : opening = position at FY start; movement = FY start → period end
 *  basis 'period' : opening = position at period start; movement = the period only
 * Income-statement accounts open at zero each financial year. Results of earlier years
 * that have not yet been closed to retained earnings are shown as one explicit,
 * system-computed line so the TB balances without a hidden plug.
 */
/**
 * stage 'post_close' (default): the ledger as posted, including year-end closing journals.
 * stage 'pre_close': excludes closing journals — the year-end TB accountants review before closing.
 */
export async function trialBalance(db: Db, scope: EntityScope, q: { periodId?: string; basis?: 'ytd' | 'period'; includeZero?: boolean; stage?: 'pre_close' | 'post_close' }) {
  requirePerm(scope, 'reports.read');
  const p = await resolvePeriod(db, scope.entityId, q.periodId);
  const basis = q.basis ?? 'ytd';
  const from = basis === 'ytd' ? p.fy_start : p.start_date;
  const r = await db.query(
    `SELECT a.id, a.code, a.name, a.account_type, a.normal_balance, a.statement_line_code, a.is_active, a.is_postable,
            COALESCE(sum(lp.net) FILTER (WHERE lp.journal_date < $3
                     AND (a.account_type IN ('asset','liability','equity') OR lp.journal_date >= $2)), 0) AS opening_net,
            COALESCE(sum(lp.debit)  FILTER (WHERE lp.journal_date BETWEEN $3 AND $4), 0) AS mov_debit,
            COALESCE(sum(lp.credit) FILTER (WHERE lp.journal_date BETWEEN $3 AND $4), 0) AS mov_credit,
            count(lp.line_id) FILTER (WHERE lp.journal_date BETWEEN $3 AND $4)::int AS line_count
       FROM accounts a
       LEFT JOIN ledger_postings lp ON lp.account_id = a.id AND lp.journal_date <= $4
             AND ($5::boolean OR lp.journal_type <> 'year_end_close' OR lp.journal_date < $2)
      WHERE a.entity_id = $1
      GROUP BY a.id ORDER BY a.code`,
    [scope.entityId, p.fy_start, from, p.end_date, (q.stage ?? 'post_close') === 'post_close']);
  const prior = await db.query(
    `SELECT COALESCE(sum(net),0) AS net FROM ledger_postings
      WHERE entity_id = $1 AND account_type IN ('revenue','expense') AND journal_date < $2`, [scope.entityId, p.fy_start]);
  const ent = await db.query(
    `SELECT e.retained_earnings_account_id, a.code, a.name FROM entities e
       LEFT JOIN accounts a ON a.id = e.retained_earnings_account_id WHERE e.id = $1`, [scope.entityId]);

  const exceptions: { code: string; severity: 'blocking' | 'warning'; message: string; accountCode?: string }[] = [];
  const rows = r.rows.map((x) => {
    const opening = D(x.opening_net);
    const closing = opening.plus(x.mov_debit).minus(x.mov_credit);
    if (!closing.eq(0) && !x.statement_line_code) {
      exceptions.push({ code: 'UNMAPPED_ACCOUNT', severity: 'warning', accountCode: x.code,
        message: `${x.code} ${x.name} carries a balance but has no statement mapping` });
    }
    // Abnormal balance: closing sits on the opposite side to the account's normal balance
    // (e.g. credit inventory, overdrawn cash). Contra accounts are configured with the opposite normal side.
    const abnormal = x.normal_balance === 'debit' ? closing.lt(0) : closing.gt(0);
    if (abnormal && x.is_postable) {
      exceptions.push({ code: 'ABNORMAL_BALANCE', severity: 'warning', accountCode: x.code,
        message: `${x.code} ${x.name} has a ${closing.lt(0) ? 'credit' : 'debit'} balance of ${closing.abs().toFixed(2)} against a ${x.normal_balance} normal balance` });
    }
    if (!closing.eq(0) && !x.is_active) {
      exceptions.push({ code: 'INACTIVE_WITH_BALANCE', severity: 'warning', accountCode: x.code, message: `${x.code} is inactive but carries a balance` });
    }
    return {
      accountId: x.id, code: x.code, name: x.name, accountType: x.account_type, normalBalance: x.normal_balance,
      statementLineCode: x.statement_line_code, isPostable: x.is_postable,
      opening: split(opening), movement: { debit: D(x.mov_debit).toFixed(2), credit: D(x.mov_credit).toFixed(2) },
      closing: split(closing), closingNet: closing.toFixed(2), lineCount: x.line_count, synthetic: false,
    };
  }).filter((x) => q.includeZero || x.isPostable && (x.lineCount > 0 || x.closingNet !== '0.00' || x.opening.debit !== '0.00' || x.opening.credit !== '0.00'));

  const priorNet = D(prior.rows[0].net);
  if (!priorNet.eq(0)) {
    const re = ent.rows[0];
    rows.push({
      accountId: re.retained_earnings_account_id ?? null, code: re.code ?? 'RE*', name: `${re.name ?? 'Retained earnings'} — prior-year results not yet closed (system computed)`,
      accountType: 'equity', normalBalance: 'credit', statementLineCode: 'EQ_RETAINED', isPostable: false,
      opening: split(priorNet), movement: { debit: '0.00', credit: '0.00' }, closing: split(priorNet), closingNet: priorNet.toFixed(2),
      lineCount: 0, synthetic: true,
    });
    if (!re.retained_earnings_account_id) {
      exceptions.push({ code: 'RETAINED_EARNINGS_NOT_CONFIGURED', severity: 'blocking', message: 'Set the retained earnings account on the entity before closing the year' });
    } else {
      exceptions.push({ code: 'PRIOR_YEAR_NOT_CLOSED', severity: 'warning', message: `Prior-year result of ${priorNet.neg().toFixed(2)} has not been closed to retained earnings` });
    }
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  const sum = (f: (x: typeof rows[number]) => string) => rows.reduce((t, x) => t.plus(f(x)), new Decimal(0));
  const totals = {
    opening: { debit: sum((x) => x.opening.debit).toFixed(2), credit: sum((x) => x.opening.credit).toFixed(2) },
    movement: { debit: sum((x) => x.movement.debit).toFixed(2), credit: sum((x) => x.movement.credit).toFixed(2) },
    closing: { debit: sum((x) => x.closing.debit).toFixed(2), credit: sum((x) => x.closing.credit).toFixed(2) },
  };
  const balanced = totals.closing.debit === totals.closing.credit && totals.movement.debit === totals.movement.credit;
  if (!balanced) exceptions.unshift({ code: 'TB_OUT_OF_BALANCE', severity: 'blocking', message: 'Trial balance does not balance' });
  return {
    parameters: { entityId: scope.entityId, periodId: p.id, periodName: p.name, financialYear: p.fy_label, basis, from, to: p.end_date,
                  stage: q.stage ?? 'post_close',
                  periodStatus: p.status, currency: 'functional', generatedAt: new Date().toISOString(),
                  source: 'posted journal lines (ledger_postings)' },
    rows, totals, balanced, exceptions,
  };
}

/** Account ledger with running balance in the account's normal direction. */
export async function accountLedger(db: Db, scope: EntityScope, q: { accountId: string; from?: string; to?: string }) {
  requirePerm(scope, 'ledger.read');
  const a = await db.query('SELECT * FROM accounts WHERE id = $1 AND entity_id = $2', [q.accountId, scope.entityId]);
  if (!a.rowCount) throw new DomainError('NOT_FOUND', 'Account not found');
  const acc = a.rows[0];
  const range = await db.query(
    `SELECT COALESCE($2::date, min(start_date)) AS f, COALESCE($3::date, max(end_date)) AS t FROM financial_years WHERE entity_id = $1`,
    [scope.entityId, q.from ?? null, q.to ?? null]);
  const from = range.rows[0].f, to = range.rows[0].t;
  const fy = await db.query(`SELECT start_date FROM financial_years WHERE entity_id = $1 AND $2::date BETWEEN start_date AND end_date`,
    [scope.entityId, from]);
  const fyStart = fy.rows[0]?.start_date ?? from;
  const op = await db.query(
    `SELECT COALESCE(sum(net),0) AS net FROM ledger_postings WHERE account_id = $1 AND journal_date < $2
       AND ($4 OR journal_date >= $3)`, [q.accountId, from, fyStart, BS.includes(acc.account_type)]);
  const lines = await db.query(
    `SELECT line_id, journal_id, journal_no, journal_type, journal_date, reference, journal_description, line_description,
            debit, credit, counterparty, source_document_ref, reverses_journal_id
       FROM ledger_postings WHERE account_id = $1 AND journal_date BETWEEN $2 AND $3
      ORDER BY journal_date, journal_no, line_no`, [q.accountId, from, to]);
  const sign = acc.normal_balance === 'debit' ? 1 : -1;
  let run = D(op.rows[0].net);
  const out = lines.rows.map((l) => {
    run = run.plus(l.debit).minus(l.credit);
    return { ...l, running_balance: run.times(sign).toFixed(2) };
  });
  const totDr = lines.rows.reduce((t, l) => t.plus(l.debit), new Decimal(0));
  const totCr = lines.rows.reduce((t, l) => t.plus(l.credit), new Decimal(0));
  return {
    account: { id: acc.id, code: acc.code, name: acc.name, accountType: acc.account_type, normalBalance: acc.normal_balance },
    parameters: { from, to, generatedAt: new Date().toISOString() },
    opening: D(op.rows[0].net).times(sign).toFixed(2),
    lines: out,
    totals: { debit: totDr.toFixed(2), credit: totCr.toFixed(2) },
    closing: run.times(sign).toFixed(2),
  };
}

/** Dashboard KPIs — derived from the same TB engine, never stored separately. */
export async function summary(db: Db, scope: EntityScope, periodId?: string) {
  const tb = await trialBalance(db, scope, { periodId, basis: 'ytd', stage: 'pre_close' });
  const cash = await db.query(
    `SELECT COALESCE(sum(lp.net),0) AS net FROM ledger_postings lp JOIN accounts a ON a.id = lp.account_id
      WHERE lp.entity_id = $1 AND a.cash_flow_class = 'cash' AND lp.journal_date <= $2`, [scope.entityId, tb.parameters.to]);
  const by = (t: string) => tb.rows.filter((r) => r.accountType === t).reduce((s, r) => s.plus(r.closingNet), new Decimal(0));
  const revenue = by('revenue').neg(), expenses = by('expense');
  const assets = by('asset'), liabilities = by('liability').neg(), equity = by('equity').neg();
  const monthly = await db.query(
    `SELECT to_char(date_trunc('month', journal_date), 'YYYY-MM') AS m,
            COALESCE(-sum(net) FILTER (WHERE account_type='revenue'),0) AS revenue,
            COALESCE(sum(net) FILTER (WHERE account_type='expense'),0) AS expenses
       FROM ledger_postings WHERE entity_id = $1 AND journal_date BETWEEN $2 AND $3 AND journal_type <> 'year_end_close' GROUP BY 1 ORDER BY 1`,
    [scope.entityId, tb.parameters.from, tb.parameters.to]);
  const pending = await db.query(
    `SELECT status, count(*)::int AS n FROM journal_entries WHERE entity_id = $1 AND status IN ('draft','submitted','approved') GROUP BY status`,
    [scope.entityId]);
  return {
    parameters: tb.parameters,
    kpis: {
      revenue: revenue.toFixed(2), expenses: expenses.toFixed(2), netProfit: revenue.minus(expenses).toFixed(2),
      cash: D(cash.rows[0].net).toFixed(2), totalAssets: assets.toFixed(2), totalLiabilities: liabilities.toFixed(2),
      // equity incl. current-year result not yet closed
      totalEquity: equity.plus(revenue.minus(expenses)).toFixed(2),
    },
    monthly: monthly.rows,
    pending: Object.fromEntries(pending.rows.map((r) => [r.status, r.n])),
    tbBalanced: tb.balanced,
    exceptions: tb.exceptions,
  };
}
