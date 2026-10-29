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
  const q = `${E(c)}/trial-balance?basis=${basis}${periodId ? `&periodId=${periodId}` : ''}`;
  const { data: tb, error } = useApi(q, [c.refreshKey]);
  const ccy = c.entity.functional_currency;

  const exportCsv = () => tb && downloadCsv(`TB_${c.entity.code}_${tb.parameters.periodName.replace(' ', '')}_${basis}.csv`,
    ['Code', 'Account', 'Type', 'Opening Dr', 'Opening Cr', 'Movement Dr', 'Movement Cr', 'Closing Dr', 'Closing Cr'],
    [...tb.rows.map((r: any) => [r.code, r.name, r.accountType, r.opening.debit, r.opening.credit, r.movement.debit, r.movement.credit, r.closing.debit, r.closing.credit]),
     ['', 'TOTAL', '', tb.totals.opening.debit, tb.totals.opening.credit, tb.totals.movement.debit, tb.totals.movement.credit, tb.totals.closing.debit, tb.totals.closing.credit]],
    [`${c.entity.legal_name} — Trial balance (${basis === 'ytd' ? 'year to date' : 'period'})`, `${tb.parameters.from} to ${tb.parameters.to} · ${ccy} · period ${tb.parameters.periodStatus}`,
     `Source: ${tb.parameters.source} · Generated ${tb.parameters.generatedAt}`, 'DRAFT — NOT REVIEWED · NOT AUDITED']);

  return (
    <>
      <div className="page-head">
        <div><h1>Trial balance</h1><div className="sub">Unadjusted trial balance derived from posted journal lines. Click any account to drill into its ledger.</div></div>
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
        {tb && <div className="sub" style={{ marginLeft: 'auto', textAlign: 'right' }}>{tb.parameters.from} → {tb.parameters.to} · {ccy}<br />Generated {new Date(tb.parameters.generatedAt).toLocaleString()}</div>}
      </div></div>

      {error && <div className="alert block">{error}</div>}
      {tb?.exceptions.map((x: any, i: number) => (
        <div key={i} className={`alert ${x.severity === 'blocking' ? 'block' : 'warn'}`}><Icon n="alert" size={15} /><span><b>{x.code.replace(/_/g, ' ')}</b> — {x.message}</span></div>
      ))}
      {tb && (
        <div className="card tbl-wrap" style={{ marginTop: 8 }}>
          <table className="t">
            <thead>
              <tr><th rowSpan={2}>Code</th><th rowSpan={2}>Account</th><th colSpan={2} className="num" style={{ textAlign: 'center' }}>Opening</th><th colSpan={2} style={{ textAlign: 'center' }}>Movement</th><th colSpan={2} style={{ textAlign: 'center' }}>Closing</th></tr>
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
                      <td className="num">{money(r.opening.debit, { blankZero: true })}</td><td className="num">{money(r.opening.credit, { blankZero: true })}</td>
                      <td className="num">{money(r.movement.debit, { blankZero: true })}</td><td className="num">{money(r.movement.credit, { blankZero: true })}</td>
                      <td className="num">{money(r.closing.debit, { blankZero: true })}</td><td className="num">{money(r.closing.credit, { blankZero: true })}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td>
              <td className="num">{money(tb.totals.opening.debit)}</td><td className="num">{money(tb.totals.opening.credit)}</td>
              <td className="num">{money(tb.totals.movement.debit)}</td><td className="num">{money(tb.totals.movement.credit)}</td>
              <td className="num">{money(tb.totals.closing.debit)}</td><td className="num">{money(tb.totals.closing.credit)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </>
  );
}
