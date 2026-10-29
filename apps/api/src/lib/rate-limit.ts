/**
 * Fixed-window rate limiter (SECURITY.md blocker 4). Keyed by client IP (first X-Forwarded-For hop
 * behind the Supabase gateway) and route class. Counters live in this server instance: on Edge
 * Functions that slows guessing and floods rather than capping them exactly across instances.
 */
import type { FastifyRequest } from 'fastify';
import { DomainError } from '@pep/accounting-domain';

type Bucket = { count: number; resetAt: number };

export function createLimiter(opts: { globalPerMin: number; strictPerMin: number; isStrict: (url: string, method: string) => boolean }) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();
  const clientIp = (req: FastifyRequest) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip;

  return async function limit(req: FastifyRequest) {
    if (req.method === 'OPTIONS' || req.url === '/api/health') return;
    const now = Date.now();
    if (now - lastSweep > 60_000) {                   // keep memory bounded
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }
    const strict = opts.isStrict(req.url.split('?')[0], req.method);
    const key = `${strict ? 's' : 'g'}:${clientIp(req)}`;
    const max = strict ? opts.strictPerMin : opts.globalPerMin;
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + 60_000 }); return; }
    b.count++;
    if (b.count > max) {
      throw new DomainError('RATE_LIMITED', `Too many requests. Try again in ${Math.ceil((b.resetAt - now) / 1000)} seconds.`);
    }
  };
}
