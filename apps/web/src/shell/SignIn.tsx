/**
 * A01 Sign in. Real identity (Supabase Auth: email + password, then TOTP two-step verification,
 * Blueprint Phase 0 / ADR-006) when the build is configured for it; the demo users and staging
 * access code remain below it on staging only. Layout follows the reference hero.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FileCheck2, KeyRound, Landmark, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import { api, API_BASE, apiFetch, setToken } from '../api';
import { Alert, Button } from '../design/components';
import { Logo } from './Logo';
import { nextMfaStep, passwordSignIn, sendPasswordReset, supabaseAuthEnabled, verifyMfa, type MfaStep } from '../lib/auth';

const inputCls = 'h-10 w-full rounded-[var(--radius-control)] border border-line pl-9 pr-3 text-[13.5px] outline-none focus:border-action-600 focus:ring-3 focus:ring-action-50';

/** Email + password, then enrol or verify an authenticator app. Finance data requires the second step. */
function SecureSignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'credentials' | MfaStep>('credentials');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); } };

  const afterPassword = async () => {
    const next = await nextMfaStep();
    if (next.kind === 'done') onDone(); else setStep(next);
  };

  if (step === 'credentials') return (
    <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await passwordSignIn(email, password); await afterPassword(); }); }}>
      <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Email
        <span className="relative"><Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></span>
      </label>
      <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Password
        <span className="relative"><KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} /></span>
      </label>
      {err && <Alert tone="loss">{err}</Alert>}
      {note && <Alert tone="action">{note}</Alert>}
      <Button type="submit" variant="primary" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      <button type="button" className="self-start text-[12px] font-semibold text-action-700 underline-offset-2 hover:underline" disabled={busy || !email}
        onClick={() => run(async () => { await sendPasswordReset(email); setNote('If that email has an account, a reset link is on its way.'); })}>Forgot password?</button>
    </form>
  );

  if (step.kind === 'done') return null;
  return <MfaForm step={step} onDone={onDone} />;
}

const FEATURES = [
  { icon: ShieldCheck, title: 'Double-entry accounting', text: 'with controls enforced by the database' },
  { icon: FileCheck2, title: 'IFRS financial reporting', text: 'with notes, comparatives and approvals' },
  { icon: Landmark, title: 'Audit-ready, Ghana-first', text: 'hash-chained audit trail, GRA preparation' },
];


/** Second step after a password: enrol an authenticator (QR + manual key) or enter its current code. */
export function MfaForm({ step, onDone }: { step: Exclude<MfaStep, { kind: 'done' }>; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); } };
  return (
    <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await verifyMfa(step.factorId, code); onDone(); }); }}>
      {step.kind === 'enrol' ? (
        <>
          <p className="text-[13px] text-ink-2"><b>Set up two-step verification.</b> Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), then enter the 6-digit code it shows. It is required for all finance roles.</p>
          <img src={step.qr} alt="QR code for your authenticator app" width={176} height={176} className="self-center rounded-lg border border-line bg-white p-2" />
          <p className="text-[11.5px] text-muted">Can't scan? Enter this key manually: <code className="select-all break-all font-mono text-[11.5px] text-ink">{step.secret}</code></p>
        </>
      ) : (
        <p className="text-[13px] text-ink-2"><b>Two-step verification.</b> Enter the 6-digit code from your authenticator app.</p>
      )}
      <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Verification code
        <span className="relative"><Smartphone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus value={code}
            onChange={(e) => setCode(e.target.value)} className={`${inputCls} tabular-nums tracking-[0.3em]`} /></span>
      </label>
      {err && <Alert tone="loss">{err}</Alert>}
      <Button type="submit" variant="primary" disabled={busy || code.replace(/\s/g, '').length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</Button>
    </form>
  );
}

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
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">Sign in{needCode && !supabaseAuthEnabled ? ' to staging' : ''}</h2>
          {supabaseAuthEnabled && <SecureSignIn onDone={() => { qc.clear(); navigate('/', { replace: true }); }} />}
          {supabaseAuthEnabled && (needCode || users.length > 0) && (
            <div className="mt-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"><span className="h-px flex-1 bg-line" />Demo access (staging)<span className="h-px flex-1 bg-line" /></div>
          )}
          {(!supabaseAuthEnabled || needCode || users.length > 0) && <p className="mt-1 text-[13px] text-muted">Choose a demo user. Each role sees different permissions, so segregation of duties can be tested end to end.</p>}
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
          <p className="mt-5 text-[11.5px] text-muted">{supabaseAuthEnabled ? 'Two-step verification is required for every finance role. Demo users exist on staging only and hold illustrative data.' : 'Demo data only. Real accounts with two-step verification replace this sign-in before any live books are loaded.'}</p>
        </div>
      </section>
    </div>
  );
}
