/**
 * Release 2 — Financial Reporting & Assurance Engine.
 *
 * Generates an IFRS-based statement pack (financial position, profit or loss and OCI,
 * changes in equity, cash flows by the indirect method, notes) from POSTED ledger lines
 * through a versioned, mapping-driven template. Every pack carries its own cross-checks and
 * exceptions; blocking exceptions prevent finalisation. Packs are frozen at generation and
 * hashed by the database, so an approved pack stays reproducible after mappings change.
 *
 * Sign conventions (all amounts are Decimal; output as 2-dp strings):
 *   net            = debit − credit (ledger)
 *   asset lines    = net                 (positive = asset)
 *   liability/equity lines = −net        (positive = liability/equity)
 *   P&L lines      = −net                (income positive, expenses negative)
 *   cash-flow effect of a balance-sheet account = −(movement in net)
 */
import { createHash } from 'node:crypto';
import { Decimal, DomainError } from '@pep/accounting-domain';
import { audit, withTx, type Db, type Tx } from '../lib/db.js';
import { requirePerm, type Actor, type EntityScope } from '../lib/auth.js';

type Side = 'asset' | 'liability' | 'equity';
interface TemplateLine { code: string; label: string; includesProfit?: boolean }
interface TemplateSection { key: string; label: string; side: Side; lines: TemplateLine[] }
interface PlItem { code?: string; subtotal?: string; label: string }
interface Template { id: string; code: string; version: number; framework: string; definition: { sfp: TemplateSection[]; pl: PlItem[]; oci: PlItem[] } }

interface AccountRow {
  id: string; code: string; name: string; account_type: string; normal_balance: string; is_postable: boolean;
  statement_line_code: string | null; cash_flow_class: string;
}
export interface Exception { code: string; severity: 'blocking' | 'warning'; message: string; accountCode?: string }

const D = (v: unknown) => new Decimal((v as string) ?? 0);
const Z = new Decimal(0);
const s2 = (d: Decimal) => d.toFixed(2);
const isBS = (t: string) => t === 'asset' || t === 'liability' || t === 'equity';
const dayBefore = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

// ───────────────────────────── Ledger facts ─────────────────────────────
interface Facts {
  asOf: string; fyStart: string;
  closing: Map<string, Decimal>;   // account id → net at asOf
  opening: Map<string, Decimal>;   // account id → net at fyStart − 1 (BS) ; P&L cumulative before fyStart
  movement: Map<string, Decimal>;  // account id → net movement fyStart..asOf
}

async function loadFacts(db: Db | Tx, entityId: string, fyStart: string, asOf: string): Promise<Facts> {
  const r = await db.query(
    `SELECT account_id,
            COALESCE(sum(net) FILTER (WHERE journal_date <= $3), 0)                       AS closing,
            COALESCE(sum(net) FILTER (WHERE journal_date <  $2), 0)                       AS opening,
            COALESCE(sum(net) FILTER (WHERE journal_date BETWEEN $2 AND $3), 0)           AS movement
       FROM ledger_postings WHERE entity_id = $1 AND journal_date <= $3 GROUP BY account_id`,
    [entityId, fyStart, asOf]);
  const f: Facts = { asOf, fyStart, closing: new Map(), opening: new Map(), movement: new Map() };
  for (const x of r.rows) { f.closing.set(x.account_id, D(x.closing)); f.opening.set(x.account_id, D(x.opening)); f.movement.set(x.account_id, D(x.movement)); }
  return f;
}
const get = (m: Map<string, Decimal>, id: string) => m.get(id) ?? Z;

// ───────────────────────────── Computation for one period ─────────────────────────────
/** Comparable values for one period, keyed so a frozen pack can supply the same shape. */
interface PeriodValues {
  sfp: Record<string, string>;                // line code (or '__UNMAPPED_<side>') → value
  pl: Record<string, string>;                 // line code / subtotal key / '__UNMAPPED' / 'oci' / 'tci' → value
  cf: Record<string, string>;                 // cf line key → value; plus 'net', 'opening', 'closing'
  cfLabels?: Record<string, string>;          // cf line key → label
  noteAccounts: Record<string, string>;       // account code → value (statement sign)
  soce: { columns: string[]; rows: { key: string; label: string; values: string[]; total: string }[] } | null;
}

interface Computed {
  values: PeriodValues;
  sfpAccounts: Record<string, { code: string; name: string; value: Decimal }[]>;
  plAccounts: Record<string, { code: string; name: string; value: Decimal }[]>;
  cfLines: { key: string; section: 'operating' | 'investing' | 'financing'; label: string; value: Decimal }[];
  cfFacts: { profit: Decimal; net: Decimal; opening: Decimal; closing: Decimal; actual: Decimal; difference: Decimal };
  exceptions: Exception[];
  totals: { assets: Decimal; equity: Decimal; liabilities: Decimal; profit: Decimal };
}

