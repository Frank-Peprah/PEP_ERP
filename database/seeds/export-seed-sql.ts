/**
 * Export the local seeded database as a SQL script that can be replayed on any
 * PEP ERP database (e.g. hosted staging) WITHOUT disabling triggers:
 * journals are inserted as drafts and walked through submit → approve → post,
 * so every database control re-validates the data on the target.
 *
 *   npx tsx database/seeds/export-seed-sql.ts <outDir>
 * Writes 01_reference.sql, 02_journals.sql, 03_workflow.sql, 04_audit.sql.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1184, (v) => v); // timestamptz as text, preserves microseconds for the audit hash

const out = process.argv[2] ?? 'seed-sql';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return c.escapeLiteral(JSON.stringify(v));
  return c.escapeLiteral(String(v));
};
const insert = (table: string, rows: Record<string, unknown>[], cols: string[]) =>
  rows.length ? `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${rows.map((r) => `(${cols.map((k) => lit(r[k])).join(', ')})`).join(',\n')};\n` : '';
const q = async (sql: string) => (await c.query(sql)).rows;

mkdirSync(out, { recursive: true });

// 1. Reference data
let s = 'BEGIN;\n';
s += insert('users', await q('SELECT * FROM users ORDER BY created_at, email'), ['id', 'email', 'full_name', 'is_active', 'created_at']);
s += insert('entities', await q('SELECT * FROM entities ORDER BY code'),
  ['id', 'code', 'legal_name', 'trading_name', 'registration_no', 'jurisdiction', 'industry', 'reporting_framework',
   'functional_currency', 'presentation_currency', 'segregation_enabled', 'created_at']);
s += insert('user_entity_roles', await q('SELECT * FROM user_entity_roles'), ['user_id', 'entity_id', 'role_code', 'granted_by', 'granted_at']);
s += insert('financial_years', await q('SELECT * FROM financial_years ORDER BY start_date'), ['id', 'entity_id', 'label', 'start_date', 'end_date', 'is_closed', 'created_at']);
s += insert('accounting_periods', await q('SELECT * FROM accounting_periods ORDER BY entity_id, start_date'),
  ['id', 'entity_id', 'financial_year_id', 'period_no', 'name', 'start_date', 'end_date']); // inserted open; locked in step 3
s += insert('accounts', await q('SELECT * FROM accounts ORDER BY entity_id, (parent_id IS NOT NULL), code'),
  ['id', 'entity_id', 'code', 'name', 'account_type', 'normal_balance', 'parent_id', 'is_postable', 'is_control',
   'requires_reconciliation', 'cash_flow_class', 'statement_line_code', 'note_ref', 'tax_mapping_code', 'is_active', 'effective_from', 'created_at']);
for (const e of await q('SELECT id, retained_earnings_account_id FROM entities WHERE retained_earnings_account_id IS NOT NULL'))
  s += `UPDATE entities SET retained_earnings_account_id = ${lit(e.retained_earnings_account_id)} WHERE id = ${lit(e.id)};\n`;
s += 'COMMIT;\n';
writeFileSync(join(out, '01_reference.sql'), s);

// 2. Journals as drafts + lines
const journals = await q('SELECT * FROM journal_entries ORDER BY draft_no');
s = 'BEGIN;\n';
s += insert('journal_entries', journals,
  ['id', 'entity_id', 'draft_no', 'journal_type', 'journal_date', 'period_id', 'source', 'reference', 'description',
   'currency', 'fx_rate', 'prepared_by', 'reverses_journal_id', 'idempotency_key', 'created_at']);
s += insert('journal_lines', await q('SELECT * FROM journal_lines ORDER BY journal_id, line_no'),
  ['id', 'journal_id', 'line_no', 'account_id', 'description', 'txn_debit', 'txn_credit', 'debit', 'credit',
   'counterparty', 'dimension_values', 'source_document_ref']);
s += `SELECT setval(pg_get_serial_sequence('journal_entries','draft_no'), (SELECT max(draft_no) FROM journal_entries));\n`;
s += 'COMMIT;\n';
writeFileSync(join(out, '02_journals.sql'), s);

// 3. Workflow replay in posting order, then reversal links, sequences and period locks
s = 'BEGIN;\n';
const ordered = [...journals].sort((a, b) => String(a.posted_at ?? a.submitted_at ?? '~').localeCompare(String(b.posted_at ?? b.submitted_at ?? '~')));
for (const j of ordered) {
  const id = lit(j.id);
  if (['submitted', 'approved', 'posted'].includes(j.status)) s += `UPDATE journal_entries SET status='submitted', submitted_at=${lit(j.submitted_at)} WHERE id=${id};\n`;
  if (['approved', 'posted'].includes(j.status)) s += `UPDATE journal_entries SET status='approved', approved_by=${lit(j.approved_by)}, approved_at=${lit(j.approved_at)} WHERE id=${id};\n`;
  if (j.status === 'posted') s += `UPDATE journal_entries SET status='posted', journal_no=${lit(j.journal_no)}, posted_by=${lit(j.posted_by)}, posted_at=${lit(j.posted_at)} WHERE id=${id};\n`;
  if (j.status === 'rejected') s += `UPDATE journal_entries SET status='rejected', rejected_by=${lit(j.rejected_by)}, rejected_at=${lit(j.rejected_at)}, rejection_reason=${lit(j.rejection_reason)} WHERE id=${id};\n`;
}
for (const j of journals.filter((x) => x.reversed_by_journal_id))
  s += `UPDATE journal_entries SET reversed_by_journal_id=${lit(j.reversed_by_journal_id)} WHERE id=${lit(j.id)};\n`;
s += insert('journal_sequences', await q('SELECT * FROM journal_sequences'), ['entity_id', 'fy_label', 'last_no']);
for (const p of await q(`SELECT * FROM accounting_periods WHERE status = 'locked'`))
  s += `UPDATE accounting_periods SET status='locked', locked_by=${lit(p.locked_by)}, locked_at=${lit(p.locked_at)} WHERE id=${lit(p.id)};\n`;
s += 'COMMIT;\n';
writeFileSync(join(out, '03_workflow.sql'), s);

// 4. Audit trail — the target's trigger recomputes the hash chain; timestamps are preserved
s = 'BEGIN;\n';
s += insert('audit_events', await q('SELECT * FROM audit_events ORDER BY id'),
  ['entity_id', 'actor_id', 'action', 'object_type', 'object_id', 'before', 'after', 'reason', 'occurred_at']);
s += 'COMMIT;\n';
writeFileSync(join(out, '04_audit.sql'), s);
await c.end();
console.log(`wrote seed SQL to ${out}`);
