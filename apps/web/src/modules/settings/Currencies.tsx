/**
 * S06 Currencies and exchange rates (Blueprint Phase 1, decision D5). The entity posts in its functional currency;
 * a controller can enable others. Rates are functional units per one foreign unit, Bank of Ghana reference by
 * default; bank or manual rates need a reason. Rates are never edited — a correction is a new rate.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { api } from '../../api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton } from '../../design/components';
import { dateLabel } from '../../lib/format';
import { useWorkspace } from '../../shell/workspace';

type Cur = { functional: string; enabled: { code: string; latestRate: { rate: string; rate_date: string; source: string } | null }[] };
type Rate = { id: string; currency: string; rate_date: string; rate: string; source: string; reason: string | null; created_by_name: string };
const SRC: Record<string, string> = { bog_reference: 'Bank of Ghana reference', bank: 'Bank rate', manual: 'Manual' };
const field = 'h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-action-600 focus:ring-3 focus:ring-action-50';
const label = 'flex min-w-0 flex-col gap-1.5 text-[12px] font-semibold text-ink-2';
const rate4 = (r: string) => Number(r).toLocaleString('en-GB', { minimumFractionDigits: 4, maximumFractionDigits: 8 });

export default function Currencies() {
  const w = useWorkspace();
  const qc = useQueryClient();
  const E = `/entities/${w.entity.id}`;
  const canManage = w.perms.has('currencies.manage');
  const cur = useQuery<Cur>({ queryKey: ['currencies', w.entity.id], queryFn: () => api(`${E}/currencies`) });
  const rates = useQuery<Rate[]>({ queryKey: ['rates', w.entity.id], queryFn: () => api(`${E}/exchange-rates`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['currencies', w.entity.id] }); qc.invalidateQueries({ queryKey: ['rates', w.entity.id] }); };
  const [code, setCode] = useState('');
  const enable = useMutation({ mutationFn: () => api(`${E}/currencies`, { method: 'POST', body: { code } }), onSuccess: () => { setCode(''); refresh(); } });
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ currency: '', rateDate: today, rate: '', source: 'bog_reference', reason: '' });
  const record = useMutation({ mutationFn: () => api(`${E}/exchange-rates`, { method: 'POST', body: { ...f, currency: f.currency || cur.data?.enabled[0]?.code } }),
    onSuccess: () => { setF({ ...f, rate: '', reason: '' }); refresh(); } });
  const fn = cur.data?.functional ?? w.entity.functional_currency;
  const enabled = cur.data?.enabled ?? [];

  return (
    <div className="grid min-w-0 gap-5">
      <header>
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Currencies</h1>
        <p className="mt-1 max-w-[65ch] text-[13.5px] text-muted">The books are kept in {fn}. Enable another currency only when this entity starts transacting in it; journals in that currency then convert to {fn} at the rate in force on the journal date.</p>
      </header>

      <Card aria-labelledby="cur-h" className="min-w-0">
        <CardHeader id="cur-h" title="Currencies in use" />
        {cur.isLoading ? <div className="p-5"><Skeleton /></div> : cur.error ? <div className="p-5"><Alert tone="loss">{(cur.error as Error).message}</Alert></div> : (
          <div className="grid gap-4 p-5 pt-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="gold">{fn} · functional</Badge>
              {enabled.map((c) => <Badge key={c.code} tone="action">{c.code}{c.latestRate ? ` · ${rate4(c.latestRate.rate)} from ${dateLabel(c.latestRate.rate_date)}` : ' · no rate yet'}</Badge>)}
            </div>
            {!enabled.length && <p className="text-[13px] text-muted">Only {fn} is enabled, so journals cannot be entered in any other currency.</p>}
            {canManage && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
                <label className={`${label} w-40`}>Currency code<input value={code} maxLength={3} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${field} uppercase`} placeholder="USD" /></label>
                <Button type="submit" disabled={enable.isPending || !/^[A-Z]{3}$/.test(code)}>Enable currency</Button>
              </form>
            )}
            {enable.error && <Alert tone="loss">{(enable.error as Error).message}</Alert>}
          </div>
        )}
      </Card>

      {canManage && enabled.length > 0 && (
        <Card aria-labelledby="rate-h" className="min-w-0">
          <CardHeader id="rate-h" title="Record an exchange rate" />
          <form className="grid gap-3 p-5 pt-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); record.mutate(); }}>
            <label className={label}>Currency
              <select value={f.currency || enabled[0].code} onChange={(e) => setF({ ...f, currency: e.target.value })} className={field}>
                {enabled.map((c) => <option key={c.code}>{c.code}</option>)}</select></label>
            <label className={label}>Date<input type="date" required value={f.rateDate} onChange={(e) => setF({ ...f, rateDate: e.target.value })} className={field} /></label>
            <label className={label}>{fn} per 1 {f.currency || enabled[0].code}<input inputMode="decimal" required value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className={`${field} tnum text-right`} placeholder="15.2500" /></label>
            <label className={label}>Source
              <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} className={field}>
                {Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <div className="flex items-end"><Button type="submit" variant="primary" className="w-full" disabled={record.isPending || !f.rate || (f.source !== 'bog_reference' && !f.reason.trim())}>{record.isPending ? 'Saving…' : 'Record rate'}</Button></div>
            {f.source !== 'bog_reference' && (
              <label className={`${label} sm:col-span-2 lg:col-span-5`}>Why not the Bank of Ghana rate? (recorded in the audit trail)
                <input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={field} placeholder="e.g. Actual conversion rate on GCB statement" /></label>
            )}
            {record.error && <div className="sm:col-span-2 lg:col-span-5"><Alert tone="loss">{(record.error as Error).message}</Alert></div>}
          </form>
        </Card>
      )}

      <Card aria-labelledby="hist-h" className="min-w-0">
        <CardHeader id="hist-h" title="Rate history" />
        {rates.isLoading ? <div className="p-5"><Skeleton /></div>
          : !rates.data?.length ? <EmptyState icon={<Coins />} title="No rates recorded">Rates appear here once a currency is enabled and a rate is recorded.</EmptyState>
          : (
            <div className="relative overflow-x-auto p-2 pt-3" tabIndex={0} role="region" aria-label="Exchange rate history (scrolls sideways on small screens)">
              <table className="w-full min-w-[620px] text-left text-[13px]">
                <thead className="text-[11.5px] uppercase tracking-[0.06em] text-muted"><tr>
                  <th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Currency</th><th className="px-3 py-2 text-right font-semibold">Rate ({fn})</th>
                  <th className="px-3 py-2 font-semibold">Source</th><th className="px-3 py-2 font-semibold">Recorded by</th></tr></thead>
                <tbody>
                  {rates.data.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="px-3 py-2.5">{dateLabel(r.rate_date)}</td><td className="px-3 py-2.5 font-semibold">{r.currency}</td>
                      <td className="tnum px-3 py-2.5 text-right">{rate4(r.rate)}</td>
                      <td className="px-3 py-2.5">{SRC[r.source] ?? r.source}{r.reason && <small className="block text-muted">{r.reason}</small>}</td>
                      <td className="px-3 py-2.5 text-muted">{r.created_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}
