/**
 * Workspace context: entity (from the URL), period (from ?period=YYYY-MM), permissions.
 * Every screen inside /:entity/* reads its context from here, so links carry context and can be shared.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { slug, type Me } from './session';

export interface Period { id: string; name: string; period_no: number; start_date: string; end_date: string; status: 'open' | 'locked'; fy: string }
export interface EntityDetail {
  id: string; code: string; legal_name: string; functional_currency: string; reporting_framework: string;
  roles: string[]; permissions: string[];
}
export interface Workspace {
  user: Me['user'];
  entities: Me['entities'];
  entity: EntityDetail;
  perms: Set<string>;
  periods: Period[];            // newest first
  period: Period | null;        // selected period
  setPeriod: (ym: string) => void;
  /** Path inside this entity, keeping the selected period: to('journals', { status: 'submitted' }). */
  to: (path: string, params?: Record<string, string | undefined>) => string;
}

const Ctx = createContext<Workspace | null>(null);
export const useWorkspace = () => {
  const w = useContext(Ctx);
  if (!w) throw new Error('useWorkspace outside WorkspaceProvider');
  return w;
};
export const useOptionalWorkspace = () => useContext(Ctx);

export const ym = (iso: string) => iso.slice(0, 7);

export function pickDefaultPeriod(periods: Period[], today = new Date().toISOString().slice(0, 10)) {
  return periods.find((p) => p.start_date <= today && p.end_date >= today) ?? periods[0] ?? null;
}

type State = { status: 'loading' } | { status: 'not-found' } | { status: 'error'; message: string } | { status: 'ready'; value: Workspace };

export function useWorkspaceState(me: Me | undefined): State {
  const { entity: code = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const ent = me?.entities.find((e) => slug(e.code) === code.toLowerCase());

  const detail = useQuery<EntityDetail>({ queryKey: ['entity', ent?.id, me?.user.id], queryFn: () => api(`/entities/${ent!.id}`), enabled: !!ent });
  const fys = useQuery<any[]>({ queryKey: ['periods', ent?.id], queryFn: () => api<any[]>(`/entities/${ent!.id}/periods`).catch((e) => { if (e instanceof ApiError && e.status === 403) return []; throw e; }), enabled: !!ent && !!detail.data });

  const periods = useMemo<Period[]>(
    () => (fys.data ?? []).flatMap((f) => f.periods.map((p: any) => ({ ...p, fy: f.label }))).sort((a, b) => (a.start_date < b.start_date ? 1 : -1)),
    [fys.data]);
  const wanted = search.get('period');
  const period = (wanted && periods.find((p) => ym(p.start_date) === wanted)) || pickDefaultPeriod(periods);

  const setPeriod = useCallback((v: string) => {
    const next = new URLSearchParams(search); next.set('period', v); setSearch(next, { replace: false });
  }, [search, setSearch]);

  const to = useCallback((path: string, params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    if (period) q.set('period', ym(period.start_date));
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
    return `/${code.toLowerCase()}/${path}${q.toString() ? `?${q}` : ''}`;
  }, [code, period]);
  void navigate;

  if (!me) return { status: 'loading' };
  if (!ent) return { status: 'not-found' };
  if (detail.error) return { status: 'error', message: (detail.error as Error).message };
  if (fys.error) return { status: 'error', message: (fys.error as Error).message };
  if (!detail.data || !fys.data) return { status: 'loading' };
  return {
    status: 'ready',
    value: { user: me.user, entities: me.entities, entity: detail.data, perms: new Set(detail.data.permissions), periods, period, setPeriod, to },
  };
}

export function WorkspaceProvider({ value, children }: { value: Workspace; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