function compute(t: Template, accounts: AccountRow[], f: Facts, materiality: Decimal): Computed {
  const ex: Exception[] = [];
  const sideOf = new Map<string, Side>();
  const lineLabel = new Map<string, string>();
  for (const s of t.definition.sfp) for (const l of s.lines) { sideOf.set(l.code, s.side); lineLabel.set(l.code, l.label); }
  const plCodes = new Set(t.definition.pl.filter((x) => x.code).map((x) => x.code!));
  const ociCodes = new Set(t.definition.oci.filter((x) => x.code).map((x) => x.code!));

  const sfp: Record<string, Decimal> = {};
  const sfpAccounts: Computed['sfpAccounts'] = {};
  const pl: Record<string, Decimal> = {};
  const plAccounts: Computed['plAccounts'] = {};
  let profitAll = Z;          // P&L for the period, every P&L account (mapped or not)
  let plCumulativeToDate = Z; // all P&L up to asOf (feeds retained earnings)
  let plBeforeFy = Z;
  const add = (o: Record<string, Decimal>, k: string, v: Decimal) => { o[k] = (o[k] ?? Z).plus(v); };
  const push = (o: Computed['sfpAccounts'], k: string, a: AccountRow, v: Decimal) => { (o[k] ??= []).push({ code: a.code, name: a.name, value: v }); };

  for (const a of accounts) {
    const closing = get(f.closing, a.id), movement = get(f.movement, a.id), opening = get(f.opening, a.id);
    const code = a.statement_line_code;
    if (isBS(a.account_type)) {
      if (closing.eq(0) && opening.eq(0) && movement.eq(0)) continue;
      if (code && plCodes.has(code)) ex.push({ code: 'MAPPING_TYPE_MISMATCH', severity: 'blocking', accountCode: a.code, message: `${a.code} ${a.name} is a ${a.account_type} account mapped to profit-or-loss line ${code}` });
      const side = code ? sideOf.get(code) : undefined;
      if (code && !side && !plCodes.has(code)) ex.push({ code: 'UNKNOWN_LINE_CODE', severity: 'blocking', accountCode: a.code, message: `${a.code} ${a.name} is mapped to ${code}, which template ${t.code} v${t.version} does not contain` });
      const effSide: Side = side ?? (a.account_type as Side);
      const value = effSide === 'asset' ? closing : closing.neg();
      const key = side ? code! : `__UNMAPPED_${effSide}`;
      if (!code && !closing.eq(0)) {
        ex.push({ code: 'UNMAPPED_BALANCE', severity: closing.abs().gt(materiality) ? 'blocking' : 'warning', accountCode: a.code,
          message: `${a.code} ${a.name} carries ${s2(closing.abs())} with no statement-line mapping` });
      }
      add(sfp, key, value); push(sfpAccounts, key, a, value);
    } else {
      plCumulativeToDate = plCumulativeToDate.plus(closing);
      plBeforeFy = plBeforeFy.plus(opening);
      if (movement.eq(0)) continue;
      const value = movement.neg();
      profitAll = profitAll.plus(value);
      if (code && sideOf.has(code)) ex.push({ code: 'MAPPING_TYPE_MISMATCH', severity: 'blocking', accountCode: a.code, message: `${a.code} ${a.name} is a ${a.account_type} account mapped to financial-position line ${code}` });
      const known = code && (plCodes.has(code) || ociCodes.has(code));
      if (code && !known && !sideOf.has(code)) ex.push({ code: 'UNKNOWN_LINE_CODE', severity: 'blocking', accountCode: a.code, message: `${a.code} ${a.name} is mapped to ${code}, which template ${t.code} v${t.version} does not contain` });
      const key = known ? code! : '__UNMAPPED';
      if (!code) ex.push({ code: 'UNMAPPED_BALANCE', severity: movement.abs().gt(materiality) ? 'blocking' : 'warning', accountCode: a.code,
        message: `${a.code} ${a.name} has period activity of ${s2(movement.abs())} with no statement-line mapping` });
      add(pl, key, value); push(plAccounts, key, a, value);
    }
  }

  // Retained earnings include all P&L to date (presentational year-end close).
  const reLine = t.definition.sfp.flatMap((s) => s.lines).find((l) => l.includesProfit);
  if (reLine) { add(sfp, reLine.code, plCumulativeToDate.neg()); (sfpAccounts[reLine.code] ??= []).push({ code: '—', name: 'Accumulated profit or loss (presentational)', value: plCumulativeToDate.neg() }); }

  // P&L: running subtotals; OCI; total comprehensive income.
  const plOut: Record<string, string> = {};
  let running = Z;
  for (const item of t.definition.pl) {
    if (item.code) { const v = pl[item.code] ?? Z; running = running.plus(v); plOut[item.code] = s2(v); }
    else if (item.subtotal) {
      if (item.subtotal === 'operating_profit' || item.subtotal === 'gross_profit') { /* keep running */ }
      plOut[item.subtotal] = s2(item.subtotal === 'profit' ? running.plus(pl.__UNMAPPED ?? Z) : running);
    }
  }
  if (pl.__UNMAPPED) plOut.__UNMAPPED = s2(pl.__UNMAPPED);
  const oci = t.definition.oci.reduce((s, x) => s.plus(x.code ? pl[x.code] ?? Z : Z), Z);
  plOut.oci = s2(oci);
  const profit = D(plOut.profit ?? '0');
  plOut.tci = s2(profit.plus(oci));
  if (!profit.plus(oci).eq(profitAll)) ex.push({ code: 'PL_DOES_NOT_TIE', severity: 'blocking', message: `Total comprehensive income ${s2(profit.plus(oci))} ≠ ledger result ${s2(profitAll)}` });

  // Financial position totals.
  const sumSide = (side: Side) => Object.entries(sfp).reduce((s, [k, v]) => (sideOf.get(k) === side || k === `__UNMAPPED_${side}`) ? s.plus(v) : s, Z);
  const assets = sumSide('asset'), equity = sumSide('equity'), liabilities = sumSide('liability');
  if (!assets.eq(equity.plus(liabilities))) ex.push({ code: 'SFP_DOES_NOT_BALANCE', severity: 'blocking', message: `Total assets ${s2(assets)} ≠ equity and liabilities ${s2(equity.plus(liabilities))}` });

  // Cash flows — indirect method from the ledger.
  const cfLines: Computed['cfLines'] = [];
  const cfAdd = (key: string, section: 'operating' | 'investing' | 'financing', label: string, v: Decimal) => {
    const e = cfLines.find((x) => x.key === key); if (e) e.value = e.value.plus(v); else cfLines.push({ key, section, label, value: v });
  };
  let cashOpening = Z, cashClosing = Z, unclassified = Z;
  for (const a of accounts) {
    if (!isBS(a.account_type)) continue;
    const mv = get(f.movement, a.id);
    if (a.cash_flow_class === 'cash') { cashOpening = cashOpening.plus(get(f.opening, a.id)); cashClosing = cashClosing.plus(get(f.closing, a.id)); continue; }
    if (mv.eq(0)) continue;
    const effect = mv.neg();
    const code = a.statement_line_code ?? `ACC_${a.code}`;
    const label = lineLabel.get(code) ?? a.name;
    const lower = label.charAt(0).toLowerCase() + label.slice(1);
    switch (a.cash_flow_class) {
      case 'non_cash': cfAdd(`nc:${code}`, 'operating', `Non-cash movements — ${lower}`, effect); break;
      case 'operating':
        cfAdd(`wc:${code}`, 'operating', a.account_type === 'asset' ? `(Increase)/decrease in ${lower}` : `Increase/(decrease) in ${lower}`, effect); break;
      case 'investing': cfAdd(`inv:${code}`, 'investing', a.account_type === 'asset' ? `Acquisition and disposal of ${lower}` : `Investing movements — ${lower}`, effect); break;
      case 'financing': cfAdd(`fin:${code}`, 'financing', a.account_type === 'equity' ? `Proceeds from issue of ${lower}` : `Proceeds from/(repayment of) ${lower}`, effect); break;
      default:
        if (a.statement_line_code === reLine?.code) { cfAdd(`re:${code}`, 'operating', 'Movements recorded directly in retained earnings', effect); break; }
        unclassified = unclassified.plus(effect);
        ex.push({ code: 'CF_UNCLASSIFIED_MOVEMENT', severity: 'blocking', accountCode: a.code, message: `${a.code} ${a.name} moved ${s2(effect.neg())} but has no cash-flow classification` });
    }
  }
  const sectionTotal = (s: string) => cfLines.filter((x) => x.section === s).reduce((t2, x) => t2.plus(x.value), Z);
  const net = profitAll.plus(sectionTotal('operating')).plus(sectionTotal('investing')).plus(sectionTotal('financing'));
  const actual = cashClosing.minus(cashOpening);
  const difference = net.minus(actual);
  if (!difference.eq(0)) ex.push({ code: 'CF_DOES_NOT_RECONCILE', severity: 'blocking', message: `Net cash flow ${s2(net)} ≠ movement in cash ${s2(actual)} (difference ${s2(difference)})` });

  // Changes in equity.
  const eqSection = t.definition.sfp.find((s) => s.side === 'equity');
  let soce: PeriodValues['soce'] = null;
  if (eqSection) {
    const cols = eqSection.lines.filter((l) => !D(s2(sfp[l.code] ?? Z)).eq(0) || accounts.some((a) => a.statement_line_code === l.code && (!get(f.opening, a.id).eq(0) || !get(f.movement, a.id).eq(0))));
    const openingOf = (l: TemplateLine) => accounts.filter((a) => a.statement_line_code === l.code && isBS(a.account_type))
      .reduce((s, a) => s.plus(get(f.opening, a.id).neg()), l.includesProfit ? plBeforeFy.neg() : Z);
    const movementOf = (l: TemplateLine) => accounts.filter((a) => a.statement_line_code === l.code && isBS(a.account_type))
      .reduce((s, a) => s.plus(get(f.movement, a.id).neg()), Z);
    const row = (key: string, label: string, vals: Decimal[]) => ({ key, label, values: vals.map(s2), total: s2(vals.reduce((s, v) => s.plus(v), Z)) });
    const open = cols.map(openingOf);
    const prof = cols.map((l) => (l.includesProfit ? profit : Z));
    const ociRow = cols.map((l) => (l.includesProfit ? oci : Z));
    const other = cols.map(movementOf);
    const close = cols.map((_, i) => open[i].plus(prof[i]).plus(ociRow[i]).plus(other[i]));
    soce = { columns: cols.map((c) => c.code), rows: [
      row('opening', 'Balance at start of period', open),
      row('profit', 'Profit for the period', prof),
      row('oci', 'Other comprehensive income', ociRow),
      row('owners', 'Transactions with owners and other movements', other),
      row('closing', 'Balance at end of period', close),
    ] };
    cols.forEach((c, i) => {
      if (!close[i].eq(sfp[c.code] ?? Z)) ex.push({ code: 'SOCE_DOES_NOT_TIE', severity: 'blocking', message: `${c.label}: changes in equity close at ${s2(close[i])} but financial position shows ${s2(sfp[c.code] ?? Z)}` });
    });
  }

  const noteAccounts: Record<string, string> = {};
  for (const list of [...Object.values(sfpAccounts), ...Object.values(plAccounts)]) for (const a of list) if (a.code !== '—') noteAccounts[a.code] = s2(a.value);

  const cfOut: Record<string, string> = Object.fromEntries(cfLines.map((x) => [x.key, s2(x.value)]));
  Object.assign(cfOut, { profit: s2(profitAll), operating: s2(profitAll.plus(sectionTotal('operating'))), investing: s2(sectionTotal('investing')),
    financing: s2(sectionTotal('financing')), net: s2(net), opening: s2(cashOpening), closing: s2(cashClosing) });

  return {
    values: { sfp: Object.fromEntries(Object.entries(sfp).map(([k, v]) => [k, s2(v)])), pl: plOut, cf: cfOut,
      cfLabels: Object.fromEntries(cfLines.map((x) => [x.key, x.label])), noteAccounts, soce },
    sfpAccounts, plAccounts, cfLines,
    cfFacts: { profit: profitAll, net, opening: cashOpening, closing: cashClosing, actual, difference },
    exceptions: ex, totals: { assets, equity, liabilities, profit: profitAll },
  };
}

