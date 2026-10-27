/** Performance check (spec §12): 100,000 posted journal lines, trial balance < 10s. Run: npx tsx tests/perf/tb-100k.ts */
import { setup } from '../helpers.js';
const c = await setup();
const accts = (await c.db.query(`SELECT id FROM accounts WHERE entity_id=$1 AND is_postable ORDER BY code`, [c.T])).rows.map((r) => r.id);
const { ama, kofi } = c.base.users;
const t0 = Date.now();
await c.db.query('BEGIN');
// 25,000 journals × 4 lines, created as drafts then walked through the workflow in bulk (triggers still validate each post)
await c.db.query(`
  INSERT INTO journal_entries (entity_id, journal_date, period_id, description, currency, prepared_by)
  SELECT $1, d, p.id, 'perf '||g, 'GHS', $2
    FROM generate_series(1,25000) g
    CROSS JOIN LATERAL (SELECT DATE '2026-01-01' + (g % 300) AS d) x
    JOIN accounting_periods p ON p.entity_id=$1 AND x.d BETWEEN p.start_date AND p.end_date`, [c.T, ama]);
await c.db.query(`
  INSERT INTO journal_lines (journal_id, line_no, account_id, txn_debit, txn_credit, debit, credit)
  SELECT j.id, n, ($2::uuid[])[1 + (abs(hashtext(j.id::text||n)) % array_length($2::uuid[],1))],
         CASE WHEN n<=2 THEN amt ELSE 0 END, CASE WHEN n>2 THEN amt ELSE 0 END,
         CASE WHEN n<=2 THEN amt ELSE 0 END, CASE WHEN n>2 THEN amt ELSE 0 END
    FROM journal_entries j CROSS JOIN generate_series(1,4) n
    CROSS JOIN LATERAL (SELECT ((abs(hashtext(j.id::text)) % 100000) / 100.0 + 1)::numeric(20,2) AS amt) a
   WHERE j.entity_id=$1 AND j.description LIKE 'perf %'`, [c.T, accts]);
await c.db.query(`UPDATE journal_entries SET status='submitted' WHERE description LIKE 'perf %'`);
await c.db.query(`UPDATE journal_entries SET status='approved', approved_by=$1 WHERE description LIKE 'perf %'`, [kofi]);
await c.db.query(`UPDATE journal_entries SET status='posted', posted_by=$1, posted_at=now(), journal_no='P-'||draft_no WHERE description LIKE 'perf %'`, [kofi]);
await c.db.query('COMMIT');
await c.db.query('ANALYZE'); // as autovacuum would after a bulk load
const n = (await c.db.query(`SELECT count(*) FROM ledger_postings`)).rows[0].count;
console.log(`loaded ${n} posted lines in ${((Date.now()-t0)/1000).toFixed(1)}s`);
const periods = (await c.call('frank','GET',`/api/entities/${c.T}/periods`)).json();
const dec = periods.find((f:any)=>f.label==='2026').periods.find((p:any)=>p.period_no===12).id;
for (const basis of ['ytd','period']) {
  const t = Date.now();
  const r = (await c.call('frank','GET',`/api/entities/${c.T}/trial-balance?periodId=${dec}&basis=${basis}`)).json();
  console.log(`TB (${basis}): ${Date.now()-t} ms, balanced=${r.balanced}, Dr=${r.totals.closing.debit} Cr=${r.totals.closing.credit}`);
}
const t2 = Date.now();
const l = (await c.call('frank','GET',`/api/entities/${c.T}/ledger?accountId=${accts[0]}&from=2026-01-01&to=2026-12-31`)).json();
console.log(`Ledger ${l.lines.length} lines: ${Date.now()-t2} ms`);
await c.teardown();
