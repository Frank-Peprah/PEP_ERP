export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

let token: string | null = sessionStorage.getItem('pep.token');
export const setToken = (t: string | null) => {
  token = t;
  if (t) sessionStorage.setItem('pep.token', t); else sessionStorage.removeItem('pep.token');
};
export const hasToken = () => !!token;

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(json?.error?.code ?? 'ERROR', json?.error?.message ?? res.statusText, res.status);
  }
  return json as T;
}

/** Display money from a decimal string without float conversion. */
export function money(v: string | null | undefined, opts: { blankZero?: boolean; ccy?: string } = {}) {
  if (v === null || v === undefined || v === '') return '';
  const neg = v.startsWith('-');
  const [i, f = '00'] = (neg ? v.slice(1) : v).split('.');
  if (opts.blankZero && /^0+$/.test(i) && /^0*$/.test(f)) return '';
  const s = `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(f + '00').slice(0, 2)}`;
  const out = opts.ccy ? `${opts.ccy} ${s}` : s;
  return neg ? `(${out})` : out;
}

export function compact(v: string) {
  const n = Number(v); // display only — never used for arithmetic
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return n < 0 ? `(${s})` : s;
}

/** Exact decimal-string arithmetic for live journal totals (integer pesewas via BigInt). */
export function toMinor(v: string): bigint | null {
  const s = (v ?? '').replace(/,/g, '').trim();
  if (s === '') return 0n;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
}
export function fromMinor(m: bigint): string {
  const neg = m < 0n; const a = neg ? -m : m;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}