/** Pull the comparable values out of a frozen (final) pack. */
function valuesFromPack(pack: any): PeriodValues {
  return pack.periodValues as PeriodValues;
}

// ───────────────────────────── Pack rendering ─────────────────────────────
function render(t: Template, ctx: { entity: any; period: any; fy: any; comparative: any; generatedAt: string; materiality: string },
                cur: Computed, cmp: PeriodValues | null, accountsById: Map<string, AccountRow>, exceptions: Exception[]) {
  const c = (o: Record<string, string> | undefined, k: string) => (o && o[k] !== undefined ? o[k] : null);
  let noteNo = 2; // 1 basis of preparation, 2 material accounting policies
  const notes: any[] = [
    { no: 1, title: 'Basis of preparation', kind: 'narrative', status: 'template',
      text: `These ${ctx.period.end === ctx.fy.end_date ? 'annual' : 'interim'} financial statements of ${ctx.entity.legal_name} have been prepared under ${t.framework === 'IFRS' ? 'IFRS Accounting Standards' : 'the IFRS for SMEs Accounting Standard'} on the historical cost basis, in ${ctx.entity.functional_currency}, rounded to two decimal places. [Template wording: the preparer must review, complete and confirm compliance before finalisation.]` },
    { no: 2, title: 'Material accounting policies', kind: 'narrative', status: 'template',
      text: 'Revenue from plot sales is recognised when control of the land passes to the buyer; deposits received before then are contract liabilities. Land held for resale and its development costs are inventories at the lower of cost and net realisable value. Property, plant and equipment is stated at cost less accumulated depreciation. Cash and cash equivalents comprise bank, mobile-money and petty-cash balances. [Template wording: the preparer must confirm each policy against IFRS and the entity\'s facts.]' },
  ];
  const noteFor = new Map<string, number>();
  const addNote = (key: string, title: string, accounts: { code: string; name: string; value: Decimal }[] | undefined, lineCurrent: string, lineComparative: string | null) => {
    const accCodes = new Set((accounts ?? []).map((a) => a.code).filter((c) => c !== '—'));
    if (cmp) for (const code of Object.keys(cmp.noteAccounts)) {
      const acc = [...accountsById.values()].find((a) => a.code === code);
      if (acc && (acc.statement_line_code ?? '') === key && !accCodes.has(code)) accCodes.add(code);
    }
    if (!accCodes.size && D(lineCurrent).eq(0) && (lineComparative === null || D(lineComparative).eq(0))) return;
    const lines = [...accCodes].sort().map((code) => {
      const a = (accounts ?? []).find((x) => x.code === code);
      const name = a?.name ?? [...accountsById.values()].find((x) => x.code === code)?.name ?? code;
      return { code, name, current: a ? s2(a.value) : '0.00', comparative: cmp ? (cmp.noteAccounts[code] ?? '0.00') : null };
    });
    const presentational = (accounts ?? []).find((a) => a.code === '—');
    if (presentational) {
      const otherCmp = lines.reduce((x, l) => x.plus(l.comparative ?? 0), Z);
      lines.push({ code: '', name: presentational.name, current: s2(presentational.value),
        comparative: lineComparative === null ? null : s2(D(lineComparative).minus(otherCmp)) });
    }
    const total = lines.reduce((s, l) => s.plus(l.current), Z);
    noteFor.set(key, ++noteNo);
    notes.push({ no: noteNo, title, kind: 'breakdown', statementLine: key, lines, total: s2(total), lineCurrent, lineComparative,
      castsToStatement: total.eq(lineCurrent) });
  };

  // Financial position
  const sfpSections = t.definition.sfp.map((s) => {
    const lines = s.lines.map((l) => ({ code: l.code, label: l.label, current: cur.values.sfp[l.code] ?? '0.00', comparative: cmp ? (cmp.sfp[l.code] ?? '0.00') : null }))
      .filter((l) => !D(l.current).eq(0) || (l.comparative !== null && !D(l.comparative).eq(0)));
    const unk = `__UNMAPPED_${s.side}`;
    if (s.key === t.definition.sfp.filter((x) => x.side === s.side).slice(-1)[0].key && (cur.values.sfp[unk] || c(cmp?.sfp, unk)))
      lines.push({ code: unk, label: 'Unmapped balances — to be classified', current: cur.values.sfp[unk] ?? '0.00', comparative: cmp ? (cmp.sfp[unk] ?? '0.00') : null });
    return { key: s.key, label: s.label, side: s.side, lines };
  }).filter((s) => s.lines.length);
  for (const s of sfpSections) for (const l of s.lines) if (!l.code.startsWith('__')) addNote(l.code, l.label, cur.sfpAccounts[l.code], l.current, l.comparative);
  for (const s of sfpSections) for (const l of s.lines) (l as any).note = noteFor.get(l.code) ?? null;
  const sumC = (side: Side, which: 'current' | 'comparative') => sfpSections.filter((s) => s.side === side).flatMap((s) => s.lines).reduce((x, l) => x.plus((l as any)[which] ?? 0), Z);
  const sfpTotals = (which: 'current' | 'comparative') => {
    const a = sumC('asset', which), e = sumC('equity', which), l = sumC('liability', which);
    return { assets: s2(a), equity: s2(e), liabilities: s2(l), equityAndLiabilities: s2(e.plus(l)) };
  };
  for (const s of sfpSections) (s as any).total = { current: s2(s.lines.reduce((x, l) => x.plus(l.current), Z)), comparative: cmp ? s2(s.lines.reduce((x, l) => x.plus(l.comparative ?? 0), Z)) : null };

  // Profit or loss
  const plLines = t.definition.pl.map((i) => {
    const key = i.code ?? i.subtotal!;
    return { key, kind: i.code ? 'line' : 'subtotal', label: i.label, current: cur.values.pl[key] ?? '0.00', comparative: cmp ? (cmp.pl[key] ?? '0.00') : null };
  }).filter((l) => l.kind === 'subtotal' || !D(l.current).eq(0) || (l.comparative !== null && !D(l.comparative).eq(0)));
  if (cur.values.pl.__UNMAPPED || cmp?.pl.__UNMAPPED) {
    const idx = plLines.findIndex((l) => l.key === 'profit');
    plLines.splice(idx, 0, { key: '__UNMAPPED', kind: 'line', label: 'Unmapped items — to be classified', current: cur.values.pl.__UNMAPPED ?? '0.00', comparative: cmp ? (cmp.pl.__UNMAPPED ?? '0.00') : null });
  }
  for (const l of plLines) if (l.kind === 'line' && !l.key.startsWith('__')) addNote(l.key, l.label, cur.plAccounts[l.key], l.current, l.comparative);
  for (const l of plLines) (l as any).note = noteFor.get(l.key) ?? null;

  // Cash flows
  const cfKeys = new Set([...cur.cfLines.map((x) => x.key), ...(cmp ? Object.keys(cmp.cf).filter((k) => k.includes(':')) : [])]);
  const cfSection = (sec: 'operating' | 'investing' | 'financing', label: string) => {
    const lines = [...cfKeys].map((k) => {
      const curLine = cur.cfLines.find((x) => x.key === k);
      const prefix = k.split(':')[0];
      const s = prefix === 'inv' ? 'investing' : prefix === 'fin' ? 'financing' : 'operating';
      if (s !== sec) return null;
      return { key: k, label: curLine?.label ?? cmp?.cfLabels?.[k] ?? k, current: curLine ? s2(curLine.value) : '0.00', comparative: cmp ? (cmp.cf[k] ?? '0.00') : null };
    }).filter(Boolean) as any[];
    if (sec === 'operating') lines.unshift({ key: 'profit', label: 'Profit for the period', current: cur.values.cf.profit, comparative: cmp ? cmp.cf.profit : null });
    return { key: sec, label, lines, total: { current: cur.values.cf[sec], comparative: cmp ? cmp.cf[sec] : null } };
  };
  const cf = {
    sections: [cfSection('operating', 'Cash flows from operating activities'), cfSection('investing', 'Cash flows from investing activities'), cfSection('financing', 'Cash flows from financing activities')],
    net: { current: cur.values.cf.net, comparative: cmp ? cmp.cf.net : null },
    opening: { current: cur.values.cf.opening, comparative: cmp ? cmp.cf.opening : null },
    closing: { current: cur.values.cf.closing, comparative: cmp ? cmp.cf.closing : null },
    difference: s2(cur.cfFacts.difference),
  };

  // Changes in equity
  const eqLines = t.definition.sfp.find((s) => s.side === 'equity')?.lines ?? [];
  const soce = cur.values.soce ? {
    columns: cur.values.soce.columns.map((code) => ({ code, label: eqLines.find((l) => l.code === code)?.label ?? code })),
    current: cur.values.soce.rows,
    comparative: cmp?.soce ? { columns: cmp.soce.columns, rows: cmp.soce.rows } : null,
  } : null;

  // Cross-checks
  const curT = sfpTotals('current');
  const checks = [
    { code: 'SFP_BALANCES', label: 'Total assets equal equity plus liabilities', passed: curT.assets === curT.equityAndLiabilities, detail: `${curT.assets} vs ${curT.equityAndLiabilities}` },
    { code: 'PL_TIES_TO_LEDGER', label: 'Profit or loss agrees with the ledger result for the period', passed: !exceptions.some((e) => e.code === 'PL_DOES_NOT_TIE'), detail: cur.values.pl.tci },
    { code: 'CF_RECONCILES', label: 'Net cash flow equals the movement in cash and cash equivalents', passed: cur.cfFacts.difference.eq(0), detail: `difference ${s2(cur.cfFacts.difference)}` },
    { code: 'SOCE_TIES', label: 'Changes in equity close at the equity shown in financial position', passed: !exceptions.some((e) => e.code === 'SOCE_DOES_NOT_TIE'), detail: '' },
    { code: 'NOTES_CAST', label: 'Every note totals to its statement line', passed: notes.filter((n) => n.kind === 'breakdown').every((n) => n.castsToStatement), detail: `${notes.filter((n) => n.kind === 'breakdown').length} notes` },
    { code: 'ALL_MAPPED', label: 'Every balance is mapped to a statement line', passed: !exceptions.some((e) => e.code === 'UNMAPPED_BALANCE' || e.code === 'UNKNOWN_LINE_CODE' || e.code === 'MAPPING_TYPE_MISMATCH'), detail: '' },
  ];
  for (const n of notes) if (n.kind === 'breakdown' && !n.castsToStatement) exceptions.push({ code: 'NOTE_DOES_NOT_CAST', severity: 'blocking', message: `Note ${n.no} ${n.title} totals ${n.total} but the statement shows ${n.lineCurrent}` });

  return {
    meta: {
      entity: { id: ctx.entity.id, code: ctx.entity.code, legalName: ctx.entity.legal_name, currency: ctx.entity.functional_currency, framework: t.framework },
      template: { id: t.id, code: t.code, version: t.version },
      periodEnd: ctx.period.end, periodName: ctx.period.name, financialYear: ctx.fy.label, fyStart: ctx.fy.start_date,
      isYearEnd: ctx.period.end === ctx.fy.end_date,
      comparative: ctx.comparative, generatedAt: ctx.generatedAt, materiality: ctx.materiality,
      source: 'Posted journal lines (ledger_postings) — drafts, submitted and approved journals excluded',
      disclaimer: 'Prepared by PEP ERP. Not audited. Not filed with any authority. Figures are drafts until the run is final.',
    },
    sfp: { sections: sfpSections, totals: { current: curT, comparative: cmp ? sfpTotals('comparative') : null } },
    pl: { lines: plLines, oci: { current: cur.values.pl.oci, comparative: cmp ? cmp.pl.oci : null }, tci: { current: cur.values.pl.tci, comparative: cmp ? cmp.pl.tci : null } },
    soce, cf, notes, checks,
    periodValues: cur.values,
  };
}

