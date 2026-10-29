/**
 * Dashboard (screen G01). Every figure is computed on the server from POSTED ledger lines,
 * with an explicit comparison basis per KPI, so the cards can never disagree with the reports.
 */
import { Decimal } from '@pep/accounting-domain';
import type { Db } from '../lib/db.js';
import { requirePerm, type EntityScope } from '../lib/auth.js';
import { resolvePeriod } from './reports.js';

const D = (v: unknown) => new Decimal((v as string) ?? 0);
const s2 = (d: Decimal) => d.toFixed(2);
const shiftYear = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();          // clamp 29 Feb
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const pct = (cur: Decimal, prev: Decimal) => (prev.eq(0) ? null : cur.minus(prev).div(prev.abs()).times(100).toDecimalPlaces(1).toFixed(1));

async function pl(db: Db, entityId: string, from: string, to: string) {
  const r = await db.query(
    `SELECT COALESCE(-sum(net) FILTER (WHERE account_type = 'revenue'), 0) AS revenue,
            COALESCE(sum(net) FILTER (WHERE account_type = 'expense'), 0) AS expenses
       FROM ledger_postings WHERE entity_id = $1 AND journal_date BETWEEN $2 AND $3`, [entityId, from, to]);
  return { revenue: D(r.rows[0].revenue), expenses: D(r.rows[0].expenses) };
}

async function cashAt(db: Db, entityId: string, date: string) {
  const r = await db.query(
    `SELECT COALESCE(sum(lp.net), 0) AS net FROM ledger_postings lp JOIN accounts a ON a.id = lp.account_id
      WHERE lp.entity_id = $1 AND a.cash_flow_class = 'cash' AND lp.journal_date <= $2`, [entityId, date]);
  return D(r.rows[0].net);
}

