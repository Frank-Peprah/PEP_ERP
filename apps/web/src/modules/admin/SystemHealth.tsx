/**
 * S06 System health (Blueprint 04 §7). Whether the platform and this entity's books are trustworthy
 * right now: audit chain, ledger balance per financial year, approvals backlog, API and migrations.
 * Static (no animation): it is read, not watched.
 */
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../../api';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '../../design/components';
import { when } from '../../lib/format';
import { useWorkspace } from '../../shell/workspace';

type Health = {
  api: { version: string; dbLatencyMs: number; checkedAt: string };
  migrations: { applied: number; latest: string } | null;
  lastAuditEvent: string | null;
  checks: { key: string; label: string; ok: boolean; detail: string }[];
  ok: boolean;
};

export default function SystemHealth() {
  const w = useWorkspace();
  const q = useQuery<Health>({ queryKey: ['health', w.entity.id], queryFn: () => api(`/entities/${w.entity.id}/system-health`) });
  return (
    <div className="grid min-w-0 gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">System health</h1>
          <p className="mt-1 max-w-[65ch] text-[13.5px] text-muted">Checks that prove the books for {w.entity.legal_name} can be trusted right now. Each runs live against the database.</p>
        </div>
        <Button onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw aria-hidden />{q.isFetching ? 'Checking…' : 'Run checks again'}</Button>
      </header>
      {q.isLoading ? <Card className="grid gap-3 p-5"><Skeleton /><Skeleton /><Skeleton /></Card>
        : q.error ? <Alert tone="loss">{(q.error as Error).message}</Alert>
        : q.data && (
          <>
            <Alert tone={q.data.ok ? 'gain' : 'loss'} icon={q.data.ok ? <CheckCircle2 /> : <XCircle />}>
              {q.data.ok ? 'All checks pass.' : `${q.data.checks.filter((c) => !c.ok).length} check(s) need attention.`} Checked {when(q.data.api.checkedAt)}.
            </Alert>
            <Card className="min-w-0" aria-labelledby="checks-h">
              <CardHeader id="checks-h" title="Integrity checks" />
              <ul className="divide-y divide-line px-5 pb-2 pt-2">
                {q.data.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 py-3">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-gain-700" aria-label="Pass" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-loss-700" aria-label="Fail" />}
                    <span className="min-w-0"><b className="block text-[13.5px] font-semibold">{c.label}</b><small className="text-[12.5px] text-muted">{c.detail}</small></span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="min-w-0" aria-labelledby="plat-h">
              <CardHeader id="plat-h" title="Platform" />
              <dl className="grid gap-x-6 gap-y-3 p-5 pt-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-muted">API version</dt><dd className="font-semibold"><Badge>{q.data.api.version}</Badge></dd></div>
                <div><dt className="text-muted">Database response</dt><dd className="tnum font-semibold">{q.data.api.dbLatencyMs} ms</dd></div>
                <div><dt className="text-muted">Migrations applied</dt><dd className="font-semibold">{q.data.migrations ? `${q.data.migrations.applied} (latest ${q.data.migrations.latest.replace(/\.sql$/, '')})` : 'Managed by Supabase'}</dd></div>
                <div><dt className="text-muted">Last audit event</dt><dd className="font-semibold">{q.data.lastAuditEvent ? when(q.data.lastAuditEvent) : '—'}</dd></div>
              </dl>
            </Card>
          </>
        )}
    </div>
  );
}