// ───────────────────────────── Orchestration ─────────────────────────────
async function loadTemplate(db: Db | Tx, framework: string): Promise<Template> {
  const r = await db.query(`SELECT * FROM report_templates WHERE framework = $1 AND is_active ORDER BY version DESC LIMIT 1`, [framework]);
  if (!r.rowCount) throw new DomainError('NO_TEMPLATE', `No active statement template for ${framework}`);
  return r.rows[0];
}

async function periodContext(db: Db | Tx, entityId: string, periodId: string) {
  const p = await db.query(
    `SELECT p.id, p.name, p.end_date AS end, p.status, fy.id AS fy_id, fy.label, fy.start_date, fy.end_date
       FROM accounting_periods p JOIN financial_years fy ON fy.id = p.financial_year_id WHERE p.id = $1 AND p.entity_id = $2`, [periodId, entityId]);
  if (!p.rowCount) throw new DomainError('NOT_FOUND', 'Period not found');
  const row = p.rows[0];
  const prior = await db.query(`SELECT * FROM financial_years WHERE entity_id = $1 AND end_date = $2`, [entityId, dayBefore(row.start_date)]);
  const open = await db.query(`SELECT count(*)::int AS n, string_agg(name, ', ' ORDER BY start_date) AS names FROM accounting_periods
                                WHERE financial_year_id = $1 AND end_date <= $2 AND status <> 'locked'`, [row.fy_id, row.end]);
  return { period: { id: row.id, name: row.name, end: row.end, status: row.status }, fy: { id: row.fy_id, label: row.label, start_date: row.start_date, end_date: row.end_date },
           prior: prior.rows[0] ?? null, openPeriods: open.rows[0] as { n: number; names: string | null } };
}

