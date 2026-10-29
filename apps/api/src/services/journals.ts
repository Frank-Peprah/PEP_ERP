import { createHash } from 'node:crypto';
import {
  Decimal, DomainError, normaliseLines, planTransition, reverseLines,
  type JournalLineInput, type WorkflowAction, type JournalStatus,
} from '@pep/accounting-domain';
import { audit, withTx, type Db, type Tx } from '../lib/db.js';
import type { Actor, EntityScope } from '../lib/auth.js';
import { requirePerm } from '../lib/auth.js';

export interface JournalInput {
  journalDate: string;
  description: string;
  reference?: string | null;
  journalType?: string;
  /** Adjusting entry (shown in the Adjustments column of the adjusted trial balance). Default: by type. */
  isAdjustment?: boolean;
  /** Post the reversal automatically on this date when the journal is posted (accruals). */
  autoReverseDate?: string | null;
  currency?: string;
  fxRate?: string | number;
  lines: JournalLineInput[];
  idempotencyKey?: string | null;
  expectedVersion?: number;
}

const ALLOWED_TYPES = new Set(['manual', 'opening_balance', 'accrual', 'prepayment', 'recurring', 'fx_revaluation', 'tax_adjustment', 'correction']);
/** Types that are adjusting entries unless the preparer says otherwise. */
const ADJUSTING_TYPES = new Set(['accrual', 'prepayment', 'fx_revaluation', 'tax_adjustment', 'correction']);
const adjusting = (type: string, flag?: boolean) => type !== 'opening_balance' && type !== 'year_end_close' && (typeof flag === 'boolean' ? flag : ADJUSTING_TYPES.has(type));

async function entityRow(tx: Tx | Db, entityId: string) {
  const r = await tx.query('SELECT id, functional_currency, segregation_enabled FROM entities WHERE id = $1', [entityId]);
  if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Entity not found');
  return r.rows[0] as { id: string; functional_currency: string; segregation_enabled: boolean };
}

async function periodFor(tx: Tx, entityId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new DomainError('INVALID_DATE', 'journalDate must be YYYY-MM-DD');
  const r = await tx.query(
    `SELECT p.*, fy.label AS fy_label FROM accounting_periods p JOIN financial_years fy ON fy.id = p.financial_year_id
      WHERE p.entity_id = $1 AND $2::date BETWEEN p.start_date AND p.end_date`, [entityId, date]);
  if (!r.rowCount) throw new DomainError('NO_PERIOD', `No accounting period covers ${date}`);
  return r.rows[0];
}

export async function validateAccounts(tx: Tx, entityId: string, ids: string[], date: string) {
  const r = await tx.query(
    `SELECT id, code, is_active, is_postable, effective_from, effective_to FROM accounts
      WHERE entity_id = $1 AND id = ANY($2::uuid[])`, [entityId, ids]);
  const found = new Map(r.rows.map((a) => [a.id, a]));
  ids.forEach((id, i) => {
    const a = found.get(id);
    if (!a) throw new DomainError('INVALID_ACCOUNT', `Line ${i + 1}: account not found in this entity`);
    if (!a.is_active) throw new DomainError('INACTIVE_ACCOUNT', `Line ${i + 1}: account ${a.code} is inactive`);
    if (!a.is_postable) throw new DomainError('HEADER_ACCOUNT', `Line ${i + 1}: ${a.code} is a header account and cannot be posted to`);
    if (date < a.effective_from || (a.effective_to && date > a.effective_to)) {
      throw new DomainError('ACCOUNT_NOT_EFFECTIVE', `Line ${i + 1}: account ${a.code} is not effective on ${date}`);
    }
  });
}

function payloadHash(input: JournalInput) {
  return createHash('sha256').update(JSON.stringify({ ...input, idempotencyKey: undefined, expectedVersion: undefined })).digest('hex');
}

