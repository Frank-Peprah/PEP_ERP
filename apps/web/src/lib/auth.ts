/**
 * Supabase Auth (Blueprint Phase 0, ADR-006): email + password, then TOTP two-step verification.
 * The auth client is loaded lazily (its own chunk) so the shell stays inside its 180 KB budget.
 * The session lives in sessionStorage: closing the tab ends it (finance data on shared machines).
 * Every API call carries the current access token; the client refreshes it before expiry and
 * pushes the new one into api.ts through onAuthStateChange.
 */
import type { AuthClient as AuthClientClass } from '@supabase/auth-js';
type AuthClient = InstanceType<typeof AuthClientClass>;
import { setToken } from '../api';

const env = (import.meta as any).env ?? {};
const SUPABASE_URL: string = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const PUBLISHABLE_KEY: string = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
const STORAGE_KEY = 'pep.auth';

/** True when this build is configured for Supabase Auth (otherwise only the demo sign-in exists). */
export const supabaseAuthEnabled = !!(SUPABASE_URL && PUBLISHABLE_KEY);

let client: Promise<AuthClient> | null = null;

export function authClient(): Promise<AuthClient> {
  if (!supabaseAuthEnabled) return Promise.reject(new Error('Supabase Auth is not configured for this build'));
  client ??= import('@supabase/auth-js').then(({ AuthClient }) => {
    const c = new AuthClient({
      url: `${SUPABASE_URL}/auth/v1`,
      headers: { apikey: PUBLISHABLE_KEY },
      storageKey: STORAGE_KEY,
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    });
    c.onAuthStateChange((event, session) => {
      if (session?.access_token) setToken(session.access_token);
      else if (event === 'SIGNED_OUT') setToken(null);
    });
    return c;
  });
  return client;
}

/** On app start: if a Supabase session was stored in this tab, start the client so it keeps the token fresh. */
export function resumeAuth() {
  if (!supabaseAuthEnabled) return;
  try { if (sessionStorage.getItem(STORAGE_KEY)) void authClient(); } catch { /* storage unavailable */ }
}

export async function signOutSupabase() {
  if (!supabaseAuthEnabled || !client) return;
  try { await (await client).signOut({ scope: 'local' }); } catch { /* already signed out */ }
}

export type MfaStep =
  | { kind: 'done' }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'enrol'; factorId: string; qr: string; secret: string };

/** After a password sign-in: decide whether the user must enrol an authenticator or enter a code. */
export async function nextMfaStep(): Promise<MfaStep> {
  const c = await authClient();
  const { data: aal, error } = await c.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (aal.currentLevel === 'aal2') return { kind: 'done' };
  const { data: factors, error: fe } = await c.mfa.listFactors();
  if (fe) throw fe;
  const verified = factors.totp.find((f) => f.status === 'verified');
  if (verified) return { kind: 'challenge', factorId: verified.id };
  // Remove abandoned, unverified enrolments before starting a fresh one.
  for (const f of factors.all.filter((x) => x.status === 'unverified')) await c.mfa.unenroll({ factorId: f.id });
  const { data, error: ee } = await c.mfa.enroll({ factorType: 'totp', friendlyName: `PEP ${new Date().toISOString().slice(0, 10)}` });
  if (ee) throw ee;
  return { kind: 'enrol', factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfa(factorId: string, code: string) {
  const c = await authClient();
  const { error } = await c.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) throw new Error(error.message.includes('Invalid') ? 'That code is not correct or has expired. Try the current code.' : error.message);
  const { data } = await c.getSession();
  if (data.session?.access_token) setToken(data.session.access_token);
}

export async function passwordSignIn(email: string, password: string) {
  const c = await authClient();
  const { data, error } = await c.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is not correct.' : error.message);
  if (data.session?.access_token) setToken(data.session.access_token);
}

export async function sendPasswordReset(email: string) {
  const c = await authClient();
  const { error } = await c.resetPasswordForEmail(email.trim().toLowerCase());
  if (error) throw error;
}

// ── Invitation / recovery links ───────────────────────────────────────────────
// Supabase sends invited people (and password resets) back to the app with the session in the URL
// fragment: #access_token=…&refresh_token=…&type=invite|recovery, or #error=…&error_description=….
// We capture it before the router starts (the router also uses the fragment on GitHub Pages),
// strip it from the address bar and history, and open the set-password screen.
const PENDING = 'pep.pendingLink';
export type PendingLink = { type: string; access_token?: string; refresh_token?: string; error?: string };

export function captureAuthLink(): boolean {
  const h = location.hash.replace(/^#\/?/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return false;
  const p = new URLSearchParams(h);
  const link: PendingLink = {
    type: p.get('type') ?? 'invite',
    access_token: p.get('access_token') ?? undefined,
    refresh_token: p.get('refresh_token') ?? undefined,
    error: p.get('error_description') ?? p.get('error') ?? undefined,
  };
  try { sessionStorage.setItem(PENDING, JSON.stringify(link)); } catch { return false; }
  const hashRouter = ((import.meta as any).env?.VITE_ROUTER ?? '') === 'hash';
  const base = ((import.meta as any).env?.BASE_URL ?? '/') as string;
  history.replaceState(null, '', hashRouter ? `${location.pathname}${location.search}#/set-password`
    : `${base.startsWith('.') ? location.pathname.replace(/[^/]*$/, '') : base}set-password`);
  return true;
}

export function takePendingLink(): PendingLink | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Start the session carried by an invitation/recovery link. */
export async function startLinkSession(link: PendingLink) {
  if (link.error) throw new Error(/expired|invalid/i.test(link.error) ? 'This link has expired or was already used. Ask your administrator for a new invitation, or use "Forgot password?".' : link.error);
  if (!link.access_token || !link.refresh_token) throw new Error('This link is incomplete. Open it again from the e-mail.');
  const c = await authClient();
  const { error } = await c.setSession({ access_token: link.access_token, refresh_token: link.refresh_token });
  if (error) throw new Error('This link has expired or was already used. Ask your administrator for a new invitation.');
}

export async function setPassword(password: string) {
  const c = await authClient();
  const { error } = await c.updateUser({ password });
  if (error) throw new Error(error.message);
}