async function fingerprint(db: Db | Tx, entityId: string, periodEnd: string, templateId: string, materiality: string, comparativeRunId: string | null) {
  const l = await db.query(`SELECT count(*) AS n, COALESCE(sum(debit),0) AS dr, COALESCE(sum(credit),0) AS cr, max(posted_at)::text AS last
                              FROM ledger_postings WHERE entity_id = $1 AND journal_date <= $2`, [entityId, periodEnd]);
  const m = await db.query(`SELECT string_agg(id || ':' || COALESCE(statement_line_code,'') || ':' || cash_flow_class || ':' || account_type || ':' || normal_balance, '|' ORDER BY id) AS m
                              FROM accounts WHERE entity_id = $1`, [entityId]);
  return createHash('sha256').update(JSON.stringify([l.rows[0], m.rows[0].m, templateId, materiality, comparativeRunId])).digest('hex');
}

async function buildPack(db: Db | Tx, scope: EntityScope, periodId: string) {
  const ent = (await db.query('SELECT * FROM entities WHERE id = $1', [scope.entityId])).rows[0];
  const t = await loadTemplate(db, ent.reporting_framework);
  const ctx = await periodContext(db, scope.entityId, periodId);
  const accounts: AccountRow[] = (await db.query(
    `SELECT id, code, name, account_type, normal_balance, is_postable, statement_line_code, cash_flow_class FROM accounts WHERE entity_id = $1 ORDER BY code`,
    [scope.entityId])).rows;
  const materiality = new Decimal(ent.materiality_threshold);
  const facts = await loadFacts(db, scope.entityId, ctx.fy.start_date, ctx.period.end);
  const cur = compute(t, accounts, facts, materiality);
  const exceptions: Exception[] = [...cur.exceptions];

  // Comparatives: approved (final) snapshot of the prior year-end if one exists; otherwise live, with a warning.
  let cmp: PeriodValues | null = null;
  let comparative: any = null;
  let comparativeRunId: string | null = null;
  if (ctx.prior) {
    const priorEnd = ctx.prior.end_date;
    const isYearEnd = ctx.period.end === ctx.fy.end_date;
    const snap = (await db.query(
      `SELECT id, run_no, pack FROM financial_statement_runs WHERE entity_id = $1 AND period_end = $2 AND status = 'final'`, [scope.entityId, priorEnd])).rows[0];
    const bsCodes = new Set(accounts.filter((a) => isBS(a.account_type)).map((a) => a.code));
    const pick = (o: Record<string, string>, bs: boolean) => Object.fromEntries(Object.entries(o).filter(([code]) => bsCodes.has(code) === bs));
    // Prior year-end position: the final (frozen) pack when one exists, otherwise recomputed from the ledger.
    const ye: PeriodValues = snap ? valuesFromPack(snap.pack)
      : compute(t, accounts, await loadFacts(db, scope.entityId, ctx.prior.start_date, priorEnd), materiality).values;
    if (snap) comparativeRunId = snap.id;
    if (isYearEnd) {
      cmp = ye;
      comparative = { label: `FY${ctx.prior.label}`, periodEnd: priorEnd, source: snap ? 'approved_snapshot' : 'live_recomputed', runNo: snap?.run_no ?? null };
    } else {
      // Interim (IAS 34 pattern): financial position at the prior year-end; performance and cash flows for the same months of the prior year.
      const target = new Date(Date.parse(ctx.prior.start_date) + (Date.parse(ctx.period.end) - Date.parse(ctx.fy.start_date))).toISOString().slice(0, 10);
      const cmpPlEnd = (await db.query(`SELECT end_date FROM accounting_periods WHERE financial_year_id = $1 ORDER BY abs(end_date - $2::date) LIMIT 1`,
        [ctx.prior.id, target])).rows[0]?.end_date ?? priorEnd;
      const pc = compute(t, accounts, await loadFacts(db, scope.entityId, ctx.prior.start_date, cmpPlEnd), materiality).values;
      cmp = { ...pc, sfp: ye.sfp, soce: ye.soce, noteAccounts: { ...pick(pc.noteAccounts, false), ...pick(ye.noteAccounts, true) } };
      comparative = { label: `FY${ctx.prior.label}`, periodEnd: priorEnd, plPeriodEnd: cmpPlEnd,
        source: snap ? 'snapshot_and_ledger' : 'live_recomputed', runNo: snap?.run_no ?? null };
    }
    if (!snap) exceptions.push({ code: 'COMPARATIVE_NOT_FROM_APPROVED_SNAPSHOT', severity: 'warning',
      message: `Comparatives were recomputed from the ledger because no final statement run exists for FY${ctx.prior.label}.` });
  }
  if (ctx.openPeriods.n > 0) exceptions.push({ code: 'PERIODS_NOT_LOCKED', severity: 'blocking',
    message: `Final statements need every period to ${ctx.period.name} locked. Still open: ${ctx.openPeriods.names}.` });
  exceptions.push({ code: 'NARRATIVE_NOTES_TEMPLATE', severity: 'warning', message: 'Notes 1–2 contain template wording that the preparer must review.' });

  const pack = render(t, { entity: ent, period: ctx.period, fy: ctx.fy, comparative, generatedAt: new Date().toISOString(), materiality: s2(materiality) },
    cur, cmp, new Map(accounts.map((a) => [a.id, a])), exceptions);
  const fp = await fingerprint(db, scope.entityId, ctx.period.end, t.id, s2(materiality), comparativeRunId);
  return { pack, exceptions, template: t, ctx, fingerprint: fp, comparativeRunId };
}