export async function dashboard(db: Db, scope: EntityScope, periodId?: string) {
  requirePerm(scope, 'reports.read');
  const p = await resolvePeriod(db, scope.entityId, periodId);
  const from: string = p.fy_start, to: string = p.end_date;
  const pFrom = shiftYear(from, -1), pTo = shiftYear(to, -1);
  const prevMonthEnd = (await db.query(`SELECT ($1::date - interval '1 day')::date::text AS d`, [p.start_date])).rows[0].d as string;

  const [cur, prev, cash, cashPrev] = await Promise.all([
    pl(db, scope.entityId, from, to), pl(db, scope.entityId, pFrom, pTo), cashAt(db, scope.entityId, to), cashAt(db, scope.entityId, prevMonthEnd)]);
  const hasPrior = (await db.query(`SELECT 1 FROM financial_years WHERE entity_id = $1 AND start_date <= $2 AND end_date >= $2`, [scope.entityId, pFrom])).rowCount! > 0;

  // Financial position at period end; equity includes all profit to date (presentational close).
  const pos = await db.query(
    `SELECT account_type, COALESCE(sum(net), 0) AS net FROM ledger_postings WHERE entity_id = $1 AND journal_date <= $2 GROUP BY account_type`,
    [scope.entityId, to]);
  const by = (t: string) => D(pos.rows.find((r) => r.account_type === t)?.net ?? 0);
  const assets = by('asset'), liabilities = by('liability').neg();
  const equity = by('equity').neg().minus(by('revenue')).minus(by('expense'));

  // Twelve months of the financial year, zero-filled, so the chart never skips a month.
  const months = await db.query(
    `SELECT to_char(m, 'YYYY-MM') AS month,
            COALESCE((SELECT -sum(net) FROM ledger_postings WHERE entity_id = $1 AND account_type = 'revenue' AND date_trunc('month', journal_date) = m), 0) AS revenue,
            COALESCE((SELECT sum(net) FROM ledger_postings WHERE entity_id = $1 AND account_type = 'expense' AND date_trunc('month', journal_date) = m), 0) AS expenses
       FROM generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month') m ORDER BY m`,
    [scope.entityId, from, p.fy_end]);
  const monthly = months.rows.map((r) => ({
    month: r.month, revenue: s2(D(r.revenue)), expenses: s2(D(r.expenses)), netProfit: s2(D(r.revenue).minus(D(r.expenses))),
    inFuture: r.month > to.slice(0, 7),
  }));

  // Work waiting, each row a deep link the interface can open.
  const [j, runs, periods, unmapped] = await Promise.all([
    db.query(`SELECT status, count(*)::int AS n FROM journal_entries WHERE entity_id = $1 AND status IN ('draft','submitted','approved') GROUP BY status`, [scope.entityId]),
    db.query(`SELECT status, count(*)::int AS n FROM financial_statement_runs WHERE entity_id = $1 AND status IN ('under_review','approved') GROUP BY status`, [scope.entityId]),
    db.query(`SELECT count(*) FILTER (WHERE status = 'locked')::int AS locked, count(*)::int AS total,
                     count(*) FILTER (WHERE status = 'open' AND end_date < CURRENT_DATE)::int AS overdue
                FROM accounting_periods WHERE financial_year_id = $1`, [p.financial_year_id]),
    db.query(`SELECT count(*)::int AS n FROM accounts a WHERE a.entity_id = $1 AND a.is_postable AND a.statement_line_code IS NULL
                AND EXISTS (SELECT 1 FROM ledger_postings lp WHERE lp.account_id = a.id)`, [scope.entityId]),
  ]);
  const jn = (s: string) => j.rows.find((r) => r.status === s)?.n ?? 0;
  const rn = (s: string) => runs.rows.find((r) => r.status === s)?.n ?? 0;
  const tasks = [
    { key: 'journals_submitted', count: jn('submitted'), label: 'journals awaiting approval', to: 'journals?status=submitted', permission: 'journal.approve' },
    { key: 'journals_approved', count: jn('approved'), label: 'approved journals ready to post', to: 'journals?status=approved', permission: 'journal.post' },
    { key: 'journals_draft', count: jn('draft'), label: 'draft journals in progress', to: 'journals?status=draft', permission: 'journal.prepare' },
    { key: 'runs_review', count: rn('under_review'), label: 'statement runs awaiting approval', to: 'statements', permission: 'statements.approve' },
    { key: 'runs_approved', count: rn('approved'), label: 'approved statement runs to finalise', to: 'statements', permission: 'statements.finalize' },
    { key: 'periods_overdue', count: periods.rows[0].overdue, label: 'past periods still open', to: 'periods', permission: 'periods.lock' },
    { key: 'accounts_unmapped', count: unmapped.rows[0].n, label: 'accounts with activity but no statement line', to: 'accounts?filter=unmapped', permission: 'coa.manage' },
  ].filter((t) => t.count > 0 && scope.permissions.has(t.permission));

  const latestRun = (await db.query(
    `SELECT id, run_no, period_end, status, blocking_count FROM financial_statement_runs WHERE entity_id = $1 ORDER BY run_no DESC LIMIT 1`, [scope.entityId])).rows[0] ?? null;
  const tbCheck = (await db.query(
    `SELECT COALESCE(sum(debit), 0) AS dr, COALESCE(sum(credit), 0) AS cr FROM ledger_postings WHERE entity_id = $1 AND journal_date <= $2`, [scope.entityId, to])).rows[0];
  let auditChain: { intact: boolean } | null = null;
  if (scope.permissions.has('audit.read')) auditChain = { intact: (await db.query('SELECT verify_audit_chain() AS b')).rows[0].b === null };

  const net = cur.revenue.minus(cur.expenses), netPrev = prev.revenue.minus(prev.expenses);
  return {
    parameters: { periodId: p.id, periodName: p.name, periodStatus: p.status, financialYear: p.fy_label, from, to,
                  comparativeFrom: pFrom, comparativeTo: pTo, hasPriorYear: hasPrior, prevMonthEnd, generatedAt: new Date().toISOString(),
                  source: 'Posted journal lines only' },
    kpis: {
      revenue: { value: s2(cur.revenue), comparative: s2(prev.revenue), changePct: hasPrior ? pct(cur.revenue, prev.revenue) : null, basis: 'same period last year' },
      expenses: { value: s2(cur.expenses), comparative: s2(prev.expenses), changePct: hasPrior ? pct(cur.expenses, prev.expenses) : null, basis: 'same period last year' },
      netProfit: { value: s2(net), comparative: s2(netPrev), changePct: hasPrior ? pct(net, netPrev) : null, basis: 'same period last year' },
      cash: { value: s2(cash), comparative: s2(cashPrev), changePct: pct(cash, cashPrev), basis: 'end of last month' },
    },
    position: { assets: s2(assets), liabilities: s2(liabilities), equity: s2(equity), asAt: to,
                balances: assets.eq(liabilities.plus(equity)) },
    monthly,
    tasks,
    close: { locked: periods.rows[0].locked, total: periods.rows[0].total },
    latestRun,
    trialBalance: { balanced: D(tbCheck.dr).eq(D(tbCheck.cr)), debit: s2(D(tbCheck.dr)) },
    auditChain,
  };
}