async function writeLines(tx: Tx, journalId: string, lines: ReturnType<typeof normaliseLines>['lines']) {
  for (const l of lines) {
    await tx.query(
      `INSERT INTO journal_lines (journal_id, line_no, account_id, description, txn_debit, txn_credit, debit, credit,
                                  counterparty, dimension_values, source_document_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [journalId, l.lineNo, l.accountId, l.description, l.txnDebit.toFixed(2), l.txnCredit.toFixed(2),
       l.debit.toFixed(2), l.credit.toFixed(2), l.counterparty, JSON.stringify(l.dimensions), l.sourceDocumentRef],
    );
  }
}

export async function getJournal(db: Db | Tx, entityId: string, id: string) {
  const j = await db.query(
    `SELECT j.*, p.name AS period_name, p.status AS period_status,
            up.full_name AS prepared_by_name, ua.full_name AS approved_by_name, upo.full_name AS posted_by_name,
            o.journal_no AS reverses_journal_no, rv.journal_no AS reversed_by_journal_no, rv.status AS reversed_by_status
       FROM journal_entries j
       JOIN accounting_periods p ON p.id = j.period_id
       JOIN users up ON up.id = j.prepared_by
       LEFT JOIN users ua ON ua.id = j.approved_by
       LEFT JOIN users upo ON upo.id = j.posted_by
       LEFT JOIN journal_entries o ON o.id = j.reverses_journal_id
       LEFT JOIN journal_entries rv ON rv.id = j.reversed_by_journal_id
      WHERE j.entity_id = $1 AND j.id = $2`, [entityId, id]);
  if (!j.rowCount) throw new DomainError('NOT_FOUND', 'Journal not found');
  const lines = await db.query(
    `SELECT l.*, a.code AS account_code, a.name AS account_name FROM journal_lines l
       JOIN accounts a ON a.id = l.account_id WHERE l.journal_id = $1 ORDER BY l.line_no`, [id]);
  const totals = lines.rows.reduce(
    (t, l) => ({ debit: t.debit.plus(l.debit), credit: t.credit.plus(l.credit) }),
    { debit: new Decimal(0), credit: new Decimal(0) });
  return {
    ...j.rows[0],
    lines: lines.rows,
    totals: { debit: totals.debit.toFixed(2), credit: totals.credit.toFixed(2), balanced: totals.debit.eq(totals.credit) && totals.debit.gt(0) },
  };
}

export async function listJournals(db: Db, entityId: string, q: { status?: string; limit?: number }) {
  const params: unknown[] = [entityId];
  let where = 'j.entity_id = $1';
  if (q.status) { params.push(q.status); where += ` AND j.status = $${params.length}`; }
  params.push(Math.min(q.limit ?? 200, 1000));
  const r = await db.query(
    `SELECT j.id, j.draft_no, j.journal_no, j.journal_type, j.is_adjustment, j.journal_date, j.description, j.reference, j.status,
            j.currency, j.version, up.full_name AS prepared_by_name, j.prepared_by, j.reverses_journal_id, j.reversed_by_journal_id,
            COALESCE((SELECT sum(debit) FROM journal_lines WHERE journal_id = j.id),0)::numeric(20,2) AS total_debit,
            COALESCE((SELECT sum(credit) FROM journal_lines WHERE journal_id = j.id),0)::numeric(20,2) AS total_credit
       FROM journal_entries j JOIN users up ON up.id = j.prepared_by
      WHERE ${where} ORDER BY j.journal_date DESC, j.draft_no DESC LIMIT $${params.length}`, params);
  return r.rows;
}

/** Create a draft. Drafts may be unbalanced (work in progress); submission enforces balance. */
/** internal: system-generated journals (year-end close) that manual entry may not create. */
export type InternalDraft =
  | { journalType: 'year_end_close'; closesFinancialYearId: string }
  | { recurringJournalId: string; recurringRunDate: string };

export async function createDraft(db: Db, scope: EntityScope, actor: Actor, input: JournalInput, internal?: InternalDraft) {
  requirePerm(scope, 'journal.prepare');
  return withTx(db, (tx) => createDraftTx(tx, scope, actor, input, internal));
}

/** Create a draft inside the caller's transaction. */
export async function createDraftTx(tx: Tx, scope: EntityScope, actor: Actor, input: JournalInput, internal?: InternalDraft) {
  requirePerm(scope, 'journal.prepare');
  {
    const ent = await entityRow(tx, scope.entityId);
    const hash = payloadHash(input);
    if (input.idempotencyKey) {
      const ex = await tx.query(
        `SELECT j.id, a.after->>'payload_hash' AS hash FROM journal_entries j
           LEFT JOIN audit_events a ON a.object_id = j.id::text AND a.action = 'journal.create'
          WHERE j.entity_id = $1 AND j.idempotency_key = $2`, [scope.entityId, input.idempotencyKey]);
      if (ex.rowCount) {
        if (ex.rows[0].hash && ex.rows[0].hash !== hash) {
          throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different payload');
        }
        return { ...(await getJournal(tx, scope.entityId, ex.rows[0].id)), idempotentReplay: true };
      }
    }
    const sys = internal && 'journalType' in internal ? internal : null;
    const rec = internal && 'recurringJournalId' in internal ? internal : null;
    const type = sys?.journalType ?? input.journalType ?? 'manual';
    if (!sys && !ALLOWED_TYPES.has(type)) throw new DomainError('INVALID_JOURNAL_TYPE', `Journal type ${type} cannot be created manually`);
    if (!input.description?.trim()) throw new DomainError('DESCRIPTION_REQUIRED', 'Description is required');
    const currency = (input.currency ?? ent.functional_currency).toUpperCase();
    const fxRate = String(input.fxRate ?? 1);
    const period = await periodFor(tx, scope.entityId, input.journalDate);
    const { lines } = normaliseLines(input.lines, { txnCurrency: currency, functionalCurrency: ent.functional_currency, fxRate },
      { requireBalance: false });
    await validateAccounts(tx, scope.entityId, lines.map((l) => l.accountId), input.journalDate);
    const j = await tx.query(
      `INSERT INTO journal_entries (entity_id, journal_type, journal_date, period_id, reference, description,
                                    currency, fx_rate, prepared_by, idempotency_key, source, closes_financial_year_id, is_adjustment,
                                    auto_reverse_date, recurring_journal_id, recurring_run_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [scope.entityId, type, input.journalDate, period.id, input.reference ?? null, input.description.trim(),
       currency, fxRate, actor.id, input.idempotencyKey ?? null, sys ? 'system' : rec ? 'recurring' : 'manual', sys?.closesFinancialYearId ?? null,
       adjusting(type, sys ? false : input.isAdjustment), autoReverse(type, input), rec?.recurringJournalId ?? null, rec?.recurringRunDate ?? null]);
    const id = j.rows[0].id;
    await writeLines(tx, id, lines);
    const full = await getJournal(tx, scope.entityId, id);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'journal.create', objectType: 'journal', objectId: id,
      after: { payload_hash: hash, journal_date: full.journal_date, totals: full.totals, lines: full.lines.length } });
    return full;
  }
}

