/**
 * G01 Dashboard — rebuilt to the reference layout on live data.
 * Every figure links to its source (blueprint § Navigation: drill-down chain).
 */
import { Link } from 'react-router';
import { ComboChart } from '../../design/ComboChart';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, CalendarCheck2, CheckCircle2, ChevronRight, FileSpreadsheet,
  CreditCard, Landmark, Minus, PiggyBank, ReceiptText, Scale, ShieldCheck, TrendingUp, Wallet,
} from 'lucide-react';
import { money } from '../../api';
import { Alert, Badge, Card, CardHeader, EmptyState, Skeleton, buttonStyles } from '../../design/components';
import { cn } from '../../design/cn';
import { changeLabel, compactMoney, dateLabel, greeting, kpiMoney, monthLong, monthShort } from '../../lib/format';
import { useWorkspace } from '../../shell/workspace';
import { useDashboardData } from '../../shell/Shell';

type Kpi = { value: string; comparative: string; changePct: string | null; basis: string };

function KpiCard({ label, kpi, icon: Icon, goodWhenUp, href, ccy }: { label: string; kpi: Kpi; icon: typeof Wallet; goodWhenUp: boolean; href: string; ccy: string }) {
  const pct = kpi.changePct === null ? null : Number(kpi.changePct);
  const up = pct !== null && pct > 0, flat = pct === 0;
  const good = pct === null || flat ? null : up === goodWhenUp;
  const Arrow = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <Link to={href} className="pressable group block rounded-[var(--radius-card)] focus-visible:outline-offset-4">
      <Card className="flex h-full items-start gap-4 p-5 hover-lift">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-800"><Icon className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-muted">{label}</p>
          <p className="tnum mt-0.5 whitespace-nowrap text-[clamp(18px,1.6vw,22px)] font-extrabold tracking-[-0.02em] text-ink" title={`${ccy} ${money(kpi.value)}`}>
            {ccy} {kpiMoney(kpi.value)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
            {pct === null ? <span>No comparative yet</span> : (
              <>
                <span className={cn('inline-flex items-center gap-0.5 font-semibold', good === null ? 'text-muted' : good ? 'text-gain-700' : 'text-loss-700')}>
                  <Arrow className="size-3.5" aria-hidden /><span className="tnum">{changeLabel(pct)}</span>
                  <span className="sr-only">{up ? 'increase' : flat ? 'no change' : 'decrease'}</span>
                </span>
                <span>vs {kpi.basis}</span>
              </>
            )}
          </p>
        </div>
      </Card>
    </Link>
  );
}

const C = { revenue: '#2563eb', expenses: '#bcd0fb', net: '#f5b301', grid: '#eef1f6', axis: '#5b6b80' };

