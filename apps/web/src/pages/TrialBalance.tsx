import { useMemo, useState } from 'react';
import { money } from '../api';
import { downloadCsv, E, Icon, useApi, useApp } from '../ui';

const GROUPS = [['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity'], ['revenue', 'Revenue'], ['expense', 'Expenses']];

export default function TrialBalance() {
  const c = useApp();
  const { data: fys } = useApi<any[]>(`${E(c)}/periods`);
  const periods = useMemo(() => (fys ?? []).flatMap((f) => f.periods.map((p: any) => ({ ...p, fy: f.label }))).reverse(), [fys]);
  const [periodId, setPeriodId] = useState(c.params.periodId ?? '');
  const [basis, setBasis] = useState<'ytd' | 'period'>('ytd');
  const [view, setView] = useState<'movement' | 'adjusted'>(c.params.view === 'adjusted' ? 'adjusted' : 'movement');
  const adjusted = view === 'adjusted';
  // Column pairs: movement view = Opening | Movement | Closing; adjusted view = Unadjusted | Adjustments | Adjusted.
  const cols: [string, string][] = adjusted ? [['Unadjusted', 'unadjusted'], ['Adjustments', 'adjustments'], ['Adjusted', 'closing']]
    : [['Opening', 'opening'], ['Movement', 'movement'], ['Closing', 'closing']];
  const q = `${E(c)}/trial-balance?basis=${basis}${periodId ? `&periodId=${periodId}` : ''}`;
  const { data: tb, error } = useApi(q, [c.refreshKey]);
  const ccy = c.entity.functional_currency;

  const exportCsv = () => tb && downloadCsv(`TB_${c.entity.code}_${tb.parameters.periodName.replace(' ', '')}_${basis}${adjusted ? '_adjusted' : ''}.csv`,
    ['Code', 'Account', 'Type', ...cols.flatMap(([l]) => [`${l} Dr`, `${l} Cr`])],
    [...tb.rows.map((r: any) => [r.code, r.name, r.accountType, ...cols.flatMap(([, k]) => [r[k].debit, r[k].credit])]),
     ['', 'TOTAL', '', ...cols.flatMap(([, k]) => [tb.totals[k].debit, tb.totals[k].credit])]],
    [`${c.entity.legal_name} — ${adjusted ? 'Adjusted trial balance' : 'Trial balance'} (${basis === 'ytd' ? 'year to date' : 'period'})`, `${tb.parameters.from} to ${tb.parameters.to} · ${ccy} · period ${tb.parameters.periodStatus}`,
     `Source: ${tb.parameters.source} · Generated ${tb.parameters.generatedAt}`, 'DRAFT — NOT REVIEWED · NOT AUDITED']);

  return (
    <>
      <div className="page-head">
        <div><h1>Trial balance</h1><div className="sub">{adjusted ? 'Unadjusted balance + adjusting entries in the window = adjusted balance.' : 'Derived from posted journal lines.'} Click any account to drill into its ledger.</div></div>
        <div className="row">
          {tb && <span className={`badge ${tb.balanced ? 'b-posted' : 'b-rejected'}`} style={{ padding: '7px 12px' }}>
            <Icon n={tb.balanced ? 'check' : 'alert'} size={14} />{tb.balanced ? 'Balanced' : 'OUT OF BALANCE'}</span>}
          <button className="btn" onClick={exportCsv} disabled={!tb}><Icon n="download" size={15} />Export CSV</button>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}><div className="card-b row">
        <label className="field" style={{ minWidth: 220 }}>Period
          <select className="input" value={periodId || tb?.parameters.periodId || ''} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name} (FY{p.fy}){p.status === 'locked' ? ' (locked)' : ''}</option>)}
          </select></label>
        <div className="field">Basis<div className="chips">
          <button className={`chip ${basis === 'ytd' ? 'on' : ''}`} onClick={() => setBasis('ytd')}>Year to date</button>
          <button className={`chip ${basis === 'period' ? 'on' : ''}`} onClick={() => setBasis('period')}>Period only</button></div></div>
        <div className="field">View<div className="chips">
          <button className={`chip ${!adjusted ? 'on' : ''}`} aria-pressed={!adjusted} onClick={() => setView('movement')}>Movement</button>
          <button className={`chip ${adjusted ? 'on' : ''}`} aria-pressed={adjusted} onClick={() => setView('adjusted')}>Adjusted</button></div></div>
        {tb && <div className="sub" style={{ marginLeft: 'auto', textAlign: 'right' }}>{tb.parameters.from} → {tb.parameters.to} · {ccy}<br />Generated {new Date(tb.parameters.generatedAt).toLocaleString()}</div>}
      </div></div>

      {error && <div className="alert block">{error}</div>}
      {tb?.exceptions.map((x: any, i: number) => (
        <div key={i} className={`alert ${x.severity === 'blocking' ? 'block' : 'warn'}`}><Icon n="alert" size={15} /><span><b>{x.code.replace(/_/g, ' ')}</b> — {x.message}</span></div>
      ))}
      {tb && (
        <div className="card tbl-wrap" style={{ marginTop: 8 }} tabIndex={0} role="region" aria-label="Trial balance table (scrolls sideways on small screens)">
          <table className="t">
            <thead>
              <tr><th rowSpan={2}>Code</th><th rowSpan={2}>Account</th>{cols.map(([l]) => <th key={l} colSpan={2} style={{ textAlign: 'center' }}>{l}</th>)}</tr>
              <tr><th className="num">Debit</th><th className="num">Credit</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Debit</th><th className="num">Credit</th></tr>
            </thead>
            <tbody>
              {GROUPS.map(([g, label]) => {
                const rows = tb.rows.filter((r: any) => r.accountType === g);
                if (!rows.length) return null;
                return [
                  <tr key={g} className="grp"><td colSpan={8}>{label}</td></tr>,
                  ...rows.map((r: any) => (
                    <tr key={r.code + r.synthetic} className={r.synthetic ? 'synthetic' : 'click'} onClick={() => !r.synthetic && c.go('ledger', { accountId: r.accountId, from: tb.parameters.from, to: tb.parameters.to })}
                        title={r.synthetic ? 'System-computed: prior-year profit/loss not yet closed to retained earnings' : 'Open ledger'}>
                      <td className="code">{r.code}</td>
                      <td>{r.name}{!r.statementLineCode && !r.synthetic && <span className="badge b-warn" style={{ marginLeft: 6 }}>Unmapped</span>}</td>
                      {cols.map(([, k]) => [<td key={k + 'd'} className="num">{money(r[k].debit, { blankZero: true })}</td>, <td key={k + 'c'} className="num">{money(r[k].credit, { blankZero: true })}</td>])}
                    </tr>
                  )),
                ];
              })}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td>
              {cols.map(([, k]) => [<td key={k + 'd'} className="num">{money(tb.totals[k].debit)}</td>, <td key={k + 'c'} className="num">{money(tb.totals[k].credit)}</td>])}</tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}
