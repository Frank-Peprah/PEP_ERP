import { api } from '../api';
import { can, Card, E, Icon, useApi, useApp } from '../ui';

export default function Periods() {
  const c = useApp();
  const { data: fys } = useApi<any[]>(`${E(c)}/periods`, [c.refreshKey]);
  const act = async (p: any, action: 'lock' | 'reopen') => {
    let reason: string | null = null;
    if (action === 'reopen') { reason = prompt(`Reason for re-opening ${p.name} (recorded in the audit trail)`); if (!reason) return; }
    try { await api(`${E(c)}/periods/${p.id}/${action}`, { method: 'POST', body: { reason } }); c.toast(`${p.name} ${action === 'lock' ? 'locked' : 're-opened'}`); c.bump(); }
    catch (e: any) { c.toast(e.message, true); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Periods & close</h1>
        <div className="sub">Locking a period blocks all postings into it. Re-opening needs the controller role and a reason, and is permanently logged.</div></div></div>
      <div className="grid" style={{ gap: 16 }}>
        {fys?.map((fy) => (
          <Card key={fy.id} title={`Financial year ${fy.label}`} right={<span className="sub">{fy.start_date} → {fy.end_date}</span>} pad={false}>
            <div className="tbl-wrap" style={{ marginTop: 12 }}>
              <table className="t">
                <thead><tr><th>#</th><th>Period</th><th>Dates</th><th>Status</th><th className="num">Posted journals</th><th className="num">Unposted</th><th>Locked by</th><th></th></tr></thead>
                <tbody>
                  {fy.periods.map((p: any) => (
                    <tr key={p.id}>
                      <td>{p.period_no}</td><td><b>{p.name}</b></td><td className="mono">{p.start_date} → {p.end_date}</td>
                      <td><span className={`badge b-${p.status}`}><Icon n={p.status === 'locked' ? 'lock' : 'unlock'} size={12} />{p.status}</span></td>
                      <td className="num">{p.posted_count}</td>
                      <td className="num">{p.open_count ? <span className="badge b-warn">{p.open_count}</span> : '—'}</td>
                      <td>{p.locked_by_name ? `${p.locked_by_name}, ${new Date(p.locked_at).toLocaleDateString()}` : ''}</td>
                      <td style={{ textAlign: 'right' }}>
                        {p.status === 'open' && can(c, 'periods.lock') && <button className="btn sm" onClick={() => act(p, 'lock')}><Icon n="lock" size={13} />Lock</button>}
                        {p.status === 'locked' && can(c, 'periods.reopen') && <button className="btn sm danger" onClick={() => act(p, 'reopen')}><Icon n="unlock" size={13} />Re-open</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