function RevenueChart({ monthly, ccy, fy }: { monthly: any[]; ccy: string; fy: string }) {
  const hasData = monthly.some((m) => !m.inFuture && (Number(m.revenue) !== 0 || Number(m.expenses) !== 0));
  return (
    <Card className="min-w-0 lg:col-span-2" aria-labelledby="rev-exp">
      <CardHeader id="rev-exp" title="Revenue vs expenses" action={<Badge>FY{fy}</Badge>} />
      <div className="flex flex-wrap gap-4 px-5 pt-2 text-[12px] text-ink-2">
        {[['Revenue', C.revenue], ['Expenses', C.expenses], ['Net profit', C.net]].map(([l, col]) => (
          <span key={l} className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: col }} />{l}</span>
        ))}
        <span className="ml-auto text-muted">{ccy}</span>
      </div>
      {!hasData ? <EmptyState icon={<TrendingUp />} title="No posted activity yet this financial year">Figures appear as journals are posted.</EmptyState> : (
        <div className="px-3 pb-3 pt-2">
          <ComboChart ariaLabel={`Revenue, expenses and net profit by month, FY${fy}`} format={compactMoney}
            bars={[{ name: 'Revenue', color: C.revenue }, { name: 'Expenses', color: C.expenses }]} line={{ name: 'Net profit', color: C.net }}
            data={monthly.map((m) => ({ key: m.month, label: monthShort(m.month), bars: m.inFuture ? [null, null] : [Number(m.revenue), Number(m.expenses)], line: m.inFuture ? null : Number(m.netProfit) }))}
            renderTip={(d) => {
              const m = monthly.find((x) => x.month === d.key)!;
              return (<>
                <p className="mb-1 font-semibold text-ink">{monthLong(m.month)}</p>
                {m.inFuture ? <p className="text-muted">Not yet reached</p> : [['Revenue', m.revenue, C.revenue], ['Expenses', m.expenses, C.expenses], ['Net profit', m.netProfit, C.net]].map(([l, v, col]) => (
                  <p key={l} className="flex items-center gap-2 text-ink-2"><span className="inline-block size-2.5 rounded-sm" style={{ background: col }} />{l}<span className="num ml-auto">{money(v)}</span></p>
                ))}
              </>);
            }} />
        </div>
      )}
      <div className="sr-only"><table>
        <caption>Monthly revenue, expenses and net profit, FY{fy}, {ccy}</caption>
        <thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Net profit</th></tr></thead>
        <tbody>{monthly.filter((m) => !m.inFuture).map((m) => <tr key={m.month}><td>{monthLong(m.month)}</td><td>{m.revenue}</td><td>{m.expenses}</td><td>{m.netProfit}</td></tr>)}</tbody>
      </table></div>
    </Card>
  );
}

function RowLink({ to, icon: Icon, label, value, ccy }: { to: string; icon: typeof Wallet; label: string; value: string; ccy: string }) {
  return (
    <Link to={to} className="pressable flex items-center gap-3 rounded-[10px] border border-line px-3.5 py-3 hover-lift">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-navy-50 text-navy-800"><Icon className="size-[18px]" aria-hidden /></span>
      <span className="min-w-0 flex-1"><small className="block text-[12px] text-muted">{label}</small><b className="tnum block truncate text-[15.5px] font-extrabold tracking-[-0.01em]" title={`${ccy} ${money(value)}`}>{ccy} {kpiMoney(value)}</b></span>
      <ChevronRight className="size-4 text-muted" aria-hidden />
    </Link>
  );
}

function Donut({ value, total, label }: { value: number; total: number; label: string }) {
  const r = 30, c = 2 * Math.PI * r, share = total ? value / total : 0;
  return (
    <svg viewBox="0 0 80 80" className="size-[84px] shrink-0" role="img" aria-label={label}>
      <circle cx="40" cy="40" r={r} fill="none" stroke="#eef1f6" strokeWidth="9" />
      <circle cx="40" cy="40" r={r} fill="none" stroke="#16a34a" strokeWidth="9" strokeDasharray={`${share * c} ${c}`} strokeLinecap="round" transform="rotate(-90 40 40)" />
      <text x="40" y="44" textAnchor="middle" className="tnum" fontSize="15" fontWeight="800" fill="#0f172a">{Math.round(share * 100)}%</text>
    </svg>
  );
}

