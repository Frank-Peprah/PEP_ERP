/**
 * Bridge for Release 1–2 screens until each is rebuilt in Phase 1: gives them the context they expect
 * (go(), params, toast, refresh) on top of the new router and workspace.
 */
import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AppCtx, type Ctx } from '../ui';
import { useWorkspace } from './workspace';

const ROUTE: Record<string, string> = {
  dashboard: 'dashboard', journals: 'journals', ledger: 'ledger', tb: 'trial-balance', accounts: 'accounts',
  periods: 'periods', audit: 'audit', fs: 'statements', notes: 'notes',
};

export function LegacyPage({ page: Page, extra }: { page: ComponentType; extra?: Record<string, string> }) {
  const w = useWorkspace();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const params = useMemo(() => {
    const p = Object.fromEntries([...search.entries()].filter(([k]) => k !== 'period'));
    return { ...(w.period ? { periodId: w.period.id } : {}), ...extra, ...p };
  }, [search, extra, w.period]);
  const go = useCallback((page: string, pr: Record<string, string> = {}) => {
    navigate(w.to(ROUTE[page] ?? page, pr)); window.scrollTo(0, 0);
  }, [navigate, w]);
  const ctx: Ctx = useMemo(() => ({
    user: w.user, entity: w.entity as any, perms: w.perms, go, params,
    toast: (m: string, err?: boolean) => (err ? toast.error(m) : toast.success(m)),
    refreshKey, bump: () => setRefreshKey((k) => k + 1),
  }), [w, go, params, refreshKey]);
  return (
    <AppCtx.Provider value={ctx}>
      <div className="legacy"><Page key={`${w.entity.id}-${search.toString()}`} /></div>
    </AppCtx.Provider>
  );
}
