/**
 * A02 Set password — the landing screen for invitation and password-reset links (Blueprint M0).
 * Step 1: choose a password (12+ characters). Step 2: enrol or verify two-step verification.
 * Only then does the person reach the app; finance data needs both steps (ADR-006).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { Alert, Button } from '../design/components';
import { nextMfaStep, setPassword, startLinkSession, supabaseAuthEnabled, takePendingLink, type MfaStep } from '../lib/auth';
import { Logo } from './Logo';
import { MfaForm } from './SignIn';

const field = 'h-10 w-full rounded-[var(--radius-control)] border border-line pl-9 pr-3 text-[13.5px] outline-none focus:border-action-600 focus:ring-3 focus:ring-action-50';

export default function SetPassword() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useState<'starting' | 'password' | 'mfa' | 'error'>('starting');
  const [kind, setKind] = useState('invite');
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<Exclude<MfaStep, { kind: 'done' }> | null>(null);
  const done = () => { qc.clear(); navigate('/', { replace: true }); };

  useEffect(() => {
    const link = takePendingLink();
    if (!supabaseAuthEnabled || !link) { setErr('Open the link from your invitation or password-reset e-mail to continue.'); setState('error'); return; }
    setKind(link.type);
    startLinkSession(link).then(() => setState('password')).catch((e) => { setErr(e.message); setState('error'); });
  }, []);

  const strong = pw.length >= 12;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await setPassword(pw);
      const next = await nextMfaStep();
      if (next.kind === 'done') done(); else { setMfa(next); setState('mfa'); }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(1100px_600px_at_10%_10%,#1c3570,#071330)] px-4 py-10">
      <div className="w-full max-w-[440px] rounded-[18px] bg-surface p-6 text-ink shadow-[0_30px_80px_rgb(0_0_0/0.35)] sm:p-8">
        <div className="mb-6 flex items-center gap-2.5"><Logo /><b className="text-[17px] font-extrabold">PEP Accounting</b></div>
        <h1 className="text-[19px] font-extrabold tracking-[-0.01em]">{kind === 'recovery' ? 'Choose a new password' : 'Welcome — set up your sign-in'}</h1>
        {state === 'starting' && <p className="mt-2 text-[13px] text-muted">Checking your link…</p>}
        {state === 'error' && <div className="mt-4 grid gap-3"><Alert tone="loss">{err}</Alert><Button onClick={() => navigate('/sign-in', { replace: true })}>Go to sign-in</Button></div>}
        {state === 'password' && (
          <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (strong && pw === pw2) void submit(); }}>
            <p className="text-[13px] text-ink-2">Use at least 12 characters. A passphrase of four or more unrelated words is strong and easy to remember.</p>
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">New password
              <span className="relative"><KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input type="password" autoComplete="new-password" required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} className={field} aria-describedby="pw-hint" /></span>
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Repeat password
              <span className="relative"><KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} className={field} /></span>
            </label>
            <p id="pw-hint" className="text-[12px] text-muted" aria-live="polite">
              {!pw ? ' ' : !strong ? `${12 - pw.length} more character${12 - pw.length === 1 ? '' : 's'} needed` : pw2 && pw !== pw2 ? 'The passwords do not match yet' : 'Looks good'}</p>
            {err && <Alert tone="loss">{err}</Alert>}
            <Button type="submit" variant="primary" disabled={busy || !strong || pw !== pw2}>{busy ? 'Saving…' : 'Save password and continue'}</Button>
          </form>
        )}
        {state === 'mfa' && mfa && <MfaForm step={mfa} onDone={done} />}
      </div>
    </main>
  );
}