// ───────────────────────────── Public API ─────────────────────────────
const RUN_COLS = `r.id, r.run_no, r.period_id, r.period_end, r.fy_label, r.status, r.blocking_count, r.content_hash, r.generated_at, r.submitted_at,
  r.approved_at, r.finalized_at, r.rejected_at, r.rejection_reason, r.supersedes_run_id, r.generated_by, r.submitted_by, r.approved_by, r.finalized_by,
  ug.full_name AS generated_by_name, us.full_name AS submitted_by_name, ua.full_name AS approved_by_name, uf.full_name AS finalized_by_name,
  ur.full_name AS rejected_by_name, t.code AS template_code, t.version AS template_version`;
const RUN_JOINS = `JOIN users ug ON ug.id = r.generated_by LEFT JOIN users us ON us.id = r.submitted_by LEFT JOIN users ua ON ua.id = r.approved_by
  LEFT JOIN users uf ON uf.id = r.finalized_by LEFT JOIN users ur ON ur.id = r.rejected_by JOIN report_templates t ON t.id = r.template_id`;

export async function listRuns(db: Db, scope: EntityScope) {
  requirePerm(scope, 'reports.read');
  return (await db.query(`SELECT ${RUN_COLS} FROM financial_statement_runs r ${RUN_JOINS} WHERE r.entity_id = $1 ORDER BY r.run_no DESC`, [scope.entityId])).rows;
}

