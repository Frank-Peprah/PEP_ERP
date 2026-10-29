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
