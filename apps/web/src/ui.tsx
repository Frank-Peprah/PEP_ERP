import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Entity { id: string; code: string; legal_name: string; functional_currency: string; roles: string[] }
export interface Ctx {
  user: { id: string; email: string; fullName: string };
  entity: Entity & { permissions?: string[]; reporting_framework?: string; segregation_enabled?: boolean };
  perms: Set<string>;
  go: (page: string, params?: Record<string, string>) => void;
  params: Record<string, string>;
  toast: (msg: string, err?: boolean) => void;
  refreshKey: number;
  bump: () => void;
}
export const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);
export const can = (c: Ctx, p: string) => c.perms.has(p);
export const E = (c: Ctx) => `/entities/${c.entity.id}`;

/** Fetch hook with reload on dependency change. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true); setError(null);
    api<T>(path).then((d) => live && setData(d)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [path, ...deps]);
  return { data, error, loading, setData };
}

const P: Record<string, string> = {
  dash: 'M3 12l9-8 9 8M5 10v10h14V10',
  journal: 'M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM9 8h6M9 12h6M9 16h4',
  ledger: 'M4 5h16M4 10h16M4 15h16M4 20h10',
  tb: 'M12 3v18M5 7h14M3 13l2-6 2 6a2.5 2.5 0 01-4 0zM17 13l2-6 2 6a2.5 2.5 0 01-4 0z',
  fs: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  notes: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3',
  ar: 'M12 3v18M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H6',
  ap: 'M3 7h18v12H3zM3 11h18M7 15h3',
  bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  fa: 'M4 20V9l8-5 8 5v11M9 20v-6h6v6',
  inv: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  tax: 'M9 14l6-6M9.5 8.5h.01M14.5 13.5h.01M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z',
  audit: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z M9 12l2 2 4-4',
  coa: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6',
  period: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  log: 'M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  rev: 'M4 12a8 8 0 0114-5l2 2M20 4v5h-5M20 12a8 8 0 01-14 5l-2-2M4 20v-5h5',
  cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
  up: 'M5 15l7-7 7 7', down: 'M5 9l7 7 7-7',
  check: 'M5 12l5 5L20 7', x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 017.5-2',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z', alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14', chev: 'M9 6l6 6-6 6',
};
export function Icon({ n, size = 18, style }: { n: string; size?: number; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={P[n] ?? P.dash} />
    </svg>
  );
}

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect x="4" y="18" width="5.5" height="10" rx="1.2" fill="#F5B301" />
      <rect x="13" y="11" width="5.5" height="17" rx="1.2" fill="#F5B301" />
      <rect x="22" y="4" width="5.5" height="24" rx="1.2" fill={dark ? '#0B1B3F' : '#F5B301'} />
    </svg>
  );
}

export const StatusBadge = ({ s }: { s: string }) => <span className={`badge b-${s}`}>{s[0].toUpperCase() + s.slice(1)}</span>;

export function Card({ title, right, children, pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <div className="card">
      {title && <div className="card-h"><h3>{title}</h3>{right}</div>}
      <div className={pad ? 'card-b' : ''}>{children}</div>
    </div>
  );
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][], meta: string[]) {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [...meta.map((m) => `# ${m}`), header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename; a.click();
}
