import { useState } from 'react';
import { money } from '../api';
import { Card, downloadCsv, E, Icon, useApi, useApp } from '../ui';

export default function Ledger() {
  const c = useApp();
  const { data: accounts } = useApi<any[]>(`${E(c)}/accounts`);
  const [acct, setAcct] = useState(c.params.accountId ?? '');
  const [from, setFrom] = useState(c.params.from ?? '2026-01-01');
  const [to, setTo] = useState(c.params.to ?? '2026-12-31');
  const { data: l, error } = useApi(acct ? `${E(c)}/ledger?accountId=${acct}&from=${from}&to=${to}` : null, [c.refreshKey]);
  const postable = (accounts ?? []).filter((a) => a.is_postable);
  return (
    <>
      <div className="page-head">
        <div><h1>General ledger</h1><div className="sub">Posted journal lines are the ledger — no separate balance table that could drift.</div></div>
        {l && <button className="btn" onClick={() => downloadCsv(`GL_${l.account.code}_${from}_${to}.csv`,
          ['Date', 'Journal', 'Description', 'Line description', 'Debit', 'Credit', 'Balance'],
          l.lines.map((x: any) => [x.journal_date, x.journal_no, x.journal_description, x.line_description, x.debit, x.credit, x.running_balance]),
          [`${c.entity.legal_name} — General ledger ${l.account.code} ${l.account.name}`, `Period ${from} to ${to}`, `Opening ${l.opening} Closing ${l.closing} (${l.account.normalBalance}-normal)`, `Generated ${l.parameters.generatedAt}`])}>
          <Icon n="download" size={15} />Export CSV</button>}
      </div>
      <div className="card" style={{ marginBottom: 16 }}><div className="card-b row">
        <label className="field" style={{ flex: 1, minWidth: 280 }}>Account
          <select className="input" value={acct} onChange={(e) => setAcct(e.target.value)}>
            <option value="">Select an account…</option>
            {postable.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select></label>
        <label className="field">From<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div></div>
      {error && <div className="alert block">{error}</div>}
      {!acct && <div className="card empty">Choose an account to see its ledger, or drill in from the trial balance.</div>}
      {l && (
        <Card title={<><span className="mono">{l.account.code}</span> {l.account.name}</>} right={<span className="sub">{l.account.accountType} · {l.account.normalBalance}-normal</span>} pad={false}>
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="t">
              <thead><tr><th>Date</th><th>Journal</th><th>Description</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                <tr className="grp"><td colSpan={6}>Opening balance at {from}</td><td className="num">{money(l.opening)}</td></tr>
                {l.lines.map((x: any) => (
                  <tr key={x.line_id} className="click" onClick={() => c.go('journals', { journalId: x.journal_id })}>
                    <td className="mono">{x.journal_date}</td><td className="mono">{x.journal_no}</td>
                    <td>{x.line_description ?? x.journal_description}{x.journal_type === 'reversal' && <span className="badge b-rejected" style={{ marginLeft: 6 }}>Reversal</span>}</td>
                    <td>{x.reference ?? ''}</td>
                    <td className="num">{money(x.debit, { blankZero: true })}</td><td className="num">{money(x.credit, { blankZero: true })}</td>
                    <td className="num">{money(x.running_balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Closing balance at {to}</td><td className="num">{money(l.totals.debit)}</td><td className="num">{money(l.totals.credit)}</td><td className="num">{money(l.closing)}</td></tr></tfoot>
            </table>
            {!l.lines.length && <div className="empty">No postings in this range.</div>}
          </div>
        </Card>
      )}
    </>
  );
}