/** Auto-reversal date: only for types that may reverse, and only after the journal date. */
function autoReverse(type: string, input: JournalInput): string | null {
  const d = input.autoReverseDate || null;
  if (!d) return null;
  if (['reversal', 'year_end_close', 'opening_balance'].includes(type)) {
    throw new DomainError('AUTO_REVERSE_NOT_ALLOWED', 'Opening balances, reversals and closing journals cannot reverse automatically');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d <= input.journalDate) {
    throw new DomainError('INVALID_DATE', 'The automatic reversal date must be after the journal date');
  }
  return d;
}

export async function updateDraft(db: Db, scope: EntityScope, actor: Actor, id: string, input: JournalInput) {
  requirePerm(scope, 'journal.prepare');
  return withTx(db, async (tx) => {
    const ent = await entityRow(tx, scope.entityId);
    const cur = await tx.query('SELECT * FROM journal_entries WHERE entity_id = $1 AND id = $2 FOR UPDATE', [scope.entityId, id]);
    if (!cur.rowCount) throw new DomainError('NOT_FOUND', 'Journal not found');
    const j = cur.rows[0];
    if (j.status !== 'draft') throw new DomainError('JOURNAL_NOT_EDITABLE', `Journal is ${j.status}; only drafts can be edited`);
    if (j.prepared_by !== actor.id) throw new DomainError('FORBIDDEN', 'Only the preparer can edit a draft');
    if (input.expectedVersion !== undefined && input.expectedVersion !== j.version) {
      throw new DomainError('STALE_VERSION', 'Journal was changed by someone else; reload and retry');
    }
    if (j.journal_type === 'reversal') throw new DomainError('JOURNAL_NOT_EDITABLE', 'Reversal journals cannot be edited; reject and re-create');
    if (j.journal_type === 'year_end_close') throw new DomainError('JOURNAL_NOT_EDITABLE', 'Closing journals are computed by the system; reject it and generate the close again');
    const currency = (input.currency ?? j.currency).toUpperCase();
    const fxRate = String(input.fxRate ?? j.fx_rate);
    const period = await periodFor(tx, scope.entityId, input.journalDate);
    const { lines } = normaliseLines(input.lines, { txnCurrency: currency, functionalCurrency: ent.functional_currency, fxRate },
      { requireBalance: false });
    await validateAccounts(tx, scope.entityId, lines.map((l) => l.accountId), input.journalDate);
    const before = await getJournal(tx, scope.entityId, id);
    await tx.query('DELETE FROM journal_lines WHERE journal_id = $1', [id]);
    await tx.query(
      `UPDATE journal_entries SET journal_date=$1, period_id=$2, description=$3, reference=$4, currency=$5, fx_rate=$6,
              journal_type=$7, is_adjustment=$8, auto_reverse_date=$10 WHERE id=$9`,
      [input.journalDate, period.id, input.description.trim(), input.reference ?? null, currency, fxRate,
       input.journalType ?? j.journal_type,
       typeof input.isAdjustment === 'boolean' || input.journalType !== undefined
         ? adjusting(input.journalType ?? j.journal_type, input.isAdjustment) : j.is_adjustment, id,
       input.autoReverseDate === undefined ? (j.auto_reverse_date ?? null)
         : autoReverse(input.journalType ?? j.journal_type, input)]);
    await writeLines(tx, id, lines);
    const after = await getJournal(tx, scope.entityId, id);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'journal.update', objectType: 'journal', objectId: id,
      before: { totals: before.totals, lines: before.lines.map(compactLine) }, after: { totals: after.totals, lines: after.lines.map(compactLine) } });
    return after;
  });
}

