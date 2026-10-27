/**
 * Seed: reference users, two entities (Trulander, Pep Landbank), FY2025–FY2026,
 * a real-estate chart of accounts, and DEMO journals posted through the real
 * workflow (prepare → submit → approve → post). All amounts are ILLUSTRATIVE
 * DEMO DATA, not Trulander's actual books. No tax rates are seeded.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createPool, type Db } from '../../apps/api/src/lib/db.js';
import { loadActor, loadScope } from '../../apps/api/src/lib/auth.js';
import * as S from '../../apps/api/src/services/setup.js';
import * as J from '../../apps/api/src/services/journals.js';
import { migrate } from '../migrate.js';

export const USERS = {
  frank:   { email: 'frank@pep.local',   name: 'Frank Adu-Peprah', },
  ama:     { email: 'ama@pep.local',     name: 'Ama Owusu (Preparer)' },
  kofi:    { email: 'kofi@pep.local',    name: 'Kofi Mensah (Approver)' },
  auditor: { email: 'auditor@pep.local', name: 'External Auditor (Read-only)' },
  sysadmin:{ email: 'admin@pep.local',   name: 'System Administrator' },
  lbacct:  { email: 'esi@pep.local',     name: 'Esi Boateng (Landbank Accountant)' },
} as const;

type Acc = [code: string, name: string, type: string, parent: string | null, opts?: {
  header?: boolean; cash?: boolean; recon?: boolean; line?: string; normal?: 'debit' | 'credit'; cf?: string }];

export const REAL_ESTATE_COA: Acc[] = [
  ['1000', 'Assets', 'asset', null, { header: true }],
  ['1100', 'Cash at bank — current account', 'asset', '1000', { cash: true, recon: true, line: 'SFP_CASH' }],
  ['1110', 'Mobile money merchant wallet', 'asset', '1000', { cash: true, recon: true, line: 'SFP_CASH' }],
  ['1120', 'Petty cash', 'asset', '1000', { cash: true, line: 'SFP_CASH' }],
  ['1200', 'Trade receivables — plot buyers', 'asset', '1000', { recon: true, line: 'SFP_RECEIVABLES', cf: 'operating' }],
  ['1300', 'Land held for resale (inventory)', 'asset', '1000', { line: 'SFP_INVENTORY', cf: 'operating' }],
  ['1310', 'Land development costs', 'asset', '1000', { line: 'SFP_INVENTORY', cf: 'operating' }],
  ['1400', 'Prepayments', 'asset', '1000', { line: 'SFP_PREPAYMENTS', cf: 'operating' }],
  ['1500', 'Motor vehicles — cost', 'asset', '1000', { line: 'SFP_PPE', cf: 'investing' }],
  ['1510', 'Motor vehicles — accumulated depreciation', 'asset', '1000', { line: 'SFP_PPE', normal: 'credit', cf: 'non_cash' }],
  ['1600', 'Office equipment — cost', 'asset', '1000', { line: 'SFP_PPE', cf: 'investing' }],
  ['2000', 'Liabilities', 'liability', null, { header: true }],
  ['2100', 'Trade payables — landowners', 'liability', '2000', { recon: true, line: 'SFP_PAYABLES', cf: 'operating' }],
  ['2110', 'Customer deposits (contract liabilities)', 'liability', '2000', { line: 'SFP_CONTRACT_LIAB', cf: 'operating' }],
  ['2200', 'Accruals', 'liability', '2000', { line: 'SFP_ACCRUALS', cf: 'operating' }],
  ['2300', 'Commissions payable — agents', 'liability', '2000', { line: 'SFP_PAYABLES', cf: 'operating' }],
  ['2400', 'Director\'s loan', 'liability', '2000', { line: 'SFP_BORROWINGS', cf: 'financing' }],
  ['3000', 'Equity', 'equity', null, { header: true }],
  ['3100', 'Stated capital', 'equity', '3000', { line: 'EQ_CAPITAL', cf: 'financing' }],
  ['3200', 'Retained earnings', 'equity', '3000', { line: 'EQ_RETAINED' }],
  ['4000', 'Revenue', 'revenue', null, { header: true }],
  ['4100', 'Revenue — plot sales', 'revenue', '4000', { line: 'PL_REVENUE' }],
  ['4200', 'Revenue — documentation & processing fees', 'revenue', '4000', { line: 'PL_REVENUE' }],
  ['4300', 'Revenue — site inspection fees', 'revenue', '4000', { line: 'PL_REVENUE' }],
  ['5000', 'Cost of sales', 'expense', null, { header: true }],
  ['5100', 'Cost of land sold', 'expense', '5000', { line: 'PL_COST_OF_SALES' }],
  ['5200', 'Sales commissions — agents', 'expense', '5000', { line: 'PL_COST_OF_SALES' }],
  ['6000', 'Operating expenses', 'expense', null, { header: true }],
  ['6100', 'Salaries and wages', 'expense', '6000', { line: 'PL_ADMIN_EXP' }],
  ['6200', 'Office rent', 'expense', '6000', { line: 'PL_ADMIN_EXP' }],
  ['6300', 'Marketing and advertising', 'expense', '6000', { line: 'PL_SELLING_EXP' }],
  ['6400', 'Survey, legal and title fees', 'expense', '6000', { line: 'PL_ADMIN_EXP' }],
  ['6500', 'Fuel and transport', 'expense', '6000', { line: 'PL_ADMIN_EXP' }],
  ['6600', 'Depreciation', 'expense', '6000', { line: 'PL_ADMIN_EXP' }],
  ['6700', 'Bank and MoMo charges', 'expense', '6000', { line: 'PL_ADMIN_EXP' }],
  ['6900', 'Suspense — unallocated', 'expense', '6000', { recon: true }], // deliberately unmapped
];
const NORMAL: Record<string, string> = { asset: 'debit', expense: 'debit', liability: 'credit', equity: 'credit', revenue: 'credit' };

async function upsertUser(db: Db, u: { email: string; name: string }) {
  const r = await db.query(
    `INSERT INTO users (email, full_name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
    [u.email, u.name]);
  return r.rows[0].id as string;
}

export async function seedBase(db: Db) {
  const ids: Record<keyof typeof USERS, string> = {} as any;
  for (const k of Object.keys(USERS) as (keyof typeof USERS)[]) ids[k] = await upsertUser(db, USERS[k]);

  const ent = async (code: string, legal: string, trading: string, industry: string) =>
    (await db.query(
      `INSERT INTO entities (code, legal_name, trading_name, industry) VALUES ($1,$2,$3,$4) RETURNING id`,
      [code, legal, trading, industry])).rows[0].id as string;
  const trulander = await ent('TRULANDER', 'Trulander JSF Limited', 'Trulander', 'Real estate — land marketplace');
  const landbank = await ent('PEPLANDBANK', 'Pep Landbank Ltd', 'Landbank Ghana', 'Proptech');

  const grant = (u: string, e: string, role: string) =>
    db.query('INSERT INTO user_entity_roles (user_id, entity_id, role_code, granted_by) VALUES ($1,$2,$3,$4)', [u, e, role, ids.sysadmin]);
  await grant(ids.frank, trulander, 'controller');
  await grant(ids.frank, landbank, 'controller');
  await grant(ids.ama, trulander, 'preparer');
  await grant(ids.ama, trulander, 'accountant');
  await grant(ids.kofi, trulander, 'approver');
  await grant(ids.auditor, trulander, 'auditor');
  await grant(ids.sysadmin, trulander, 'system_admin');
  await grant(ids.lbacct, landbank, 'accountant');
  await grant(ids.lbacct, landbank, 'preparer');

  for (const e of [trulander, landbank]) {
    const scope = await loadScope(db, ids.frank, e);
    const actor = await loadActor(db, ids.frank);
    await S.createFinancialYear(db, scope, actor, { label: '2025', startDate: '2025-01-01' });
    await S.createFinancialYear(db, scope, actor, { label: '2026', startDate: '2026-01-01' });
    const parents = new Map<string, string>();
    for (const [code, name, type, parent, o = {}] of REAL_ESTATE_COA) {
      const r = await db.query(
        `INSERT INTO accounts (entity_id, code, name, account_type, normal_balance, parent_id, is_postable,
                               requires_reconciliation, cash_flow_class, statement_line_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [e, code, name, type, o.normal ?? NORMAL[type], parent ? parents.get(parent) : null, !o.header,
         !!o.recon, o.cash ? 'cash' : (o.cf ?? 'none'), o.line ?? null]);
      parents.set(code, r.rows[0].id);
    }
    await db.query('UPDATE entities SET retained_earnings_account_id = $1 WHERE id = $2', [parents.get('3200'), e]);
  }
  return { users: ids, entities: { trulander, landbank } };
}

/** Post a DEMO journal through the full workflow with segregation of duties. */
async function postVia(db: Db, entityId: string, preparer: string, approver: string, date: string, description: string,
                       lines: [string, string | null, string | null, string?][], opts: { stopAt?: 'draft' | 'submitted'; ref?: string } = {}) {
  const accts = new Map((await db.query('SELECT code, id FROM accounts WHERE entity_id = $1', [entityId])).rows.map((r) => [r.code, r.id]));
  const ps = await loadScope(db, preparer, entityId), pa = await loadActor(db, preparer);
  const j = await J.createDraft(db, ps, pa, {
    journalDate: date, description: `[DEMO] ${description}`, reference: opts.ref ?? null,
    lines: lines.map(([code, dr, cr, desc]) => ({ accountId: accts.get(code)!, debit: dr, credit: cr, description: desc })),
  });
  if (opts.stopAt === 'draft') return j;
  await J.transition(db, ps, pa, j.id, 'submit');
  if (opts.stopAt === 'submitted') return j;
  const as = await loadScope(db, approver, entityId), aa = await loadActor(db, approver);
  await J.transition(db, as, aa, j.id, 'approve');
  return J.transition(db, as, aa, j.id, 'post');
}

