/**
 * @pep/accounting-domain — pure, framework-free accounting rules.
 * No I/O. Every monetary value is a Decimal; binary floats never touch money.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export { Decimal };

/** ISO-4217 minor units. Extend via configuration, never guess. */
export const CURRENCY_PRECISION: Record<string, number> = {
  GHS: 2, USD: 2, EUR: 2, GBP: 2, NGN: 2, XOF: 0, CNY: 2, ZAR: 2, KES: 2,
};

export class DomainError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function precisionOf(currency: string): number {
  const p = CURRENCY_PRECISION[currency];
  if (p === undefined) throw new DomainError('UNSUPPORTED_CURRENCY', `Currency ${currency} is not configured`);
  return p;
}

/**
 * Parse a user-supplied amount. Accepts strings (preferred) or finite numbers.
 * Rejects negatives, non-numerics and amounts finer than the currency precision —
 * the system never silently rounds an amount a user typed.
 */
export function parseAmount(raw: unknown, currency: string, field = 'amount'): Decimal {
  if (raw === null || raw === undefined || raw === '') return new Decimal(0);
  if (typeof raw === 'number' && !Number.isFinite(raw)) throw new DomainError('INVALID_AMOUNT', `${field} is not finite`);
  const s = typeof raw === 'number' ? raw.toString() : String(raw).replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new DomainError('INVALID_AMOUNT', `${field} must be a non-negative number, got "${raw}"`);
  const d = new Decimal(s);
  if (d.decimalPlaces() > precisionOf(currency)) {
    throw new DomainError('AMOUNT_PRECISION', `${field} ${s} exceeds ${precisionOf(currency)} decimal places for ${currency}`);
  }
  if (d.greaterThan('999999999999999999.99')) throw new DomainError('INVALID_AMOUNT', `${field} exceeds maximum`);
  return d;
}

/** Translate a transaction-currency amount to functional currency, banker's rounding. */
export function toFunctional(amount: Decimal, fxRate: Decimal, functionalCurrency: string): Decimal {
  return amount.times(fxRate).toDecimalPlaces(precisionOf(functionalCurrency), Decimal.ROUND_HALF_EVEN);
}

export interface JournalLineInput {
  accountId: string;
  description?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
  counterparty?: string | null;
  dimensions?: Record<string, string>;
  sourceDocumentRef?: string | null;
}

export interface NormalisedLine {
  lineNo: number;
  accountId: string;
  description: string | null;
  txnDebit: Decimal;
  txnCredit: Decimal;
  debit: Decimal;
  credit: Decimal;
  counterparty: string | null;
  dimensions: Record<string, string>;
  sourceDocumentRef: string | null;
}

export interface JournalTotals {
  txnDebit: Decimal; txnCredit: Decimal; debit: Decimal; credit: Decimal;
  balanced: boolean;
}

/**
 * Validate and normalise journal lines.
 *  - each line: exactly one side positive, non-negative, at currency precision
 *  - at least two lines
 *  - balanced in transaction currency AND, after translation, in functional currency.
 * An FX rounding difference is NOT auto-absorbed: the preparer must add an explicit
 * FX rounding line (a judgement call the system must not make silently).
 */
export function normaliseLines(
  lines: JournalLineInput[],
  opts: { txnCurrency: string; functionalCurrency: string; fxRate: string | number },
  { requireBalance = true }: { requireBalance?: boolean } = {},
): { lines: NormalisedLine[]; totals: JournalTotals } {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new DomainError('JOURNAL_NEEDS_TWO_LINES', 'A journal needs at least two lines');
  }
  const rate = new Decimal(String(opts.fxRate));
  if (!rate.isFinite() || rate.lte(0)) throw new DomainError('INVALID_FX_RATE', 'FX rate must be positive');
  if (opts.txnCurrency === opts.functionalCurrency && !rate.eq(1)) {
    throw new DomainError('INVALID_FX_RATE', 'FX rate must be 1 when transaction currency equals functional currency');
  }
  const out: NormalisedLine[] = lines.map((l, i) => {
    const n = i + 1;
    if (!l.accountId) throw new DomainError('LINE_ACCOUNT_REQUIRED', `Line ${n}: account is required`);
    const td = parseAmount(l.debit, opts.txnCurrency, `Line ${n} debit`);
    const tc = parseAmount(l.credit, opts.txnCurrency, `Line ${n} credit`);
    if (td.gt(0) && tc.gt(0)) throw new DomainError('LINE_BOTH_SIDES', `Line ${n}: a line cannot carry both a debit and a credit`);
    if (td.eq(0) && tc.eq(0)) throw new DomainError('LINE_ZERO', `Line ${n}: enter a debit or a credit`);
    return {
      lineNo: n,
      accountId: l.accountId,
      description: l.description?.trim() || null,
      txnDebit: td,
      txnCredit: tc,
      debit: toFunctional(td, rate, opts.functionalCurrency),
      credit: toFunctional(tc, rate, opts.functionalCurrency),
      counterparty: l.counterparty?.trim() || null,
      dimensions: l.dimensions ?? {},
      sourceDocumentRef: l.sourceDocumentRef?.trim() || null,
    };
  });
  const sum = (k: 'txnDebit' | 'txnCredit' | 'debit' | 'credit') =>
    out.reduce((a, l) => a.plus(l[k]), new Decimal(0));
  const totals = {
    txnDebit: sum('txnDebit'), txnCredit: sum('txnCredit'), debit: sum('debit'), credit: sum('credit'),
    balanced: false,
  };
  totals.balanced = totals.txnDebit.eq(totals.txnCredit) && totals.debit.eq(totals.credit);
  if (requireBalance) assertBalanced(totals, opts.txnCurrency, opts.functionalCurrency);
  return { lines: out, totals };
}

