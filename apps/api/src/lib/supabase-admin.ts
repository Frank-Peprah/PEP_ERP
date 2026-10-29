/**
 * Server-side calls to the Supabase Auth admin API (invitations).
 * The service key is read from the function environment only (Supabase injects
 * SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS into Edge Functions). It is never stored in
 * app_config, never logged and never sent to the browser.
 */
import { DomainError } from '@pep/accounting-domain';
import { getConfig } from './config.js';

function serviceKey(): string | undefined {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const raw = process.env.SUPABASE_SECRET_KEYS;
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch { return undefined; }
}

/** True when this server can send Supabase invitations. */
export const canInvite = () => !!(getConfig('SUPABASE_URL') && serviceKey());

export interface InviteResult { authUserId: string | null; emailSent: boolean; alreadyRegistered: boolean }

/**
 * Send a Supabase invitation e-mail. The recipient follows the link, lands on the app's
 * set-password screen, then enrols two-step verification.
 */
export async function sendInvite(email: string, data: Record<string, unknown>): Promise<InviteResult> {
  const base = getConfig('SUPABASE_URL')?.replace(/\/$/, '');
  const key = serviceKey();
  if (!base || !key) return { authUserId: null, emailSent: false, alreadyRegistered: false };
  const redirect = getConfig('INVITE_REDIRECT_URL');
  const url = `${base}/auth/v1/invite${redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ email, data }),
    });
  } catch {
    throw new DomainError('AUTH_PROVIDER_UNAVAILABLE', 'Could not reach the sign-in service to send the invitation. Try again shortly.');
  }
  const body = await res.json().catch(() => ({})) as { id?: string; code?: number | string; error_code?: string; msg?: string; message?: string };
  if (res.ok) return { authUserId: body.id ?? null, emailSent: true, alreadyRegistered: false };
  const code = String(body.error_code ?? body.code ?? '');
  if (res.status === 422 && /email_exists|user_already_exists|already/i.test(`${code} ${body.msg ?? body.message ?? ''}`)) {
    // The person already has a sign-in. They are linked automatically on their next sign-in
    // because a valid invitation for their verified e-mail now exists (see authenticateBearer).
    return { authUserId: null, emailSent: false, alreadyRegistered: true };
  }
  if (res.status === 429) throw new DomainError('RATE_LIMITED', 'The sign-in service is rate-limiting invitation e-mails. Try again in a few minutes.');
  throw new DomainError('INVITE_FAILED', `The sign-in service refused the invitation (${res.status}).`);
}
