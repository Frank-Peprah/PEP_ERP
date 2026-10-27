import { E, Icon, useApi, useApp } from '../ui';

export default function AuditTrail() {
  const c = useApp();
  const { data } = useApi<any>(`${E(c)}/audit?limit=300`, [c.refreshKey]);
  return (
    <>
      <div className="page-head">
        <div><h1>Audit trail</h1><div className="sub">Append-only and SHA-256 hash-chained. Any edit, deletion or re-ordering of history breaks the chain and is detected.</div></div>
        {data && <span className={`badge ${data.chainIntact ? 'b-posted' : 'b-rejected'}`} style={{ padding: '7px 12px' }}>
          <Icon n={data.chainIntact ? 'audit' : 'alert'} size={14} />{data.chainIntact ? 'Hash chain verified' : `Chain broken at event ${data.brokenAt}`}</span>}
      </div>
      <div className="card tbl-wrap">
        <table className="t">
          <thead><tr><th>#</th><th>When (UTC)</th><th>Actor</th><th>Action</th><th>Object</th><th>Change</th><th>Reason</th><th>Hash</th></tr></thead>
          <tbody>
            {data?.events.map((e: any) => (
              <tr key={e.id} className={e.object_type === 'journal' ? 'click' : ''} onClick={() => e.object_type === 'journal' && c.go('journals', { journalId: e.object_id })}>
                <td className="mono">{e.id}</td>
                <td className="mono" style={{ fontSize: 12 }}>{new Date(e.occurred_at).toISOString().replace('T', ' ').slice(0, 19)}</td>
                <td>{e.actor_name ?? 'system'}</td>
                <td><span className="badge b-draft mono">{e.action}</span></td>
                <td>{e.object_type}</td>
                <td style={{ fontSize: 12 }}>{e.before?.status && e.after?.status ? `${e.before.status} → ${e.after.status}` : ''}{e.after?.journal_no ? ` · ${e.after.journal_no}` : ''}</td>
                <td style={{ fontSize: 12 }}>{e.reason ?? ''}</td>
                <td className="mono" style={{ fontSize: 11, color: '#94A3B8' }}>{e.hash.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