export async function getRun(db: Db | Tx, scope: EntityScope, id: string) {
  requirePerm(scope, 'reports.read');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError('NOT_FOUND', 'Statement run not found');
  const r = await db.query(`SELECT ${RUN_COLS}, r.pack, r.exceptions FROM financial_statement_runs r ${RUN_JOINS} WHERE r.entity_id = $1 AND r.id = $2`, [scope.entityId, id]);
  if (!r.rowCount) throw new DomainError('NOT_FOUND', 'Statement run not found');
  return r.rows[0];
}

/** Compute without saving — used for previews and tests. */
export async function previewPack(db: Db, scope: EntityScope, periodId: string) {
  requirePerm(scope, 'reports.read');
  const b = await buildPack(db, scope, periodId);
  return { ...b.pack, exceptions: b.exceptions };
}

export async function generateRun(db: Db, scope: EntityScope, actor: Actor, periodId: string) {
  requirePerm(scope, 'statements.prepare');
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fsr:${scope.entityId}`]);
    const built = await buildPack(tx, scope, periodId);
    const blocking = built.exceptions.filter((e) => e.severity === 'blocking').length;
    const no = (await tx.query('SELECT COALESCE(max(run_no),0) + 1 AS n FROM financial_statement_runs WHERE entity_id = $1', [scope.entityId])).rows[0].n;
    const prev = await tx.query(`SELECT id FROM financial_statement_runs WHERE entity_id = $1 AND period_end = $2 AND status IN ('draft','under_review','approved')`,
      [scope.entityId, built.ctx.period.end]);
    const ins = await tx.query(
      `INSERT INTO financial_statement_runs (entity_id, run_no, period_id, period_end, fy_label, template_id, pack, exceptions, blocking_count,
                                             source_fingerprint, content_hash, generated_by, supersedes_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12) RETURNING id`,
      [scope.entityId, no, periodId, built.ctx.period.end, built.ctx.fy.label, built.template.id, JSON.stringify(built.pack), JSON.stringify(built.exceptions),
       blocking, built.fingerprint, actor.id, prev.rows[0]?.id ?? null]);
    for (const p of prev.rows) await tx.query(`UPDATE financial_statement_runs SET status = 'superseded' WHERE id = $1`, [p.id]);
    const run = await getRun(tx, scope, ins.rows[0].id);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'statements.generate', objectType: 'statement_run', objectId: run.id,
      after: { run_no: run.run_no, period_end: run.period_end, content_hash: run.content_hash, blocking_count: blocking, superseded: prev.rows.map((x) => x.id) } });
    return run;
  });
}

type RunAction = 'submit' | 'approve' | 'finalize' | 'return' | 'reject';
const RUN_TRANSITIONS: Record<RunAction, { from: string[]; to: string; permission: string }> = {
  submit:   { from: ['draft'], to: 'under_review', permission: 'statements.prepare' },
  approve:  { from: ['under_review'], to: 'approved', permission: 'statements.approve' },
  finalize: { from: ['approved'], to: 'final', permission: 'statements.finalize' },
  return:   { from: ['under_review', 'approved'], to: 'draft', permission: 'statements.approve' },
  reject:   { from: ['draft', 'under_review', 'approved'], to: 'rejected', permission: 'statements.approve' },
};

export async function transitionRun(db: Db, scope: EntityScope, actor: Actor, id: string, action: RunAction, opts: { reason?: string } = {}) {
  const t = RUN_TRANSITIONS[action];
  if (!t) throw new DomainError('UNKNOWN_ACTION', `Unknown action ${action}`);
  return withTx(db, async (tx) => {
    const cur = await tx.query('SELECT * FROM financial_statement_runs WHERE entity_id = $1 AND id = $2 FOR UPDATE', [scope.entityId, id]);
    if (!cur.rowCount) throw new DomainError('NOT_FOUND', 'Statement run not found');
    const run = cur.rows[0];
    if (!t.from.includes(run.status)) throw new DomainError('INVALID_STATUS_TRANSITION', `Cannot ${action} a run that is ${run.status}`);
    const ownWithdraw = action === 'reject' && run.status === 'draft' && run.generated_by === actor.id;
    if (!ownWithdraw) requirePerm(scope, t.permission);
    if ((action === 'reject' || action === 'return') && !opts.reason?.trim()) throw new DomainError('REASON_REQUIRED', `A reason is required to ${action}`);
    if ((action === 'approve' || action === 'finalize') && (run.generated_by === actor.id || run.submitted_by === actor.id)) {
      throw new DomainError('SEGREGATION_OF_DUTIES', `The preparer of statement run #${run.run_no} cannot ${action} it`);
    }
    if (action === 'approve' || action === 'finalize') {
      const tmpl = await tx.query('SELECT id FROM report_templates WHERE id = $1', [run.template_id]);
      const cmpId = run.pack?.meta?.comparative
        ? (await tx.query(`SELECT id FROM financial_statement_runs WHERE entity_id = $1 AND period_end = $2 AND status = 'final'`, [scope.entityId, run.pack.meta.comparative.periodEnd])).rows[0]?.id ?? null
        : null;
      const fp = await fingerprint(tx, scope.entityId, run.period_end, tmpl.rows[0].id, run.pack.meta.materiality, cmpId);
      if (fp !== run.source_fingerprint) throw new DomainError('STATEMENT_STALE', 'The ledger, account mappings or comparatives have changed since this run was generated. Generate a new run.');
    }
    if (action === 'finalize') {
      if (run.blocking_count > 0) throw new DomainError('STATEMENT_HAS_BLOCKING_EXCEPTIONS', `Run #${run.run_no} has ${run.blocking_count} blocking exception(s); resolve them and generate a new run`);
      const open = await tx.query(`SELECT count(*)::int AS n FROM accounting_periods p JOIN financial_years fy ON fy.id = p.financial_year_id
                                    WHERE p.entity_id = $1 AND fy.label = $2 AND p.end_date <= $3 AND p.status <> 'locked'`, [scope.entityId, run.fy_label, run.period_end]);
      if (open.rows[0].n > 0) throw new DomainError('PERIODS_NOT_LOCKED', 'Lock every period up to the statement date before finalising');
    }
    const sets = ['status = $1']; const params: unknown[] = [t.to];
    const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (action === 'submit') { add('submitted_by', actor.id); add('submitted_at', new Date()); }
    if (action === 'approve') { add('approved_by', actor.id); add('approved_at', new Date()); }
    if (action === 'finalize') { add('finalized_by', actor.id); add('finalized_at', new Date()); }
    if (action === 'return') { add('approved_by', null); add('approved_at', null); add('submitted_by', null); add('submitted_at', null); }
    if (action === 'reject') { add('rejected_by', actor.id); add('rejected_at', new Date()); add('rejection_reason', opts.reason!.trim()); }
    params.push(id);
    await tx.query(`UPDATE financial_statement_runs SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: `statements.${action}`, objectType: 'statement_run', objectId: id,
      before: { status: run.status }, after: { status: t.to, run_no: run.run_no, content_hash: run.content_hash }, reason: opts.reason ?? null });
    return getRun(tx, scope, id);
  });
}
