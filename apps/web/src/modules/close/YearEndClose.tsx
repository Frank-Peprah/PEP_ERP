/**
 * P05 Year-end close (Blueprint Phase 1). Preview → generate the closing journal (controller) → another
 * person approves and posts it in Journal Entries → finalise (locks December, marks the year closed).
 * Every step is enforced by the API and the database; this screen explains what is missing.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Lock, ScrollText } from 'lucide-react';
import { api, money } from '../../api';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '../../design/components';
import { dateLabel } from '../../lib/format';
import { useWorkspace } from '../../shell/workspace';

type Preview = {
  financialYear: { id: string; label: string; start: string; end: string; isClosed: boolean; closedAt: string | null };
  profitForYear: string;
  retainedEarnings: { code: string; name: string } | null;
  lines: { accountId: string; code: string; name: string; debit: string; credit: string }[];
  closingJournal: { id: string; status: string; draft_no: string; journal_no: string | null } | null;
  blockers: { code: string; message: string }[];
  canGenerate: boolean; canFinalise: boolean;
};

export default function YearEndClose() {
  const w = useWorkspace();
  const qc = useQueryClient();
  const ccy = w.entity.functional_currency;
  const years = useQuery<any[]>({ queryKey: ['periods', w.entity.id], queryFn: () => api(`/entities/${w.entity.id}/periods`) });
  const defaultFy = useMemo(() => years.data?.find((f) => !f.is_closed && f.end_date < new Date().toISOString().slice(0, 10))?.id ?? years.data?.[years.data.length - 1]?.id, [years.data]);
  const [fyId, setFyId] = useState<string | undefined>();
  const fy = fyId ?? defaultFy;
  const pv = useQuery<Preview>({ queryKey: ['close', w.entity.id, fy], queryFn: () => api(`/entities/${w.entity.id}/financial-years/${fy}/close`), enabled: !!fy });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['close', w.entity.id] }); qc.invalidateQueries({ queryKey: ['periods', w.entity.id] }); };
  const generate = useMutation({ mutationFn: () => api(`/entities/${w.entity.id}/financial-years/${fy}/close`, { method: 'POST' }), onSuccess: refresh });
  const finalise = useMutation({ mutationFn: () => api(`/entities/${w.entity.id}/financial-years/${fy}/close/finalise`, { method: 'POST' }), onSuccess: refresh });
  const canClose = w.perms.has('year.close');
  const p = pv.data;
  const profit = p ? Number(p.profitForYear) : 0;   // sign only, for wording

  return (
    <div className="grid min-w-0 gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Year-end close</h1>
          <p className="mt-1 max-w-[65ch] text-[13.5px] text-muted">Transfers the year’s profit or loss to retained earnings with one closing journal, approved by a second person, then locks the year. Financial statements keep reporting the year’s results.</p>
        </div>
        <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Financial year
          <select value={fy ?? ''} onChange={(e) => setFyId(e.target.value)} className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13.5px]">
            {(years.data ?? []).map((f) => <option key={f.id} value={f.id}>FY{f.label}{f.is_closed ? ' (closed)' : ''}</option>)}
          </select></label>
      </header>

      {pv.isLoading || !p ? <Card className="grid gap-3 p-5"><Skeleton /><Skeleton /><Skeleton /></Card>
        : pv.error ? <Alert tone="loss">{(pv.error as Error).message}</Alert> : (
          <>
            {p.financialYear.isClosed
              ? <Alert tone="gain" icon={<Lock />}>FY{p.financialYear.label} is closed{p.financialYear.closedAt ? ` (${dateLabel(p.financialYear.closedAt.slice(0, 10))})` : ''}. Re-opening any of its periods re-opens the year for review.</Alert>
              : p.blockers.length > 0 && !p.closingJournal
                ? <Alert tone="warn" icon={<AlertTriangle />}><b>Before closing FY{p.financialYear.label}:</b><ul className="mt-1 list-disc pl-5">{p.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul></Alert>
                : null}

            <Card className="min-w-0" aria-labelledby="steps-h">
              <CardHeader id="steps-h" title="Steps" />
              <ol className="grid gap-3 p-5 pt-3 text-[13.5px] sm:grid-cols-3">
                <li className="rounded-xl border border-line p-4">
                  <b className="block">1. Generate the closing journal</b>
                  <small className="text-muted">Controller only. Computed by the system; it cannot be edited.</small>
                  <div className="mt-3">
                    {p.closingJournal
                      ? <Badge tone="gain"><CheckCircle2 aria-hidden />Draft {p.closingJournal.draft_no} created</Badge>
                      : <Button variant="primary" disabled={!canClose || !p.canGenerate || generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? 'Generating…' : 'Generate'}</Button>}
                  </div>
                </li>
                <li className="rounded-xl border border-line p-4">
                  <b className="block">2. Approve and post</b>
                  <small className="text-muted">Someone other than the preparer approves and posts it in Journal Entries.</small>
                  <div className="mt-3">
                    {!p.closingJournal ? <Badge>Waiting for step 1</Badge>
                      : p.closingJournal.status === 'posted' ? <Badge tone="gain"><CheckCircle2 aria-hidden />Posted {p.closingJournal.journal_no}</Badge>
                      : <Link className="font-semibold text-action-700 underline-offset-2 hover:underline" to={w.to('journals', { journalId: p.closingJournal.id })}><ScrollText className="mr-1 inline size-4" aria-hidden />Open journal ({p.closingJournal.status})</Link>}
                  </div>
                </li>
                <li className="rounded-xl border border-line p-4">
                  <b className="block">3. Finalise</b>
                  <small className="text-muted">Locks any open period and marks the year closed.</small>
                  <div className="mt-3">
                    {p.financialYear.isClosed ? <Badge tone="gain"><Lock aria-hidden />Closed</Badge>
                      : <Button variant="primary" disabled={!canClose || !p.canFinalise || finalise.isPending} onClick={() => finalise.mutate()}>{finalise.isPending ? 'Closing…' : `Close FY${p.financialYear.label}`}</Button>}
                  </div>
                </li>
              </ol>
              {(generate.error || finalise.error) && <div className="px-5 pb-5"><Alert tone="loss">{((generate.error ?? finalise.error) as Error).message}</Alert></div>}
            </Card>

            <Card className="min-w-0" aria-labelledby="lines-h">
              <CardHeader id="lines-h" title={`Closing journal ${p.closingJournal ? '' : '(preview) '}— ${profit >= 0 ? 'profit' : 'loss'} for FY${p.financialYear.label}: ${ccy} ${money(String(Math.abs(Number(p.profitForYear)).toFixed(2)))}`} />
              <div className="overflow-x-auto p-2 pt-3" tabIndex={0} role="region" aria-label="Closing journal lines (scrolls sideways on small screens)">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="text-[11.5px] uppercase tracking-[0.06em] text-muted"><tr><th className="px-3 py-2 font-semibold">Account</th><th className="px-3 py-2 text-right font-semibold">Debit</th><th className="px-3 py-2 text-right font-semibold">Credit</th></tr></thead>
                  <tbody>
                    {p.lines.map((l) => (
                      <tr key={l.accountId} className="border-t border-line">
                        <td className="px-3 py-2.5"><span className="tnum text-muted">{l.code}</span> {l.name}</td>
                        <td className="tnum px-3 py-2.5 text-right">{l.debit === '0.00' ? '' : money(l.debit)}</td>
                        <td className="tnum px-3 py-2.5 text-right">{l.credit === '0.00' ? '' : money(l.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
    </div>
  );
}
