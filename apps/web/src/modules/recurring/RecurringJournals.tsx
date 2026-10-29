/**
 * P06 Recurring journals (Blueprint Phase 1). Templates that create draft journals on schedule — monthly rent,
 * accruals that reverse on the 1st, depreciation. "Create due drafts" generates every run due up to today;
 * the drafts then go through normal approval. Templates are paused or ended, never deleted.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Pause, Play, Plus, Repeat, Square, Trash2 } from 'lucide-react';
import { api, money } from '../../api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton } from '../../design/components';
import { dateLabel } from '../../lib/format';
import { useWorkspace } from '../../shell/workspace';

type Line = { accountId: string; debit: string; credit: string };
type Template = {
  id: string; name: string; description: string; journal_type: string; frequency: string; month_end: boolean; auto_reverse: boolean;
  is_adjustment: boolean; start_date: string; end_date: string | null; next_run_date: string | null; status: 'active' | 'paused' | 'ended';
  runs_generated: number; amount: string; created_by_name: string;
  last_journal: { id: string; draft_no: number; journal_no: string | null; status: string; date: string } | null;
};
type Generated = { asOf: string; created: { name: string; runDate: string; journalId: string; draftNo: number; autoReverseDate: string | null }[];
  skipped: { name: string; runDate: string; message: string }[] };

const FREQ: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', semiannually: 'Every 6 months', annually: 'Yearly' };
const field = 'h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-action-600 focus:ring-3 focus:ring-action-50';
const label = 'flex min-w-0 flex-col gap-1.5 text-[12px] font-semibold text-ink-2';
const blank = (): Line => ({ accountId: '', debit: '', credit: '' });
const cents = (v: string) => { const n = Number((v || '0').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

export default function RecurringJournals() {
  const w = useWorkspace();
  const qc = useQueryClient();
  const E = `/entities/${w.entity.id}`;
  const ccy = w.entity.functional_currency;
  const canPrepare = w.perms.has('journal.prepare');
  const list = useQuery<Template[]>({ queryKey: ['recurring', w.entity.id], queryFn: () => api(`${E}/recurring-journals`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['recurring', w.entity.id] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const [result, setResult] = useState<Generated | null>(null);
  const generate = useMutation({ mutationFn: () => api<Generated>(`${E}/recurring-journals/generate`, { method: 'POST', body: {} }),
    onSuccess: (r) => { setResult(r); refresh(); } });
  const status = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`${E}/recurring-journals/${v.id}/status`, { method: 'POST', body: { status: v.status } }),
    onSuccess: refresh });
  const [creating, setCreating] = useState(false);
  const due = (list.data ?? []).filter((t) => t.status === 'active' && t.next_run_date && t.next_run_date <= new Date().toISOString().slice(0, 10)).length;

  return (
    <div className="grid min-w-0 gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Recurring journals</h1>
          <p className="mt-1 max-w-[65ch] text-[13.5px] text-muted">Templates that create draft journals on a schedule. Each draft is approved like any other journal. Accruals can reverse themselves on the first day of the next period.</p>
        </div>
        {canPrepare && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setCreating((v) => !v)} aria-expanded={creating}><Plus aria-hidden className="size-4" />New template</Button>
            <Button variant="primary" disabled={generate.isPending || due === 0} onClick={() => generate.mutate()}>
              <CalendarClock aria-hidden className="size-4" />{generate.isPending ? 'Creating…' : due ? `Create ${due === 1 ? 'due draft' : 'due drafts'}` : 'Nothing due'}</Button>
          </div>
        )}
      </header>

      {generate.error && <Alert tone="loss">{(generate.error as Error).message}</Alert>}
      {result && (
        <Alert tone={result.skipped.length ? 'warn' : 'gain'} icon={<CheckCircle2 />}>
          <b>{result.created.length} draft{result.created.length === 1 ? '' : 's'} created</b>
          {result.created.length > 0 && <> — <Link className="font-semibold underline underline-offset-2" to={w.to('journals', { status: 'draft' })}>submit them for approval</Link>.</>}
          {result.skipped.map((s) => <div key={s.name + s.runDate} className="mt-1">{s.name} ({dateLabel(s.runDate)}): {s.message}</div>)}
        </Alert>
      )}

      {creating && canPrepare && <NewTemplate onDone={() => { setCreating(false); refresh(); }} />}

      <Card aria-labelledby="rec-h" className="min-w-0">
        <CardHeader id="rec-h" title="Templates" />
        {list.isLoading ? <div className="grid gap-2 p-5"><Skeleton /><Skeleton /></div>
          : list.error ? <div className="p-5"><Alert tone="loss">{(list.error as Error).message}</Alert></div>
          : !list.data?.length ? <EmptyState icon={<Repeat />} title="No recurring journals yet">Set up rent, salaries, depreciation or monthly accruals once; drafts are created when due.</EmptyState>
          : (
            <div className="relative overflow-x-auto p-2 pt-3" tabIndex={0} role="region" aria-label="Recurring journal templates (scrolls sideways on small screens)">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="text-[11.5px] uppercase tracking-[0.06em] text-muted">
                  <tr><th className="px-3 py-2 font-semibold">Template</th><th className="px-3 py-2 font-semibold">Schedule</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th><th className="px-3 py-2 font-semibold">Next draft</th>
                    <th className="px-3 py-2 font-semibold">Last journal</th><th className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {list.data.map((t) => (
                    <tr key={t.id} className="border-t border-line align-top">
                      <td className="px-3 py-3"><b className="block">{t.name}</b><small className="text-muted">{t.description}</small>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.auto_reverse && <Badge tone="action">Reverses next period</Badge>}
                          {t.is_adjustment && <Badge>Adjusting</Badge>}
                        </div></td>
                      <td className="px-3 py-3">{FREQ[t.frequency]}{t.month_end ? ', month end' : ''}<br />
                        <small className="text-muted">{dateLabel(t.start_date)} – {t.end_date ? dateLabel(t.end_date) : 'no end'}</small></td>
                      <td className="tnum px-3 py-3 text-right">{ccy} {money(t.amount)}</td>
                      <td className="px-3 py-3">{t.status === 'ended' ? <Badge>Ended</Badge> : t.status === 'paused' ? <Badge tone="warn">Paused</Badge>
                        : t.next_run_date ? dateLabel(t.next_run_date) : '—'}</td>
                      <td className="px-3 py-3">{t.last_journal
                        ? <Link className="font-semibold text-action-700 underline-offset-2 hover:underline" to={w.to('journals', { journalId: t.last_journal.id })}>
                            {t.last_journal.journal_no ?? `Draft D-${t.last_journal.draft_no}`}</Link> : <span className="text-muted">None yet</span>}
                        {t.last_journal && <small className="block text-muted">{dateLabel(t.last_journal.date)} · {t.last_journal.status}</small>}</td>
                      <td className="px-3 py-3 text-right">
                        {canPrepare && t.status !== 'ended' && (
                          <div className="flex justify-end gap-1">
                            {t.status === 'active'
                              ? <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: t.id, status: 'paused' })}><Pause aria-hidden className="size-3.5" />Pause</Button>
                              : <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: t.id, status: 'active' })}><Play aria-hidden className="size-3.5" />Resume</Button>}
                            <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: t.id, status: 'ended' })}><Square aria-hidden className="size-3.5" />End</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {status.error && <div className="p-5 pt-0"><Alert tone="loss">{(status.error as Error).message}</Alert></div>}
      </Card>
    </div>
  );
}

function NewTemplate({ onDone }: { onDone: () => void }) {
  const w = useWorkspace();
  const E = `/entities/${w.entity.id}`;
  const accounts = useQuery<any[]>({ queryKey: ['accounts', w.entity.id], queryFn: () => api(`${E}/accounts`) });
  const postable = useMemo(() => (accounts.data ?? []).filter((a) => a.is_postable && a.is_active), [accounts.data]);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ name: '', description: '', journalType: 'recurring', frequency: 'monthly', startDate: today, endDate: '',
    monthEnd: false, autoReverse: false, isAdjustment: false });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const set = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => j !== i ? l
    : { ...l, [k]: v, ...(k === 'debit' && v ? { credit: '' } : {}), ...(k === 'credit' && v ? { debit: '' } : {}) }));
  const used = lines.filter((l) => l.accountId || l.debit || l.credit);
  const dr = used.reduce((t, l) => t + cents(l.debit), 0), cr = used.reduce((t, l) => t + cents(l.credit), 0);
  const balanced = Number.isFinite(dr) && dr === cr && dr > 0;
  const save = useMutation({
    mutationFn: () => api(`${E}/recurring-journals`, { method: 'POST', body: { ...f, endDate: f.endDate || null,
      lines: used.map((l) => ({ accountId: l.accountId, debit: l.debit.replace(/,/g, '') || null, credit: l.credit.replace(/,/g, '') || null })) } }),
    onSuccess: onDone,
  });
  const accrual = f.journalType === 'accrual' || f.journalType === 'prepayment';

  return (
    <Card aria-labelledby="new-rec" className="min-w-0">
      <CardHeader id="new-rec" title="New recurring journal" />
      <form className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 p-5 pt-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={label}>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} placeholder="Office rent" /></label>
          <label className={`${label} lg:col-span-2`}>Journal description<input required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={field} placeholder="Office rent — Spintex" /></label>
          <label className={label}>Type
            <select value={f.journalType} onChange={(e) => { const t = e.target.value; const acc = t === 'accrual' || t === 'prepayment'; setF({ ...f, journalType: t, isAdjustment: acc, autoReverse: t === 'accrual', monthEnd: acc || f.monthEnd }); }} className={field}>
              <option value="recurring">Recurring</option><option value="accrual">Accrual</option><option value="prepayment">Prepayment release</option><option value="manual">Manual</option>
            </select></label>
          <label className={label}>Frequency
            <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} className={field}>
              {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={label}>First date<input type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={field} /></label>
          <label className={label}>Last date (optional)<input type="date" min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} className={field} /></label>
          <fieldset className="flex flex-col justify-end gap-1.5 text-[13px]">
            <legend className="sr-only">Options</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.monthEnd} onChange={(e) => setF({ ...f, monthEnd: e.target.checked })} />Date on the last day of the month</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.autoReverse} onChange={(e) => setF({ ...f, autoReverse: e.target.checked })} />Reverse on the 1st of the next period</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.isAdjustment} onChange={(e) => setF({ ...f, isAdjustment: e.target.checked })} />Adjusting entry</label>
          </fieldset>
        </div>
        {accrual && !f.autoReverse && <Alert tone="warn">Accruals are normally reversed on the first day of the next period, so the actual invoice is not counted twice.</Alert>}

        <div className="relative min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label="Template lines (scrolls sideways on small screens)">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="text-[11.5px] uppercase tracking-[0.06em] text-muted"><tr><th className="px-2 py-2 font-semibold">Account</th>
              <th className="w-[150px] px-2 py-2 text-right font-semibold">Debit ({w.entity.functional_currency})</th><th className="w-[150px] px-2 py-2 text-right font-semibold">Credit</th><th className="w-10" /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-2"><select aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => set(i, 'accountId', e.target.value)} className={field}>
                    <option value="">Choose an account…</option>
                    {postable.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></td>
                  <td className="px-2 py-2"><input aria-label={`Line ${i + 1} debit`} inputMode="decimal" value={l.debit} onChange={(e) => set(i, 'debit', e.target.value)} className={`${field} tnum text-right`} /></td>
                  <td className="px-2 py-2"><input aria-label={`Line ${i + 1} credit`} inputMode="decimal" value={l.credit} onChange={(e) => set(i, 'credit', e.target.value)} className={`${field} tnum text-right`} /></td>
                  <td className="px-1 py-2">{lines.length > 2 && <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 aria-hidden className="size-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus aria-hidden className="size-3.5" />Add line</Button>
          <span className="tnum text-[13px] text-muted">Debits {money((dr / 100).toFixed(2))} · Credits {money((cr / 100).toFixed(2))}</span>
          <Badge tone={balanced ? 'gain' : 'warn'}>{balanced ? 'Balanced' : 'Not balanced'}</Badge>
          <Button type="submit" variant="primary" className="ml-auto" disabled={save.isPending || !balanced || !f.name.trim() || !f.description.trim() || used.some((l) => !l.accountId)}>
            {save.isPending ? 'Saving…' : 'Save template'}</Button>
        </div>
        {save.error && <Alert tone="loss">{(save.error as Error).message}</Alert>}
      </form>
    </Card>
  );
}
