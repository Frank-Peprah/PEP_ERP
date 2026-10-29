/**
 * A01 Sign in (staging). Demo users plus the staging access code; replaced by real identity with
 * two-step verification in Phase 2. Layout follows the reference hero.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FileCheck2, KeyRound, Landmark, ShieldCheck } from 'lucide-react';
import { api, API_BASE, apiFetch, setToken } from '../api';
import { Alert, Button } from '../design/components';
import { Logo } from './Logo';

const FEATURES = [
  { icon: ShieldCheck, title: 'Double-entry accounting', text: 'with controls enforced by the database' },
  { icon: FileCheck2, title: 'IFRS financial reporting', text: 'with notes, comparatives and approvals' },
  { icon: Landmark, title: 'Audit-ready, Ghana-first', text: 'hash-chained audit trail, GRA preparation' },
];

export default function SignIn() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState(() => { try { return sessionStorage.getItem('pep.access') ?? ''; } catch { return ''; } });

  const loadUsers = (c: string) => {
    apiFetch(`${API_BASE}/api/dev/users`, { headers: c ? { 'x-access-code': c } : {} }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && j?.error?.code === 'ACCESS_CODE_REQUIRED') { setNeedCode(true); setUsers([]); if (c) setErr('That access code is not correct.'); return; }
      if (!r.ok) { setErr(j?.error?.message ?? 'Could not load users'); return; }
      setErr(''); setUsers(j);
      try { if (c) sessionStorage.setItem('pep.access', c); } catch { /* storage unavailable */ }
    }).catch((e) => setErr(e.message));
  };
  useEffect(() => { loadUsers(code); }, []);

  const signIn = async (email: string) => {
    setBusy(email);
    try {
      const r = await api('/auth/dev-login', { method: 'POST', body: { email, accessCode: code || undefined } });
      setToken(r.token); qc.clear(); navigate('/', { replace: true });
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="min-h-dvh bg-[radial-gradient(1100px_600px_at_10%_10%,#1c3570,#071330)] text-white lg:grid lg:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-center px-6 pb-6 pt-10 sm:px-12 lg:px-16 lg:py-16">
        <div className="flex items-center gap-3"><Logo size={34} /><span><b className="block text-[20px] font-extrabold">PEP Accounting</b>
          <small className="block text-[9px] font-semibold tracking-[0.16em] text-[#8ea0c8]">ACCOUNTING · COMPLIANCE · INSIGHTS · GROWTH</small></span></div>
        <p className="mt-10 text-[11.5px] font-semibold tracking-[0.2em] text-[#b7c4e2]">ALL-IN-ONE ACCOUNTING SOFTWARE</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,56px)] font-extrabold leading-[1.04] tracking-[-0.03em]">
          Your Numbers.<br />Your Compliance.<br /><span className="text-gold-500">Your Control.</span>
        </h1>
        <p className="mt-5 max-w-[56ch] text-[15.5px] leading-relaxed text-[#b7c4e2]">From everyday transactions to IFRS financial statements, supporting notes and Ghana tax preparation, in one platform with controls you can prove.</p>
        <ul className="mt-8 hidden gap-5 sm:grid sm:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-gold-500"><f.icon className="size-5" aria-hidden /></span>
              <span><b className="block text-[13px] font-semibold">{f.title}</b><small className="text-[12px] text-[#9fb0d6]">{f.text}</small></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex items-start justify-center px-4 pb-10 sm:px-8 lg:items-center lg:py-16">
        <div className="w-full max-w-[440px] rounded-[18px] bg-surface p-6 text-ink shadow-[0_30px_80px_rgb(0_0_0/0.35)] sm:p-8">
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">Sign in{needCode ? ' to staging' : ''}</h2>
          <p className="mt-1 text-[13px] text-muted">Choose a demo user. Each role sees different permissions, so segregation of duties can be tested end to end.</p>
          {needCode && (
            <form className="mt-5 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); loadUsers(code.trim()); }}>
              <label className="flex flex-1 flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Staging access code
                <span className="relative"><KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input id="access-code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-control)] border border-line pl-9 pr-3 text-[13.5px] outline-none focus:border-action-600 focus:ring-3 focus:ring-action-50" /></span>
              </label>
              <Button type="submit" variant="primary" disabled={!code.trim()}>Unlock</Button>
            </form>
          )}
          {err && <div className="mt-4"><Alert tone="loss">{err}</Alert></div>}
          <ul className="mt-5 flex flex-col gap-2">
            {users.map((u) => (
              <li key={u.email}>
                <button onClick={() => signIn(u.email)} disabled={!!busy} className="pressable flex w-full items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-left hover-lift disabled:opacity-60">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-800 text-[12.5px] font-bold text-gold-500">
                    {u.full_name.replace(/\(.*\)/, '').trim().split(/\s+/).map((s: string) => s[0]).slice(0, 2).join('')}</span>
                  <span className="min-w-0"><b className="block truncate text-[13.5px] font-semibold">{u.full_name}</b><small className="block truncate text-[11.5px] text-muted">{u.email} · {u.roles}</small></span>
                  {busy === u.email && <span className="ml-auto text-[12px] text-muted">Signing in…</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[11.5px] text-muted">Demo data only. Real accounts with two-step verification replace this sign-in before any live books are loaded.</p>
        </div>
      </section>
    </div>
  );
}
