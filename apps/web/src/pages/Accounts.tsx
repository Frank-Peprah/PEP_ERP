import { useState } from 'react';
import { api } from '../api';
import { can, E, Icon, useApi, useApp } from '../ui';

const LINES = ['SFP_CASH', 'SFP_RECEIVABLES', 'SFP_INVENTORY', 'SFP_PREPAYMENTS', 'SFP_PPE', 'SFP_PAYABLES', 'SFP_CONTRACT_LIAB', 'SFP_ACCRUALS',
  'SFP_BORROWINGS', 'EQ_CAPITAL', 'EQ_RETAINED', 'PL_REVENUE', 'PL_COST_OF_SALES', 'PL_SELLING_EXP', 'PL_ADMIN_EXP', 'PL_FINANCE_COST'];

export default function Accounts() {
  const c = useApp();
  const { data: accts } = useApi<any[]>(`${E(c)}/accounts`, [c.refreshKey]);
  const [form, setForm] = useState<any | null>(null);
  const manage = can(c, 'coa.manage');
  const headers = (accts ?? []).filter((a) => !a.is_postable);

  const save = async () => {
    try {
      if (form.id) await api(`${E(c)}/accounts/${form.id}`, { method: 'PATCH', body: { name: form.name, statementLineCode: form.statementLineCode || null, cashFlowClass: form.cashFlowClass, requiresReconciliation: form.requiresReconciliation } });
      else await api(`${E(c)}/accounts`, { method: 'POST', body: { ...form, statementLineCode: form.statementLineCode || null } });
      c.toast('Account saved'); setForm(null); c.bump();
    } catch (e: any) { c.toast(e.message, true); }
  };
  const toggle = async (a: any) => {
    try { await api(`${E(c)}/accounts/${a.id}`, { method: 'PATCH', body: { isActive: !a.is_active } }); c.toast(a.is_active ? 'Account deactivated' : 'Account reactivated'); c.bump(); }
    catch (e: any) { c.toast(e.message, true); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Chart of accounts</h1><div className="sub">Accounts with posted activity can be deactivated but never deleted; their code and type are frozen by the database.</div></div>
        {manage && <button className="btn gold" onClick={() => setForm({ code: '', name: '', accountType: 'expense', parentCode: '6000', cashFlowClass: 'none', statementLineCode: '' })}><Icon n="plus" size={15} />New account</button>}
      </div>
      {form && (
        <div className="card" style={{ marginBottom: 16 }}><div className="card-b">
          <div className="row">
            <label className="field" style={{ width: 110 }}>Code<input className="input mono" disabled={!!form.id} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
            <label className="field" style={{ flex: 1, minWidth: 220 }}>Name<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">Type<select className="input" disabled={!!form.id} value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })}>
              {['asset', 'liability', 'equity', 'revenue', 'expense'].map((t) => <option key={t}>{t}</option>)}</select></label>
            {!form.id && <label className="field">Parent<select className="input" value={form.parentCode} onChange={(e) => setForm({ ...form, parentCode: e.target.value })}>
              {headers.map((h) => <option key={h.id} value={h.code}>{h.code} {h.name}</option>)}</select></label>}
            <label className="field">Statement line<select className="input" value={form.statementLineCode ?? ''} onChange={(e) => setForm({ ...form, statementLineCode: e.target.value })}>
              <option value="">— unmapped —</option>{LINES.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label className="field">Cash flow<select className="input" value={form.cashFlowClass} onChange={(e) => setForm({ ...form, cashFlowClass: e.target.value })}>
              {['none', 'cash', 'operating', 'investing', 'financing', 'non_cash'].map((t) => <option key={t}>{t}</option>)}</select></label>
            <button className="btn" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!form.code || !form.name}>Save</button>
          </div>
        </div></div>
      )}
      <div className="card tbl-wrap">
        <table className="t">
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Normal</th><th>Statement line</th><th>Cash flow</th><th>Flags</th><th></th></tr></thead>
          <tbody>
            {accts?.map((a) => !a.is_postable ? (
              <tr key={a.id} className="grp"><td className="code">{a.code}</td><td colSpan={7}>{a.name}</td></tr>
            ) : (
              <tr key={a.id} style={a.is_active ? {} : { opacity: .5 }}>
                <td className="code">{a.code}</td>
                <td className="click" style={{ cursor: 'pointer' }} onClick={() => c.go('ledger', { accountId: a.id })}>{a.name}</td>
                <td>{a.account_type}</td><td>{a.normal_balance}</td>
                <td className="mono" style={{ fontSize: 12 }}>{a.statement_line_code ?? <span className="badge b-warn">Unmapped</span>}</td>
                <td>{a.cash_flow_class === 'none' ? '' : a.cash_flow_class}</td>
                <td>{a.requires_reconciliation && <span className="badge b-approved">Reconcile</span>} {a.has_activity && <span className="badge b-draft">Activity</span>} {!a.is_active && <span className="badge b-rejected">Inactive</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{manage && <>
                  <button className="btn sm" onClick={() => setForm({ id: a.id, code: a.code, name: a.name, accountType: a.account_type, statementLineCode: a.statement_line_code ?? '', cashFlowClass: a.cash_flow_class, requiresReconciliation: a.requires_reconciliation })}>Edit</button>{' '}
                  <button className="btn sm" onClick={() => toggle(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
