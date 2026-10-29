/**
 * Blueprint Phase 1 — recurring journals. A template holds balanced lines, a frequency and a date range;
 * "generate" creates one DRAFT journal per due run date (idempotent per template and date) that then goes
 * through the normal approval workflow. Templates are paused or ended, never deleted (audit trail).
 */
import { DomainError, normaliseLines, type JournalLineInput } from '@pep/accounting-domain';
import { audit, withTx, type Db } from '../lib/db.js';
import { requirePerm, type Actor, type EntityScope } from '../lib/auth.js';
import { createDraftTx, validateAccounts } from './journals.js';

const STEP = { monthly: 1, quarterly: 3, semiannually: 6, annually: 12 } as const;
type Frequency = keyof typeof STEP;
const TYPES = new Set(['manual', 'accrual', 'prepayment', 'recurring']);
const MAX_RUNS_PER_GENERATE = 36;            // catch-up guard: three years of monthly runs

export interface RecurringInput {
  name: string;
  description: string;
  reference?: string | null;
  journalType?: string;
  isAdjustment?: boolean;
  autoReverse?: boolean;
  frequency?: Frequency;
  monthEnd?: boolean;
  startDate: string;
  endDate?: string | null;
  lines: JournalLineInput[];
  expectedVersion?: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Date of run k (0-based): start + k·step months; day clamped to month end, or the month end itself. */
export function runDate(start: string, frequency: Frequency, monthEnd: boolean, k: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const total = (m - 1) + STEP[frequency] * k;
  const yy = y + Math.floor(total / 12), mm = total % 12;
  const day = monthEnd ? lastDay(yy, mm) : Math.min(d, lastDay(yy, mm));
  return `${yy}-${pad(mm + 1)}-${pad(day)}`;
}

function validateShape(input: RecurringInput, functionalCurrency: string) {
  if (!input.name?.trim()) throw new DomainError('NAME_REQUIRED', 'Give the recurring journal a name');
  if (!input.description?.trim()) throw new DomainError('DESCRIPTION_REQUIRED', 'Description is required');
  if (!ISO.test(input.startDate ?? '')) throw new DomainError('INVALID_DATE', 'Start date must be YYYY-MM-DD');
  if (input.endDate && (!ISO.test(input.endDate) || input.endDate < input.startDate)) {
    throw new DomainError('INVALID_DATE', 'End date must be on or after the start date');
  }
  const frequency = (input.frequency ?? 'monthly') as Frequency;
  if (!(frequency in STEP)) throw new DomainError('INVALID_FREQUENCY', 'Frequency must be monthly, quarterly, semiannually or annually');
  const type = input.journalType ?? 'recurring';
  if (!TYPES.has(type)) throw new DomainError('INVALID_JOURNAL_TYPE', `Recurring journals can be of type ${[...TYPES].join(', ')}`);
  // Templates are in the functional currency and must balance now, not at first run.
  const { lines } = normaliseLines(input.lines, { txnCurrency: functionalCurrency, functionalCurrency, fxRate: 1 }, { requireBalance: true });
  const stored = lines.map((l) => ({ accountId: l.accountId, description: l.description,
    debit: l.debit.gt(0) ? l.debit.toFixed(2) : null, credit: l.credit.gt(0) ? l.credit.toFixed(2) : null }));
  return { frequency, type, stored };
}

const COLS = `r.id, r.name, r.description, r.reference, r.journal_type, r.is_adjustment, r.auto_reverse, r.frequency, r.month_end,
  r.start_date, r.end_date, r.runs_generated, r.next_run_date, r.status, r.lines, r.version, r.created_at,
  u.full_name AS created_by_name,
  (SELECT sum((l->>'debit')::numeric) FROM jsonb_array_elements(r.lines) l)::numeric(20,2) AS amount,
  (SELECT json_build_object('id', j.id, 'draft_no', j.draft_no, 'journal_no', j.journal_no, 'status', j.status, 'date', j.journal_date)
     FROM journal_entries j WHERE j.recurring_journal_id = r.id ORDER BY j.recurring_run_date DESC LIMIT 1) AS last_journal`;

export async function listRecurring(db: Db, scope: EntityScope) {
  requirePerm(scope, 'journal.read');
  const r = await db.query(
    `SELECT ${COLS} FROM recurring_journals r JOIN users u ON u.id = r.created_by
      WHERE r.entity_id = $1 ORDER BY r.status, r.next_run_date NULLS LAST, r.name`, [scope.entityId]);
  return r.rows;
}

async function functionalCurrency(db: Db, entityId: string) {
  return (await db.query('SELECT functional_currency FROM entities WHERE id = $1', [entityId])).rows[0].functional_currency as string;
}

export async function createRecurring(db: Db, scope: EntityScope, actor: Actor, input: RecurringInput) {
  requirePerm(scope, 'journal.prepare');
  const { frequency, type, stored } = validateShape(input, await functionalCurrency(db, scope.entityId));
  return withTx(db, async (tx) => {
    await validateAccounts(tx, scope.entityId, stored.map((l) => l.accountId), input.startDate);
    const dup = await tx.query('SELECT 1 FROM recurring_journals WHERE entity_id = $1 AND lower(name) = lower($2)', [scope.entityId, input.name.trim()]);
    if (dup.rowCount) throw new DomainError('NAME_TAKEN', `A recurring journal called "${input.name.trim()}" already exists`);
    const r = await tx.query(
      `INSERT INTO recurring_journals (entity_id, name, description, reference, journal_type, is_adjustment, auto_reverse,
                                       frequency, month_end, start_date, end_date, next_run_date, lines, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$12,$13) RETURNING id`,
      [scope.entityId, input.name.trim(), input.description.trim(), input.reference ?? null, type,
       input.isAdjustment ?? (type === 'accrual' || type === 'prepayment'), !!input.autoReverse, frequency, !!input.monthEnd,
       input.monthEnd ? runDate(input.startDate, frequency, true, 0) : input.startDate, input.endDate ?? null,
       JSON.stringify(stored), actor.id]);
    const id = r.rows[0].id;
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'recurring.create', objectType: 'recurring_journal', objectId: id,
      after: { name: input.name.trim(), frequency, start: input.startDate, end: input.endDate ?? null, lines: stored.length } });
    return (await tx.query(`SELECT ${COLS} FROM recurring_journals r JOIN users u ON u.id = r.created_by WHERE r.id = $1`, [id])).rows[0];
  });
}

