import { useEffect, useMemo, useState } from 'react';
import { api, fromMinor, money, toMinor } from '../api';
import { can, E, Icon, StatusBadge, useApi, useApp } from '../ui';

const STATUSES = ['all', 'draft', 'submitted', 'approved', 'posted', 'rejected'];

export default function Journals() {
  const c = useApp();
  const [status, setStatus] = useState(c.params.status ?? 'all');
  const [open, setOpen] = useState<string | null>(c.params.journalId ?? null);
  const [editing, setEditing] = useState<any | null>(c.params.new === '1' && can(c, 'journal.prepare') ? {} : null);
  const { data: list } = useApi<any[]>(`${E(c)}/journals${status === 'all' ? '' : `?status=${status}`}`, [c.refreshKey]);
  return (
    <>
      <div className="page-head">
        <div><h1>Journal entries</h1><div className="sub">Draft → Submitted → Approved → Posted. Posted entries are immutable; corrections go through linked reversals.</div></div>
        {can(c, 'journal.prepare') && <button className="btn gold" onClick={() => setEditing({})}><Icon n="plus" size={15} />New journal</button>}
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {STATUSES.map((s) => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
      </div>
      <div className="card tbl-wrap">
        <table className="t">
          <thead><tr><th>Date</th><th>Number</th><th>Description</th><th>Type</th><th>Prepared by</th><th className="num">Debit</th><th className="num">Credit</th><th>Status</th></tr></thead>
          <tbody>
            {list?.map((j) => (
              <tr key={j.id} className="click" onClick={() => setOpen(j.id)}>
                <td className="mono">{j.journal_date}</td>
                <td className="mono">{j.journal_no ?? <span style={{ color: '#94A3B8' }}>D-{j.draft_no}</span>}</td>
                <td>{j.description}{j.reversed_by_journal_id && <span className="badge b-rejected" style={{ marginLeft: 6 }}>Reversed</span>}</td>
                <td>{j.journal_type.replace('_', ' ')}</td>
                <td>{j.prepared_by_name}</td>
                <td className="num">{money(j.total_debit)}</td><td className="num">{money(j.total_credit)}</td>
                <td><StatusBadge s={j.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list && !list.length && <div className="empty">No journals with this status.</div>}
      </div>
      {open && <JournalDrawer id={open} onClose={() => setOpen(null)} onEdit={(j) => { setOpen(null); setEditing(j); }} onOpen={setOpen} />}
      {editing && <JournalEditor initial={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); setOpen(id); c.bump(); }} />}
    </>
  );
}

function JournalDrawer({ id, onClose, onEdit, onOpen }: { id: string; onClose: () => void; onEdit: (j: any) => void; onOpen: (id: string) => void }) {
  const c = useApp();
  const [j, setJ] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api(`${E(c)}/journals/${id}`).then(setJ).catch((e) => c.toast(e.message, true));
  useEffect(() => { load(); }, [id]);
  if (!j) return <div className="overlay" onClick={onClose}><div className="drawer"><div className="empty">Loading…</div></div></div>;

  const act = async (action: string, body?: any) => {
    setBusy(true);
    try {
      const r = await api(`${E(c)}/journals/${id}/${action}`, { method: 'POST', body });
      c.toast(action === 'reverse' ? `Reversal draft created — submit it for approval` : `Journal ${r.status}${r.journal_no ? ` as ${r.journal_no}` : ''}`);
      c.bump();
      if (action === 'reverse') onOpen(r.id); else load();
    } catch (e: any) { c.toast(e.message, true); } finally { setBusy(false); }
  };
  const mine = j.prepared_by === c.user.id;
  const sod = c.entity.segregation_enabled && mine;
  const steps = ['draft', 'submitted', 'approved', 'posted'];
  const reached = j.status === 'rejected' ? -1 : steps.indexOf(j.status);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-h">
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <h1 style={{ fontSize: 20 }}>{j.journal_no ?? `Draft D-${j.draft_no}`}</h1><StatusBadge s={j.status} />
              {j.status !== 'posted' && j.status !== 'rejected' && <span className="draft-mark">NOT POSTED</span>}
            </div>
            <div className="sub">{j.description}</div>
          </div>
          <button className="btn sm" onClick={onClose}><Icon n="x" size={14} /></button>
        </div>
        <div className="drawer-b">
          <div className="timeline">
            {steps.map((s, i) => <div key={s} className={`st ${i <= reached ? 'done' : ''}`}>{s[0].toUpperCase() + s.slice(1)}</div>)}
          </div>
          {j.status === 'rejected' && <div className="alert block"><Icon n="x" size={15} />Rejected: {j.rejection_reason}</div>}
          {j.reverses_journal_no && <div className="alert info"><Icon n="rev" size={15} />Reverses <a href="#" onClick={(e) => { e.preventDefault(); onOpen(j.reverses_journal_id); }}>{j.reverses_journal_no}</a></div>}
          {j.auto_reverse_date && !j.reversed_by_journal_id && <div className="alert info"><Icon n="rev" size={15} />Reverses automatically on {j.auto_reverse_date} when posted</div>}
          {j.reversed_by_journal_id && <div className="alert warn"><Icon n="rev" size={15} />Reversed by <a href="#" onClick={(e) => { e.preventDefault(); onOpen(j.reversed_by_journal_id); }}>{j.reversed_by_journal_no ?? 'reversal journal'}</a></div>}
          <div className="kv">
            <div><label>Date</label><span className="mono">{j.journal_date}</span></div>
            <div><label>Period</label>{j.period_name} <span className={`badge b-${j.period_status}`}>{j.period_status}</span></div>
            <div><label>Type</label>{j.journal_type.replace('_', ' ')}</div>
            <div><label>Reference</label>{j.reference ?? '—'}</div>
            <div><label>Currency</label>{j.currency} @ {Number(j.fx_rate)}</div>
            <div><label>Prepared</label>{j.prepared_by_name}</div>
            <div><label>Approved</label>{j.approved_by_name ?? '—'}</div>
            <div><label>Posted</label>{j.posted_by_name ? `${j.posted_by_name}` : '—'}</div>
          </div>
          <table className="t">
            <thead><tr><th>#</th><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {j.lines.map((l: any) => (
                <tr key={l.id} className="click" onClick={() => c.go('ledger', { accountId: l.account_id })}>
                  <td>{l.line_no}</td><td><span className="mono">{l.account_code}</span> {l.account_name}</td>
                  <td>{l.description ?? ''}</td><td className="num">{money(l.debit, { blankZero: true })}</td><td className="num">{money(l.credit, { blankZero: true })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total {j.totals.balanced ? 'balanced' : 'out of balance'}</td><td className="num">{money(j.totals.debit)}</td><td className="num">{money(j.totals.credit)}</td></tr></tfoot>
          </table>

          <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            {j.status === 'draft' && mine && j.journal_type !== 'reversal' && <button className="btn" disabled={busy} onClick={() => onEdit(j)}>Edit</button>}
            {j.status === 'draft' && mine && <button className="btn danger" disabled={busy} onClick={() => act('reject', { reason: 'Withdrawn by preparer' })}>Withdraw</button>}
            {j.status === 'draft' && can(c, 'journal.prepare') && mine && <button className="btn primary" disabled={busy} onClick={() => act('submit')}>Submit for approval</button>}
            {['submitted', 'approved'].includes(j.status) && can(c, 'journal.approve') && !sod && <>
              <button className="btn danger" disabled={busy} onClick={() => { const r = prompt('Reason for rejection'); if (r) act('reject', { reason: r }); }}>Reject</button>
              <button className="btn" disabled={busy} onClick={() => act('return')}>Return to preparer</button>
            </>}
            {j.status === 'submitted' && can(c, 'journal.approve') && (sod ? <span className="badge b-warn">You prepared this — another approver must approve</span>
              : <button className="btn green" disabled={busy} onClick={() => act('approve')}><Icon n="check" size={14} />Approve</button>)}
            {j.status === 'approved' && can(c, 'journal.post') && (sod ? <span className="badge b-warn">Segregation of duties: you cannot post your own journal</span>
              : <button className="btn green" disabled={busy || j.period_status !== 'open'} onClick={() => act('post')}><Icon n="check" size={14} />Post to ledger</button>)}
            {j.status === 'posted' && !j.reversed_by_journal_id && j.journal_type !== 'reversal' && can(c, 'journal.prepare') &&
              <button className="btn" disabled={busy} onClick={() => {
                const reason = prompt('Reason for reversal (recorded in the audit trail)'); if (!reason) return;
                const reversalDate = prompt('Reversal date (YYYY-MM-DD, must be in an open period)', new Date().toISOString().slice(0, 10)); if (!reversalDate) return;
                act('reverse', { reason, reversalDate });
              }}><Icon n="rev" size={14} />Reverse</button>}
          </div>
          {j.status === 'approved' && j.period_status !== 'open' && <div className="alert block" style={{ marginTop: 12 }}>Period {j.period_name} is locked — a controller must re-open it before posting.</div>}
        </div>
      </div>
    </div>
  );
}

interface Row { account: string; description: string; debit: string; credit: string }
const blank = (): Row => ({ account: '', description: '', debit: '', credit: '' });

function JournalEditor({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: (id: string) => void }) {
  const c = useApp();
  const { data: accounts } = useApi<any[]>(`${E(c)}/accounts`);
  const postable = useMemo(() => (accounts ?? []).filter((a) => a.is_postable && a.is_active), [accounts]);
  const byLabel = useMemo(() => new Map(postable.flatMap((a) => [[`${a.code} — ${a.name}`, a], [a.code, a]])), [postable]);
  const [date, setDate] = useState(initial.journal_date ?? new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState(initial.description ?? '');
  const [ref, setRef] = useState(initial.reference ?? '');
  // Foreign currency (decision D5): only offered once a controller has enabled a currency.
  const fn = c.entity.functional_currency;
  const { data: cur } = useApi<any>(`${E(c)}/currencies`);
  const ccys: string[] = [fn, ...((cur?.enabled ?? []).map((x: any) => x.code))];
  const [ccy, setCcy] = useState<string>(initial.currency ?? fn);
  const [rate, setRate] = useState<string>(initial.currency && initial.currency !== fn ? String(Number(initial.fx_rate)) : '');
  const [rateTyped, setRateTyped] = useState(!!initial.id);
  useEffect(() => {
    if (ccy === fn || rateTyped || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let live = true;
    api(`${E(c)}/exchange-rates/lookup?currency=${ccy}&date=${date}`).then((r: any) => { if (live) setRate(r.rate ? String(Number(r.rate)) : ''); }).catch(() => {});
    return () => { live = false; };
  }, [ccy, date, rateTyped]);
  const [type, setType] = useState(initial.journal_type ?? 'manual');
  const ADJ = ['accrual', 'prepayment', 'correction'];
  const [adj, setAdj] = useState<boolean>(initial.is_adjustment ?? ADJ.includes(initial.journal_type ?? 'manual'));
  // First day of the month after `d` — where a month-end accrual normally reverses.
  const nextMonth = (d: string) => { const [y, m] = d.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };
  const [rev, setRev] = useState<string>(initial.auto_reverse_date ?? '');
  const [rows, setRows] = useState<Row[]>(initial.lines?.map((l: any) => ({
    account: `${l.account_code} — ${l.account_name}`, description: l.description ?? '',
    debit: Number(l.txn_debit) ? l.txn_debit : '', credit: Number(l.txn_credit) ? l.txn_credit : '' })) ?? [blank(), blank(), blank()]);
  const [busy, setBusy] = useState(false);

  const set = (i: number, k: keyof Row, v: string) => setRows((r) => {
    const n = r.map((x, j) => j === i ? { ...x, [k]: v, ...(k === 'debit' && v ? { credit: '' } : {}), ...(k === 'credit' && v ? { debit: '' } : {}) } : x);
    if (i === n.length - 1 && v) n.push(blank());
    return n;
  });
  const used = rows.filter((r) => r.account || r.debit || r.credit);
  const dr = used.reduce((t, r) => t + (toMinor(r.debit) ?? 0n), 0n);
  const cr = used.reduce((t, r) => t + (toMinor(r.credit) ?? 0n), 0n);
  const invalid = used.some((r) => toMinor(r.debit) === null || toMinor(r.credit) === null || !byLabel.get(r.account.trim()));

  const save = async (submit: boolean) => {
    setBusy(true);
    try {
      const body = { journalDate: date, description: desc, reference: ref || null, currency: ccy, ...(ccy !== fn ? { fxRate: rate || undefined } : {}), journalType: type, isAdjustment: type === 'opening_balance' ? false : adj, autoReverseDate: type === 'opening_balance' ? null : rev || null,
        lines: used.map((r) => ({ accountId: byLabel.get(r.account.trim())?.id, description: r.description || null, debit: r.debit || null, credit: r.credit || null })),
        ...(initial.id ? { expectedVersion: initial.version } : {}) };
      const j = initial.id ? await api(`${E(c)}/journals/${initial.id}`, { method: 'PUT', body }) : await api(`${E(c)}/journals`, { method: 'POST', body });
      if (submit) await api(`${E(c)}/journals/${j.id}/submit`, { method: 'POST' });
      c.toast(submit ? 'Submitted for approval' : 'Draft saved');
      onSaved(j.id);
    } catch (e: any) { c.toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" style={{ width: 'min(1040px, 98vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-h"><div><h1 style={{ fontSize: 20 }}>{initial.id ? `Edit draft D-${initial.draft_no}` : 'New journal'}</h1>
          <div className="sub">Type an account code or name. Tab across cells; a new row appears as you type. Amounts in {ccy}{ccy !== fn ? `, converted to ${fn} at the rate shown` : ''}.</div></div>
          <button className="btn sm" onClick={onClose}><Icon n="x" size={14} /></button></div>
        <div className="drawer-b">
          <div className="row" style={{ marginBottom: 16 }}>
            <label className="field" style={{ width: 160 }}>Date<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="field" style={{ flex: 1, minWidth: 260 }}>Description<input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Plot sales — October" /></label>
            <label className="field" style={{ width: 160 }}>Reference<input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Invoice / deed no." /></label>
            {ccys.length > 1 && <>
              <label className="field" style={{ width: 110 }}>Currency<select className="input" value={ccy} onChange={(e) => { setCcy(e.target.value); setRateTyped(false); }}>
                {ccys.map((x) => <option key={x}>{x}</option>)}</select></label>
              {ccy !== fn && <label className="field" style={{ width: 150 }}>{fn} per 1 {ccy}<input className="input mono" inputMode="decimal" value={rate} placeholder="No rate recorded"
                onChange={(e) => { setRate(e.target.value); setRateTyped(true); }} /></label>}
            </>}
            <label className="field" style={{ width: 170 }}>Type<select className="input" value={type} onChange={(e) => { const t = e.target.value; setType(t); setAdj(ADJ.includes(t)); if (t === 'accrual' && !rev && /^\d{4}-\d{2}-\d{2}$/.test(date)) setRev(nextMonth(date)); if (t === 'opening_balance') setRev(''); }}>
              {['manual', 'opening_balance', 'accrual', 'prepayment', 'correction'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></label>
            <label className="field" style={{ width: 170, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-end', minHeight: 40 }}
                   title="Adjusting entries (accruals, prepayments, depreciation, audit adjustments) are shown separately in the adjusted trial balance">
              <input type="checkbox" checked={type !== 'opening_balance' && adj} disabled={type === 'opening_balance'} onChange={(e) => setAdj(e.target.checked)} />Adjusting entry</label>
            <label className="field" style={{ width: 190 }} title="When this journal is posted, its reversal is posted automatically on this date (for example, an accrual reversing on the 1st)">Reverse automatically on
              <input className="input" type="date" value={rev} min={date} disabled={type === 'opening_balance'} onChange={(e) => setRev(e.target.value)} /></label>
          </div>
          <datalist id="acct-list">{postable.map((a) => <option key={a.id} value={`${a.code} — ${a.name}`} />)}</datalist>
          <table className="grid-ed">
            <thead><tr><th>#</th><th style={{ width: '38%' }}>Account</th><th>Line description</th><th style={{ width: 150, textAlign: 'right' }}>Debit</th><th style={{ width: 150, textAlign: 'right' }}>Credit</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const badAcct = r.account && !byLabel.get(r.account.trim());
                return (
                  <tr key={i}>
                    <td className="idx">{i + 1}</td>
                    <td style={badAcct ? { background: '#FDECEC' } : {}}><input list="acct-list" value={r.account} onChange={(e) => set(i, 'account', e.target.value)} placeholder={i === 0 ? '1100 — Cash at bank…' : ''} /></td>
                    <td><input value={r.description} onChange={(e) => set(i, 'description', e.target.value)} /></td>
                    <td style={toMinor(r.debit) === null ? { background: '#FDECEC' } : {}}><input className="num mono" value={r.debit} onChange={(e) => set(i, 'debit', e.target.value)} inputMode="decimal" /></td>
                    <td style={toMinor(r.credit) === null ? { background: '#FDECEC' } : {}}><input className="num mono" value={r.credit} onChange={(e) => set(i, 'credit', e.target.value)} inputMode="decimal" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="diff-bar">
            <span>Debits <b className="mono">{money(fromMinor(dr))}</b></span>
            <span>Credits <b className="mono">{money(fromMinor(cr))}</b></span>
            <span className={dr === cr && dr > 0n ? 'ok' : 'bad'}>{dr === cr && dr > 0n ? 'Balanced' : `Difference ${money(fromMinor(dr - cr < 0n ? cr - dr : dr - cr))}`}</span>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
            <span className="sub" style={{ marginRight: 'auto' }}>Drafts may be saved unbalanced. Submission requires a balanced entry in an open period.</span>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={busy || invalid || !desc || used.length < 2} onClick={() => save(false)}>Save draft</button>
            <button className="btn primary" disabled={busy || invalid || !desc || dr !== cr || dr === 0n} onClick={() => save(true)}>Save & submit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
