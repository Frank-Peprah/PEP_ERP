import { compact, fromMinor, money } from '../api';
import { Card, E, Icon, useApi, useApp } from '../ui';

function RevExpChart({ data }: { data: { m: string; revenue: string; expenses: string }[] }) {
  const W = 620, H = 230, pad = { l: 46, r: 12, t: 12, b: 28 };
  const vals = data.flatMap((d) => [Number(d.revenue), Number(d.expenses)]); // display scaling only
  const max = Math.max(1, ...vals) * 1.1;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / Math.max(data.length, 1);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const profitPts = data.map((d, i) => `${pad.l + bw * i + bw / 2},${y(Math.max(0, Number(d.revenue) - Number(d.expenses)))}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const mon = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleString('en', { month: 'short' });
  if (!data.length) return <div className="empty">No posted activity this financial year.</div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Revenue versus expenses by month">
      {ticks.map((t) => (
        <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#EEF1F6" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#94A3B8">{compact(String(t))}</text></g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + bw * i; const w = Math.min(14, bw / 3.2);
        return (
          <g key={d.m}>
            <rect x={x + bw / 2 - w - 1} y={y(Number(d.revenue))} width={w} height={ih + pad.t - y(Number(d.revenue))} rx="3" fill="#2563EB"><title>Revenue {money(d.revenue)}</title></rect>
            <rect x={x + bw / 2 + 1} y={y(Number(d.expenses))} width={w} height={ih + pad.t - y(Number(d.expenses))} rx="3" fill="#A5B8F3"><title>Expenses {money(d.expenses)}</title></rect>
            <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#64748B">{mon(d.m)}</text>
          </g>
        );
      })}
      <polyline points={profitPts} fill="none" stroke="#F5B301" strokeWidth="2.2" />
      {data.map((d, i) => <circle key={d.m} cx={pad.l + bw * i + bw / 2} cy={y(Math.max(0, Number(d.revenue) - Number(d.expenses)))} r="3.2" fill="#F5B301" />)}
    </svg>
  );
}

export default function Dashboard() {
  const c = useApp();
  const { data: s, error } = useApi(`${E(c)}/summary`, [c.refreshKey]);
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  if (error) return <div className="alert block">{error}</div>;
  if (!s) return <div className="empty">Loading dashboard…</div>;
  const ccy = c.entity.functional_currency;
  const k = s.kpis;
  const kpis = [
    { l: 'Revenue (YTD)', v: k.revenue, ico: 'up', bg: '#16A34A' },
    { l: 'Expenses (YTD)', v: k.expenses, ico: 'down', bg: '#EF4444' },
    { l: 'Net profit (YTD)', v: k.netProfit, ico: 'tb', bg: '#2563EB' },
    { l: 'Cash & bank', v: k.cash, ico: 'cash', bg: '#7C3AED' },
  ];
  const tasks = [
    s.pending.submitted && { n: s.pending.submitted, t: 'journals awaiting approval', ico: 'journal', col: '#D97706', bg: '#FEF3E2', go: ['journals', { status: 'submitted' }] },
    s.pending.approved && { n: s.pending.approved, t: 'approved journals ready to post', ico: 'check', col: '#2563EB', bg: '#EAF1FF', go: ['journals', { status: 'approved' }] },
    s.pending.draft && { n: s.pending.draft, t: 'draft journals in progress', ico: 'journal', col: '#64748B', bg: '#EEF1F6', go: ['journals', { status: 'draft' }] },
    ...s.exceptions.map((x: any) => ({ n: '', t: x.message, ico: 'alert', col: x.severity === 'blocking' ? '#DC2626' : '#D97706', bg: x.severity === 'blocking' ? '#FDECEC' : '#FEF3E2', go: ['tb', {}] })),
  ].filter(Boolean) as any[];

  return (
    <>
      <div className="page-head">
        <div><h1>{greet}, {c.user.fullName.split(' ')[0]}</h1>
          <div className="sub">{c.entity.legal_name} · FY{s.parameters.financialYear} to {s.parameters.periodName} ({s.parameters.periodStatus}) · derived live from posted journals</div></div>
        <span className={`badge ${s.tbBalanced ? 'b-posted' : 'b-rejected'}`}><Icon n={s.tbBalanced ? 'check' : 'alert'} size={13} />{s.tbBalanced ? 'Trial balance balanced' : 'Trial balance out of balance'}</span>
      </div>

      <div className="grid kpis" style={{ marginBottom: 16 }}>
        {kpis.map((x) => (
          <div className="card kpi" key={x.l}>
            <div className="ico" style={{ background: x.bg }}><Icon n={x.ico} /></div>
            <div><label>{x.l}</label><div className="v">{ccy} {money(x.v)}</div><div className="meta">{s.parameters.from} → {s.parameters.to}</div></div>
          </div>
        ))}
      </div>

      <div className="grid dash-mid">
        <Card title="Revenue vs expenses" right={<div className="chips" style={{ fontSize: 11.5, color: '#64748B', gap: 12 }}>
          <span>● <span style={{ color: '#2563EB' }}>Revenue</span></span><span>● <span style={{ color: '#7d93db' }}>Expenses</span></span><span>● <span style={{ color: '#D99A00' }}>Net profit</span></span></div>}>
          <RevExpChart data={s.monthly} />
        </Card>
        <Card title="Financial position">
          {[['Total assets', k.totalAssets, 'fa', '#16A34A', '#E8F7EE'], ['Total liabilities', k.totalLiabilities, 'ap', '#D97706', '#FEF3E2'],
            ['Total equity (incl. current-year result)', k.totalEquity, 'bank', '#2563EB', '#EAF1FF']].map(([l, v, i, col, bg]) => (
            <div className="task" key={l} onClick={() => c.go('tb')}>
              <div className="ti" style={{ background: bg, color: col }}><Icon n={i} size={17} /></div>
              <div style={{ flex: 1 }}><small>{l}</small><b className="mono">{ccy} {money(v)}</b></div><Icon n="chev" size={15} />
            </div>
          ))}
          {(() => {
            const diff = BigIntSafe(k.totalAssets) - BigIntSafe(k.totalLiabilities) - BigIntSafe(k.totalEquity);
            return (
              <div className={`alert ${diff === 0n ? 'ok' : 'block'}`} style={{ marginTop: 10, marginBottom: 0 }}>
                <Icon n={diff === 0n ? 'check' : 'alert'} size={15} />
                {diff === 0n ? 'Assets = Liabilities + Equity' : `Accounting equation difference: ${fromMinor(diff)}`}
              </div>
            );
          })()}
        </Card>
        <Card title="Tasks & alerts" right={<span className="badge b-draft">{tasks.length}</span>}>
          {tasks.length === 0 && <div className="empty" style={{ padding: 20 }}>Nothing needs your attention.</div>}
          {tasks.slice(0, 6).map((t, i) => (
            <div className="task" key={i} onClick={() => c.go(t.go[0], t.go[1])}>
              <div className="ti" style={{ background: t.bg, color: t.col }}><Icon n={t.ico} size={16} /></div>
              <div style={{ flex: 1 }}><b>{t.n} {t.t}</b></div><Icon n="chev" size={15} />
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function BigIntSafe(v: string): bigint {
  const neg = v.startsWith('-'); const [i, f = '0'] = (neg ? v.slice(1) : v).split('.');
  const m = BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -m : m;
}