/** Pause, resume or end a template. Ending is final. */
export async function setRecurringStatus(db: Db, scope: EntityScope, actor: Actor, id: string, status: 'active' | 'paused' | 'ended') {
  requirePerm(scope, 'journal.prepare');
  if (!['active', 'paused', 'ended'].includes(status)) throw new DomainError('INVALID_STATUS', 'Status must be active, paused or ended');
  return withTx(db, async (tx) => {
    const cur = await tx.query('SELECT * FROM recurring_journals WHERE entity_id = $1 AND id = $2 FOR UPDATE', [scope.entityId, id]);
    if (!cur.rowCount) throw new DomainError('NOT_FOUND', 'Recurring journal not found');
    const t = cur.rows[0];
    if (t.status === 'ended') throw new DomainError('RECURRING_ENDED', 'This recurring journal has ended; create a new one');
    await tx.query(
      `UPDATE recurring_journals SET status = $2::recurring_status, next_run_date = CASE WHEN $2::recurring_status = 'ended' THEN NULL ELSE next_run_date END,
              updated_at = now(), version = version + 1 WHERE id = $1`, [id, status]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: `recurring.${status === 'active' ? 'resume' : status === 'paused' ? 'pause' : 'end'}`,
      objectType: 'recurring_journal', objectId: id, before: { status: t.status }, after: { status } });
    return { id, status };
  });
}

/** First day after the accounting period containing `date` (where an accrual reverses). */
async function dayAfterPeriod(tx: any, entityId: string, date: string): Promise<string | null> {
  const r = await tx.query(
    `SELECT (end_date + 1)::text AS d FROM accounting_periods WHERE entity_id = $1 AND $2::date BETWEEN start_date AND end_date`, [entityId, date]);
  return r.rows[0]?.d ?? null;
}

/**
 * Create draft journals for every run due on or before `asOf` (default today). Each run is its own
 * transaction: a failure (no period, inactive account) stops that template and is reported; others continue.
 */
export async function generateDue(db: Db, scope: EntityScope, actor: Actor, asOf?: string) {
  requirePerm(scope, 'journal.prepare');
  const until = asOf ?? new Date().toISOString().slice(0, 10);
  if (!ISO.test(until)) throw new DomainError('INVALID_DATE', 'asOf must be YYYY-MM-DD');
  const due = await db.query(
    `SELECT id FROM recurring_journals WHERE entity_id = $1 AND status = 'active' AND next_run_date <= $2 ORDER BY next_run_date, name`,
    [scope.entityId, until]);
  const created: any[] = [];
  const skipped: { recurringJournalId: string; name: string; runDate: string; code: string; message: string }[] = [];
  for (const { id } of due.rows) {
    for (let n = 0; n < MAX_RUNS_PER_GENERATE; n++) {
      try {
        const out = await withTx(db, async (tx) => {
          const t = (await tx.query('SELECT * FROM recurring_journals WHERE id = $1 FOR UPDATE', [id])).rows[0];
          if (t.status !== 'active' || !t.next_run_date || t.next_run_date > until) return null;
          const date: string = t.next_run_date;
          const reverseOn = t.auto_reverse ? await dayAfterPeriod(tx, scope.entityId, date) : null;
          const j = await createDraftTx(tx, scope, actor, {
            journalDate: date, description: t.description, reference: t.reference, journalType: t.journal_type,
            isAdjustment: t.is_adjustment, autoReverseDate: reverseOn, lines: t.lines,
          }, { recurringJournalId: t.id, recurringRunDate: date });
          const k = t.runs_generated + 1;
          const next = runDate(t.start_date, t.frequency, t.month_end, k);
          const ended = t.end_date && next > t.end_date;
          await tx.query(
            `UPDATE recurring_journals SET runs_generated = $2, next_run_date = $3, status = $4, updated_at = now(), version = version + 1
              WHERE id = $1`, [id, k, ended ? null : next, ended ? 'ended' : 'active']);
          await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'recurring.generate', objectType: 'recurring_journal', objectId: id,
            after: { run_date: date, journal_id: j.id, draft_no: j.draft_no, next: ended ? null : next } });
          return { recurringJournalId: id, name: t.name, runDate: date, journalId: j.id, draftNo: j.draft_no,
                   autoReverseDate: reverseOn, totals: j.totals };
        });
        if (!out) break;
        created.push(out);
      } catch (e: any) {
        const t = (await db.query('SELECT name, next_run_date FROM recurring_journals WHERE id = $1', [id])).rows[0];
        skipped.push({ recurringJournalId: id, name: t.name, runDate: t.next_run_date, code: e.code ?? 'ERROR', message: e.message });
        break;
      }
    }
  }
  return { asOf: until, created, skipped };
}