const compactLine = (l: any) => ({ a: l.account_code, dr: l.debit, cr: l.credit });

export async function transition(db: Db, scope: EntityScope, actor: Actor, id: string, action: WorkflowAction,
                                 opts: { reason?: string } = {}) {
  return withTx(db, async (tx) => {
    const ent = await entityRow(tx, scope.entityId);
    const cur = await tx.query('SELECT * FROM journal_entries WHERE entity_id = $1 AND id = $2 FOR UPDATE', [scope.entityId, id]);
    if (!cur.rowCount) throw new DomainError('NOT_FOUND', 'Journal not found');
    const j = cur.rows[0];
    const to = planTransition(action, { status: j.status as JournalStatus, preparedBy: j.prepared_by },
      { id: actor.id, permissions: scope.permissions }, { segregationEnabled: ent.segregation_enabled });

    if (action === 'reject' && !opts.reason?.trim()) throw new DomainError('REASON_REQUIRED', 'A reason is required to reject');
    if (action === 'submit' || action === 'approve' || action === 'post') {
      const p = await tx.query('SELECT name, status FROM accounting_periods WHERE id = $1', [j.period_id]);
      if (p.rows[0].status !== 'open') throw new DomainError('PERIOD_LOCKED', `Period ${p.rows[0].name} is locked`);
      const full = await getJournal(tx, scope.entityId, id);
      const { totals } = normaliseLines(
        full.lines.map((l: any) => ({ accountId: l.account_id, debit: l.txn_debit, credit: l.txn_credit })),
        { txnCurrency: j.currency, functionalCurrency: ent.functional_currency, fxRate: j.fx_rate }, { requireBalance: true });
      // Stored functional amounts are authoritative; re-check them too.
      if (full.totals.debit !== full.totals.credit) throw new DomainError('JOURNAL_UNBALANCED', 'Functional-currency totals do not balance');
      void totals;
      await validateAccounts(tx, scope.entityId, full.lines.map((l: any) => l.account_id), j.journal_date);
      if (j.auto_reverse_date) {          // fail early, not only at posting
        const rp = await tx.query(
          `SELECT name, status FROM accounting_periods WHERE entity_id = $1 AND $2::date BETWEEN start_date AND end_date`,
          [scope.entityId, j.auto_reverse_date]);
        if (!rp.rowCount) throw new DomainError('AUTO_REVERSAL_PERIOD_UNAVAILABLE', `No accounting period exists for the automatic reversal on ${j.auto_reverse_date}`);
        if (rp.rows[0].status !== 'open') throw new DomainError('AUTO_REVERSAL_PERIOD_LOCKED', `${rp.rows[0].name} is locked, so the automatic reversal on ${j.auto_reverse_date} cannot post`);
      }
    }

    const sets: string[] = ['status = $1'];
    const params: unknown[] = [to];
    const add = (sql: string, v: unknown) => { params.push(v); sets.push(`${sql} = $${params.length}`); };
    if (action === 'submit') { add('submitted_at', new Date()); }
    if (action === 'approve') { add('approved_by', actor.id); add('approved_at', new Date()); }
    if (action === 'return') { add('approved_by', null); add('approved_at', null); add('submitted_at', null); }
    if (action === 'reject') { add('rejected_by', actor.id); add('rejected_at', new Date()); add('rejection_reason', opts.reason!.trim()); }
    if (action === 'post') {
      add('journal_no', await nextJournalNo(tx, scope.entityId, j.period_id));
      add('posted_by', actor.id); add('posted_at', new Date());
    }
    params.push(id);
    await tx.query(`UPDATE journal_entries SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    if (action === 'post' && j.reverses_journal_id) {
      await tx.query('UPDATE journal_entries SET reversed_by_journal_id = $1 WHERE id = $2', [id, j.reverses_journal_id]);
      await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'journal.reversed', objectType: 'journal',
        objectId: j.reverses_journal_id, after: { reversed_by: id } });
    }
    if (action === 'post' && j.auto_reverse_date) await postAutoReversal(tx, scope, actor, id);
    const after = await getJournal(tx, scope.entityId, id);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: `journal.${action}`, objectType: 'journal', objectId: id,
      before: { status: j.status }, after: { status: to, journal_no: after.journal_no, totals: after.totals }, reason: opts.reason ?? null });
    return after;
  });
}

/** Insert a reversal draft of journal `o` (mirror-image lines), returning its id. */
async function insertReversalDraft(tx: Tx, o: any, r: { date: string; periodId: string; description: string; preparedBy: string; source: string }) {
  const lines = await tx.query('SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY line_no', [o.id]);
  const j = await tx.query(
    `INSERT INTO journal_entries (entity_id, journal_type, journal_date, period_id, reference, description, currency, fx_rate,
                                  prepared_by, reverses_journal_id, source, is_adjustment)
     VALUES ($1,'reversal',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [o.entity_id, r.date, r.periodId, o.journal_no, r.description, o.currency, o.fx_rate, r.preparedBy, o.id, r.source, o.is_adjustment]);
  const newId = j.rows[0].id;
  for (const l of reverseLines(lines.rows)) {
    await tx.query(
      `INSERT INTO journal_lines (journal_id, line_no, account_id, description, txn_debit, txn_credit, debit, credit,
                                  counterparty, dimension_values, source_document_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [newId, l.line_no, l.account_id, l.description, l.txn_debit, l.txn_credit, l.debit, l.credit,
       l.counterparty, l.dimension_values, l.source_document_ref]);
  }
  return newId as string;
}

/** Next journal number in the financial year of `periodId` (gapless per entity and year). */
async function nextJournalNo(tx: Tx, entityId: string, periodId: string) {
  const fy = await tx.query(
    `SELECT fy.label FROM accounting_periods p JOIN financial_years fy ON fy.id = p.financial_year_id WHERE p.id = $1`, [periodId]);
  const label = fy.rows[0].label as string;
  const seq = await tx.query(
    `INSERT INTO journal_sequences (entity_id, fy_label, last_no) VALUES ($1,$2,1)
     ON CONFLICT (entity_id, fy_label) DO UPDATE SET last_no = journal_sequences.last_no + 1 RETURNING last_no`,
    [entityId, label]);
  return `JV-${label}-${String(seq.rows[0].last_no).padStart(6, '0')}`;
}

/**
 * Post the automatic reversal of a just-posted journal, in the same transaction. The original's
 * approval covers its reversal (same lines, opposite sides); if the reversal date's period is not
 * open, the original does not post either.
 */
async function postAutoReversal(tx: Tx, scope: EntityScope, actor: Actor, originalId: string) {
  const o = (await tx.query('SELECT * FROM journal_entries WHERE id = $1', [originalId])).rows[0];
  let period;
  try { period = await periodFor(tx, scope.entityId, o.auto_reverse_date); }
  catch { throw new DomainError('AUTO_REVERSAL_PERIOD_UNAVAILABLE', `No accounting period exists for the automatic reversal on ${o.auto_reverse_date}`); }
  if (period.status !== 'open') {
    throw new DomainError('AUTO_REVERSAL_PERIOD_LOCKED', `${period.name} is locked, so the automatic reversal on ${o.auto_reverse_date} cannot post; re-open it or change the reversal date`);
  }
  const id = await insertReversalDraft(tx, o, { date: o.auto_reverse_date, periodId: period.id,
    description: `Automatic reversal of ${o.journal_no}: ${o.description}`, preparedBy: o.prepared_by, source: 'auto_reversal' });
  const now = new Date();
  await tx.query(`UPDATE journal_entries SET status = 'submitted', submitted_at = $2 WHERE id = $1`, [id, now]);
  await tx.query(`UPDATE journal_entries SET status = 'approved', approved_by = $2, approved_at = $3 WHERE id = $1`, [id, o.approved_by, now]);
  await tx.query(`UPDATE journal_entries SET status = 'posted', journal_no = $2, posted_by = $3, posted_at = $4 WHERE id = $1`,
    [id, await nextJournalNo(tx, scope.entityId, period.id), actor.id, now]);
  await tx.query('UPDATE journal_entries SET reversed_by_journal_id = $1 WHERE id = $2', [id, originalId]);
  await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'journal.auto_reversed', objectType: 'journal', objectId: originalId,
    after: { reversed_by: id, reversal_date: o.auto_reverse_date } });
  return id;
}

/** Create a linked reversal draft. It goes through the same approval workflow before it posts. */
export async function createReversal(db: Db, scope: EntityScope, actor: Actor, id: string,
                                     opts: { reversalDate: string; reason: string }) {
  requirePerm(scope, 'journal.prepare');
  if (!opts.reason?.trim()) throw new DomainError('REASON_REQUIRED', 'A reason is required for a reversal');
  return withTx(db, async (tx) => {
    const orig = await tx.query('SELECT * FROM journal_entries WHERE entity_id = $1 AND id = $2 FOR UPDATE', [scope.entityId, id]);
    if (!orig.rowCount) throw new DomainError('NOT_FOUND', 'Journal not found');
    const o = orig.rows[0];
    if (o.status !== 'posted') throw new DomainError('NOT_POSTED', 'Only posted journals can be reversed; edit or reject drafts instead');
    if (o.reversed_by_journal_id) throw new DomainError('ALREADY_REVERSED', 'Journal has already been reversed');
    if (o.journal_type === 'reversal') throw new DomainError('REVERSAL_OF_REVERSAL', 'Re-post the original entry instead of reversing a reversal');
    if (opts.reversalDate < o.journal_date) throw new DomainError('INVALID_DATE', 'Reversal date cannot precede the original journal date');
    const period = await periodFor(tx, scope.entityId, opts.reversalDate);
    if (period.status !== 'open') throw new DomainError('PERIOD_LOCKED', `Period ${period.name} is locked`);
    const newId = await insertReversalDraft(tx, o, { date: opts.reversalDate, periodId: period.id,
      description: `Reversal of ${o.journal_no}: ${opts.reason.trim()}`, preparedBy: actor.id, source: 'reversal' });
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'journal.reversal_created', objectType: 'journal',
      objectId: newId, after: { reverses: id, reverses_no: o.journal_no }, reason: opts.reason.trim() });
    return getJournal(tx, scope.entityId, newId);
  });
}

export async function deleteDraft(db: Db, scope: EntityScope, actor: Actor, id: string) {
  requirePerm(scope, 'journal.prepare');
  // Drafts are not discarded silently: they are rejected (withdrawn) so the trail survives.
  return transition(db, scope, actor, id, 'reject', { reason: 'Withdrawn by preparer' });
}