const STATUS_TONE: Record<string, 'neutral' | 'warn' | 'action' | 'gain' | 'loss'> = { draft: 'neutral', under_review: 'warn', approved: 'action', final: 'gain', rejected: 'loss', superseded: 'neutral' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', under_review: 'Under review', approved: 'Approved', final: 'Final', rejected: 'Rejected', superseded: 'Superseded' };

export default function Dashboard() {
  const w = useWorkspace();
  const { data: d, error, isLoading } = useDashboardData();
  const ccy = w.entity.functional_currency;
  const first = w.user.fullName.replace(/\(.*\)/, '').trim().split(/\s+/)[0];

  if (error) return <Alert tone="loss" icon={<AlertTriangle />}>{(error as Error).message}</Alert>;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(22px,2.2vw,26px)] font-extrabold tracking-[-0.02em]">{greeting()}, {first}</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {d ? <>Here's your financial overview for {monthLong(d.parameters.to.slice(0, 7))} · FY{d.parameters.financialYear} year to date</> : <Skeleton className="h-4 w-72" />}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={w.to('trial-balance')} className={buttonStyles({ variant: 'secondary' })}><Scale />Trial balance</Link>
          <Link to={w.to('statements')} className={buttonStyles({ variant: 'primary' })}><FileSpreadsheet />Statements</Link>
        </div>
      </div>

      {isLoading || !d ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="mb-3 h-3 w-24" /><Skeleton className="h-6 w-40" /></Card>)}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Total revenue" kpi={d.kpis.revenue} icon={TrendingUp} goodWhenUp href={w.to('statements', { tab: 'pl' })} ccy={ccy} />
            <KpiCard label="Total expenses" kpi={d.kpis.expenses} icon={ReceiptText} goodWhenUp={false} href={w.to('statements', { tab: 'pl' })} ccy={ccy} />
            <KpiCard label="Net profit" kpi={d.kpis.netProfit} icon={Banknote} goodWhenUp href={w.to('statements', { tab: 'pl' })} ccy={ccy} />
            <KpiCard label="Cash balance" kpi={d.kpis.cash} icon={Wallet} goodWhenUp href={w.to('statements', { tab: 'cf' })} ccy={ccy} />
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            <RevenueChart monthly={d.monthly} ccy={ccy} fy={d.parameters.financialYear} />

            <Card className="min-w-0" aria-labelledby="fin-pos">
              <CardHeader id="fin-pos" title="Financial position" />
              <div className="flex flex-col gap-2.5 p-5 pt-3">
                <RowLink to={w.to('statements', { tab: 'sfp' })} icon={Landmark} label="Total assets" value={d.position.assets} ccy={ccy} />
                <RowLink to={w.to('statements', { tab: 'sfp' })} icon={CreditCard} label="Total liabilities" value={d.position.liabilities} ccy={ccy} />
                <RowLink to={w.to('statements', { tab: 'soce' })} icon={PiggyBank} label="Total equity" value={d.position.equity} ccy={ccy} />
                <p className={cn('mt-1 flex items-center gap-1.5 text-[12px]', d.position.balances ? 'text-gain-700' : 'text-loss-700')}>
                  {d.position.balances ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
                  {d.position.balances ? 'Assets equal liabilities plus equity' : 'Position does not balance'} · as at {dateLabel(d.position.asAt)}
                </p>
              </div>
            </Card>

            <Card className="min-w-0" aria-labelledby="tasks">
              <CardHeader id="tasks" title="Tasks & alerts" action={d.tasks.length ? <Badge tone="warn">{d.tasks.reduce((s: number, t: any) => s + t.count, 0)}</Badge> : undefined} />
              {d.tasks.length === 0 ? <EmptyState icon={<CheckCircle2 />} title="Nothing needs your attention">Approvals, overdue closes and mapping gaps appear here.</EmptyState> : (
                <ul className="flex flex-col gap-1 p-3">
                  {d.tasks.map((t: any) => {
                    const [path, qs] = t.to.split('?');
                    return (
                      <li key={t.key}>
                        <Link to={w.to(path, Object.fromEntries(new URLSearchParams(qs ?? '')))} className="pressable flex items-center gap-3 rounded-[10px] px-2.5 py-2.5 hover-row">
                          <span className="tnum grid size-9 shrink-0 place-items-center rounded-lg bg-warn-50 text-[13.5px] font-bold text-warn-700">{t.count}</span>
                          <span className="flex-1 text-[13px] font-medium leading-snug text-ink">{t.label}</span>
                          <ChevronRight className="size-4 text-muted" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Link to={w.to('periods')} className="pressable block rounded-[var(--radius-card)]">
              <Card className="h-full p-5 hover-lift">
                <h2 className="flex items-center gap-2 text-[14px] font-bold"><CalendarCheck2 className="size-4 text-muted" aria-hidden />Period close</h2>
                <div className="mt-3 flex items-center gap-4">
                  <Donut value={d.close.locked} total={d.close.total} label={`${d.close.locked} of ${d.close.total} periods locked`} />
                  <p className="text-[13px] text-ink-2"><b className="tnum text-[20px] font-extrabold text-ink">{d.close.locked}</b> of <span className="num">{d.close.total}</span> periods locked in FY{d.parameters.financialYear}</p>
                </div>
              </Card>
            </Link>
            <Link to={w.to('statements', d.latestRun ? { runId: d.latestRun.id } : {})} className="pressable block rounded-[var(--radius-card)]">
              <Card className="h-full p-5 hover-lift">
                <h2 className="flex items-center gap-2 text-[14px] font-bold"><FileSpreadsheet className="size-4 text-muted" aria-hidden />Latest statements</h2>
                {d.latestRun ? (
                  <div className="mt-3">
                    <Badge tone={STATUS_TONE[d.latestRun.status]}>{STATUS_LABEL[d.latestRun.status]}</Badge>
                    <p className="mt-2 text-[13px] text-ink-2">Run <span className="num">#{d.latestRun.run_no}</span> · period ended {dateLabel(d.latestRun.period_end)}</p>
                    <p className="mt-1 text-[12px] text-muted">{d.latestRun.blocking_count ? `${d.latestRun.blocking_count} blocking exception${d.latestRun.blocking_count === 1 ? '' : 's'}` : 'No blocking exceptions'}</p>
                  </div>
                ) : <p className="mt-3 text-[13px] text-muted">No statement run yet. Generate one from Financial Statements.</p>}
              </Card>
            </Link>
            <Link to={w.to('trial-balance')} className="pressable block rounded-[var(--radius-card)]">
              <Card className="h-full p-5 hover-lift">
                <h2 className="flex items-center gap-2 text-[14px] font-bold"><Scale className="size-4 text-muted" aria-hidden />Trial balance</h2>
                <div className="mt-3">
                  <Badge tone={d.trialBalance.balanced ? 'gain' : 'loss'}>{d.trialBalance.balanced ? 'Balanced' : 'Out of balance'}</Badge>
                  <p className="mt-2 text-[13px] text-ink-2">Total debits <span className="tnum font-bold text-ink">{ccy} {money(d.trialBalance.debit)}</span></p>
                  <p className="mt-1 text-[12px] text-muted">Posted lines to {dateLabel(d.parameters.to)}</p>
                </div>
              </Card>
            </Link>
            {d.auditChain && (
              <Link to={w.to('audit')} className="pressable block rounded-[var(--radius-card)]">
                <Card className="h-full p-5 hover-lift">
                  <h2 className="flex items-center gap-2 text-[14px] font-bold"><ShieldCheck className="size-4 text-muted" aria-hidden />Audit trail</h2>
                  <div className="mt-3">
                    <Badge tone={d.auditChain.intact ? 'gain' : 'loss'}>{d.auditChain.intact ? 'Chain intact' : 'Chain broken'}</Badge>
                    <p className="mt-2 text-[13px] text-ink-2">Every change is hash-linked to the one before it.</p>
                  </div>
                </Card>
              </Link>
            )}
          </div>
          <p className="text-[11.5px] text-muted">Source: posted journal lines only. Comparatives: {d.parameters.hasPriorYear ? `${dateLabel(d.parameters.comparativeFrom)} to ${dateLabel(d.parameters.comparativeTo)}` : 'no prior financial year on record'}. Generated {dateLabel(d.parameters.generatedAt)}, {new Date(d.parameters.generatedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' })}.</p>
        </>
      )}
    </div>
  );
}