export function assertBalanced(t: JournalTotals, txnCcy: string, fnCcy: string) {
  if (!t.txnDebit.eq(t.txnCredit)) {
    throw new DomainError('JOURNAL_UNBALANCED',
      `Debits ${txnCcy} ${t.txnDebit.toFixed(2)} ≠ credits ${txnCcy} ${t.txnCredit.toFixed(2)} (difference ${t.txnDebit.minus(t.txnCredit).abs().toFixed(2)})`);
  }
  if (!t.debit.eq(t.credit)) {
    throw new DomainError('FX_ROUNDING_DIFFERENCE',
      `Balanced in ${txnCcy} but translation leaves a ${fnCcy} ${t.debit.minus(t.credit).abs().toFixed(2)} rounding difference. Add an explicit FX rounding line.`);
  }
}

/** Swap sides of every line to build a reversal. Functional amounts copied exactly, never re-translated. */
export function reverseLines<T extends { debit: string; credit: string; txn_debit: string; txn_credit: string }>(lines: T[]) {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, txn_debit: l.txn_credit, txn_credit: l.txn_debit }));
}

// ───────────────────────────── Journal workflow ─────────────────────────────
export type JournalStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'rejected';
export type WorkflowAction = 'submit' | 'return' | 'approve' | 'post' | 'reject';

const TRANSITIONS: Record<WorkflowAction, { from: JournalStatus[]; to: JournalStatus; permission: string }> = {
  submit:  { from: ['draft'],                         to: 'submitted', permission: 'journal.prepare' },
  return:  { from: ['submitted', 'approved'],         to: 'draft',     permission: 'journal.approve' },
  approve: { from: ['submitted'],                     to: 'approved',  permission: 'journal.approve' },
  post:    { from: ['approved'],                      to: 'posted',    permission: 'journal.post' },
  reject:  { from: ['draft', 'submitted', 'approved'], to: 'rejected', permission: 'journal.approve' },
};

export function planTransition(
  action: WorkflowAction,
  j: { status: JournalStatus; preparedBy: string },
  actor: { id: string; permissions: Set<string> },
  entity: { segregationEnabled: boolean },
): JournalStatus {
  const t = TRANSITIONS[action];
  if (!t) throw new DomainError('UNKNOWN_ACTION', `Unknown action ${action}`);
  if (!t.from.includes(j.status)) {
    throw new DomainError('INVALID_STATUS_TRANSITION', `Cannot ${action} a journal that is ${j.status}`);
  }
  // A preparer may withdraw (reject) their own draft without approval rights.
  const ownDraftWithdraw = action === 'reject' && j.status === 'draft' && j.preparedBy === actor.id;
  if (!ownDraftWithdraw && !actor.permissions.has(t.permission)) {
    throw new DomainError('FORBIDDEN', `Missing permission ${t.permission}`);
  }
  if (entity.segregationEnabled && j.preparedBy === actor.id && (action === 'approve' || action === 'post')) {
    throw new DomainError('SEGREGATION_OF_DUTIES', `The preparer cannot ${action} their own journal`);
  }
  return t.to;
}

/** Signed balance in the account's normal direction (positive = normal). */
export function normalBalance(debit: Decimal, credit: Decimal, normal: 'debit' | 'credit'): Decimal {
  return normal === 'debit' ? debit.minus(credit) : credit.minus(debit);
}
