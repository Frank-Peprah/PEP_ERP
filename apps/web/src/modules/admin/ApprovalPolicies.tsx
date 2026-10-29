/**
 * S05 Approval policies (Blueprint M0). Effective-dated thresholds: amounts above a tier need N approvers.
 * Policies are never edited or deleted; a change is a new row from a future date (append-only in the database).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Scale } from 'lucide-react';
import { api, money } from '../../api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton } from '../../design/components';
import { dateLabel } from '../../lib/format';
import { useWorkspace } from '../../shell/workspace';

const TYPES: Record<string, string> = {
  journal: 'Journals', bill: 'Supplier bills', payment: 'Payments', payout_detail_change: 'Payout detail changes',
  refund: 'Refunds', role_change: 'Role changes', contract: 'Sale contracts',
};
type Policy = { id: string; document_type: string; threshold: string; approvals_required: number; effective_from: string; reason: string; created_by_name: string; created_at: string };
const field = 'h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13.5px] outline-none focus:border-action-600 focus:ring-3 focus:ring-action-50';

export default function ApprovalPolicies() {
  const w = useWorkspace();
  const qc = useQueryClient();
  const ccy = w.entity.functional_currency;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ documentType: 'payment', threshold: '', approvalsRequired: 2, effectiveFrom: tomorrow, reason: '' });
  const [done, setDone] = useState('');
  const list = useQuery<Policy[]>({ queryKey: ['policies', w.entity.id], queryFn: () => api(`/entities/${w.entity.id}/approval-policies`) });
  const create = useMutation({
    mutationFn: () => api(`/entities/${w.entity.id}/approval-policies`, { method: 'POST', body: { ...f, threshold: f.threshold.replace(/,/g, '') } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies', w.entity.id] }); setDone(`${TYPES[f.documentType]} above ${ccy} ${money(f.threshold.replace(/,/g, '') || '0')} need ${f.approvalsRequired} approvers from ${dateLabel(f.effectiveFrom)}.`); setF({ ...f, threshold: '', reason: '' }); },
  });
  const canManage = w.perms.has('policies.manage');

  return (
    <div className="grid min-w-0 gap-5">
      <header>
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Approval policies</h1>
        <p className="mt-1 max-w-[65ch] text-[13.5px] text-muted">How many people must approve a document above each amount. Policies take effect from a date and are never edited; a change is a new policy, so past approvals can always be checked against the rule in force at the time.</p>
      </header>
      {done && <Alert tone="gain" icon={<CheckCircle2 />}>{done}</Alert>}
      {canManage && (
        <Card aria-labelledby="new-pol" className="min-w-0">
          <CardHeader id="new-pol" title="Add a policy tier" />
          <form className="grid gap-3 p-5 pt-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Document
              <select value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value })} className={field}>
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Above amount ({ccy})
              <input inputMode="decimal" required value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} className={`${field} tnum text-right`} placeholder="50,000.00" /></label>
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Approvers needed
              <select value={f.approvalsRequired} onChange={(e) => setF({ ...f, approvalsRequired: Number(e.target.value) })} className={field}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></label>
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Effective from
              <input type="date" required min={tomorrow} value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} className={field} /></label>
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2 sm:col-span-2 lg:col-span-3">Reason (recorded in the audit trail)
              <input required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={field} placeholder="e.g. Board resolution 2026/14: dual control on large payments" /></label>
            <div className="flex items-end"><Button type="submit" variant="primary" className="w-full" disabled={create.isPending || !f.threshold || !f.reason.trim()}>{create.isPending ? 'Saving…' : 'Add policy'}</Button></div>
            {create.error && <div className="sm:col-span-2 lg:col-span-4"><Alert tone="loss">{(create.error as Error).message}</Alert></div>}
          </form>
        </Card>
      )}
      <Card aria-labelledby="pol-h" className="min-w-0">
        <CardHeader id="pol-h" title="Policies in force and history" />
        {list.isLoading ? <div className="grid gap-2 p-5"><Skeleton /><Skeleton /></div>
          : list.error ? <div className="p-5"><Alert tone="loss">{(list.error as Error).message}</Alert></div>
          : !list.data?.length ? <EmptyState icon={<Scale />} title="No policies yet">Every document needs one approver by default. Add tiers for larger amounts.</EmptyState>
          : (
            <div className="overflow-x-auto p-2 pt-3" tabIndex={0} role="region" aria-label="Approval policies (scrolls sideways on small screens)">
              <table className="w-full min-w-[680px] text-left text-[13px]">
                <thead className="text-[11.5px] uppercase tracking-[0.06em] text-muted">
                  <tr><th className="px-3 py-2 font-semibold">Document</th><th className="px-3 py-2 text-right font-semibold">Above</th><th className="px-3 py-2 font-semibold">Approvers</th><th className="px-3 py-2 font-semibold">From</th><th className="px-3 py-2 font-semibold">Reason</th></tr>
                </thead>
                <tbody>
                  {list.data.map((p) => (
                    <tr key={p.id} className="border-t border-line align-top">
                      <td className="px-3 py-3 font-semibold">{TYPES[p.document_type] ?? p.document_type}</td>
                      <td className="tnum px-3 py-3 text-right">{ccy} {money(p.threshold)}</td>
                      <td className="px-3 py-3"><Badge tone={p.approvals_required > 1 ? 'gold' : 'neutral'}>{p.approvals_required}</Badge></td>
                      <td className="px-3 py-3">{dateLabel(p.effective_from)}</td>
                      <td className="px-3 py-3 text-muted"><span className="block max-w-[48ch]">{p.reason}</span><small>by {p.created_by_name}</small></td>
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
