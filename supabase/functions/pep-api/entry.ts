/**
 * Supabase Edge Function entry for the PEP ERP API (staging).
 * Runs the same Fastify app as local/production and dispatches each request through
 * app.inject(), so there is no separate code path. Built into index.ts by scripts/build-edge.mjs.
 * Env: SUPABASE_DB_URL and SUPABASE_URL (provided by Supabase), AUTH_SECRET, STAGING_ACCESS_CODE, REQUIRE_MFA (secrets).
 * Every statement runs as the least-privilege role pep_app (SET LOCAL ROLE per transaction; migration 005/006).
 */
import { buildApp } from '../../../apps/api/src/app.ts';
import { createPool } from '../../../apps/api/src/lib/db.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const dbUrl = Deno.env.get('PEP_DATABASE_URL') ?? Deno.env.get('SUPABASE_DB_URL');
if (!dbUrl) throw new Error('No database URL configured');
for (const k of ['AUTH_SECRET', 'STAGING_ACCESS_CODE', 'CORS_ORIGIN', 'SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'REQUIRE_MFA']) {
  const v = Deno.env.get(k);
  if (v) process.env[k] = v;
}
const app = buildApp(createPool(dbUrl, { max: 3, role: Deno.env.get('PEP_DB_ROLE') ?? 'pep_app' }), { allowDevLogin: true });
const ready = app.ready();

Deno.serve(async (req) => {
  await ready;
  const url = new URL(req.url);
  // Supabase routes /functions/v1/pep-api/* here with the function name as the first path segment.
  const path = url.pathname.replace(/^\/(functions\/v1\/)?pep-api/, '') || '/';
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  const res = await app.inject({
    method: req.method as any, url: path + url.search, headers,
    payload: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
  });
  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined || k === 'content-length' || k === 'connection' || k === 'transfer-encoding') continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => out.append(k, String(x)));
  }
  return new Response(res.statusCode === 204 ? null : res.rawPayload, { status: res.statusCode, headers: out });
});