export async function seedDemo(db: Db) {
  const base = await seedBase(db);
  const { ama, kofi, frank, lbacct } = base.users;
  const T = base.entities.trulander;
  const P = (d: string, desc: string, l: Parameters<typeof postVia>[6], o?: Parameters<typeof postVia>[7]) => postVia(db, T, ama, kofi, d, desc, l, o);

  // ── FY2025 (gives a prior-year result that is not yet closed) ──
  await P('2025-01-02', 'Opening balances — stated capital injected', [['1100', '850000.00', null], ['3100', null, '850000.00']], { ref: 'OB-2025' });
  await P('2025-02-10', 'Acquisition of 40 acres at Dawhenya (land held for resale)', [['1300', '620000.00', null], ['1100', null, '420000.00'], ['2100', null, '200000.00']], { ref: 'DEED-0041' });
  await P('2025-06-30', 'H1 plot sales — 18 plots', [['1100', '540000.00', null], ['4100', null, '540000.00']], { ref: 'SALES-H1' });
  await P('2025-06-30', 'Cost of 18 plots sold', [['5100', '279000.00', null], ['1300', null, '279000.00']]);
  await P('2025-12-31', 'FY2025 operating costs', [['6100', '96000.00', null], ['6200', '36000.00', null], ['6300', '22500.00', null], ['1100', null, '154500.00']]);

  // ── FY2026 land acquisitions (inventory must exist before cost of sales relieves it) ──
  await P('2026-01-06', 'Acquisition of 60 acres at Ningo (land held for resale)', [['1300', '960000.00', null], ['1100', null, '360000.00'], ['2400', null, '600000.00']], { ref: 'DEED-0058' });
  await P('2026-06-02', 'Acquisition of 25 acres at Prampram (land held for resale)', [['1300', '410000.00', null], ['1100', null, '410000.00']], { ref: 'DEED-0063' });

  // ── FY2026 monthly activity ──
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
  const sales = [210000, 185000, 240000, 262000, 198000, 305000, 288000, 276000, 331000, 296000];
  for (let i = 0; i < months.length; i++) {
    const m = months[i]; const s = sales[i]; const cost = Math.round(s * 0.47);
    const last = new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10);
    const day15 = `2026-${m}-15`;
    await P(day15, `Plot sales — ${m}/2026`, [['1100', (s * 0.8).toFixed(2), null], ['1110', (s * 0.2).toFixed(2), null], ['4100', null, s.toFixed(2)]], { ref: `SALES-2026${m}` });
    await P(day15, `Cost of plots sold — ${m}/2026`, [['5100', cost.toFixed(2), null], ['1300', null, cost.toFixed(2)]]);
    await P(day15, `Documentation fees — ${m}/2026`, [['1110', (s * 0.03).toFixed(2), null], ['4200', null, (s * 0.03).toFixed(2)]]);
    await P(last > '2026-10-27' ? '2026-10-27' : last, `Agent commissions accrued — ${m}/2026`, [['5200', (s * 0.05).toFixed(2), null], ['2300', null, (s * 0.05).toFixed(2)]]);
    await P(last > '2026-10-27' ? '2026-10-27' : last, `Payroll — ${m}/2026`, [['6100', '24500.00', null], ['1100', null, '24500.00']]);
    await P(`2026-${m}-05`, `Office rent — ${m}/2026`, [['6200', '3500.00', null], ['1100', null, '3500.00']]);
    await P(`2026-${m}-20`, `Marketing — ${m}/2026`, [['6300', (4200 + i * 350).toFixed(2), null], ['1110', null, (4200 + i * 350).toFixed(2)]]);
  }
  await P('2026-03-12', 'Land development — access road grading', [['1310', '145000.00', null], ['1100', null, '145000.00']], { ref: 'INV-RD-2201' });
  await P('2026-04-03', 'Settlement of Dawhenya landowner balance', [['2100', '200000.00', null], ['1100', null, '200000.00']]);
  await P('2026-05-18', 'Acquisition of pickup vehicle', [['1500', '185000.00', null], ['1100', null, '185000.00']], { ref: 'VEH-01' });

  // Error + correction pattern: wrong account, reversed, re-posted correctly
  const wrong = await P('2026-09-08', 'Survey fees — Prampram site (posted to marketing in error)', [['6300', '18000.00', null], ['1100', null, '18000.00']], { ref: 'SRV-0907' });
  const fs = await loadScope(db, ama, T), fa = await loadActor(db, ama);
  const rev = await J.createReversal(db, fs, fa, (wrong as any).id, { reversalDate: '2026-09-08', reason: 'Misclassified — survey fees are not marketing' });
  const ks = await loadScope(db, kofi, T), ka = await loadActor(db, kofi);
  await J.transition(db, fs, fa, rev.id, 'submit');
  await J.transition(db, ks, ka, rev.id, 'approve');
  await J.transition(db, ks, ka, rev.id, 'post');
  await P('2026-09-08', 'Survey fees — Prampram site (corrected)', [['6400', '18000.00', null], ['1100', null, '18000.00']], { ref: 'SRV-0907' });

  // Unallocated receipt sitting in suspense (shows mapping exception)
  await P('2026-10-21', 'Unidentified MoMo receipt pending allocation', [['1110', '7500.00', null], ['6900', null, '7500.00']]);

  // Work-in-progress for the approval queue
  await P('2026-10-24', 'Accrual — October electricity and water', [['6200', '2850.00', null], ['2200', null, '2850.00']], { stopAt: 'submitted' });
  await P('2026-10-25', 'Prepaid site security — Q4', [['1400', '12000.00', null], ['1100', null, '12000.00']], { stopAt: 'submitted' });
  await P('2026-10-26', 'Customer deposit — Plot 14, Royal Palm Enclave', [['1100', '25000.00', null], ['2110', null, '25000.00']], { stopAt: 'draft' });

  // Lock Jan–Aug 2026 and all of 2025 (controller)
  const cs = await loadScope(db, frank, T), ca = await loadActor(db, frank);
  const periods = (await db.query(`SELECT id FROM accounting_periods WHERE entity_id = $1 AND end_date <= '2026-08-31' ORDER BY start_date`, [T])).rows;
  for (const p of periods) await S.setPeriodStatus(db, cs, ca, p.id, 'lock');

  // Pep Landbank: a little activity, invisible to Trulander-only users
  await postVia(db, base.entities.landbank, lbacct, frank, '2026-07-01', 'Opening capital — Pep Landbank', [['1100', '300000.00', null], ['3100', null, '300000.00']]);
  return base;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? 'postgres://pep:pep@localhost:5432/pep_dev';
  (async () => {
    await migrate(url, { reset: true, quiet: true });
    const db = createPool(url);
    await seedDemo(db);
    const n = await db.query(`SELECT count(*) FILTER (WHERE status='posted') AS posted, count(*) AS total FROM journal_entries`);
    console.log(`seeded: ${n.rows[0].total} journals (${n.rows[0].posted} posted). Users: ${Object.values(USERS).map((u) => u.email).join(', ')}`);
    await db.end();
  })().catch((e) => { console.error(e); process.exit(1); });
}
