import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { createLimiter } from './lib/rate-limit.js';
import { DomainError } from '@pep/accounting-domain';
import { audit, translatePgError, withTx, type Db } from './lib/db.js';
import { getConfig, loadConfigFromDb } from './lib/config.js';
import { assertMfa, authenticateBearer, issueToken, loadScope, type Actor, type EntityScope } from './lib/auth.js';
import * as J from './services/journals.js';
import * as S from './services/setup.js';
import * as R from './services/reports.js';
import * as FS from './services/statements.js';
import * as U from './services/users.js';
import { API_VERSION, systemHealth } from './services/health.js';
import { dashboard } from './services/dashboard.js';

const STATUS: Record<string, number> = {
  AUTH_NOT_CONFIGURED: 503, UNAUTHENTICATED: 401, MFA_REQUIRED: 403, AUTH_PROVIDER_UNAVAILABLE: 502, INVITE_FAILED: 502,
  RATE_LIMITED: 429, USER_INACTIVE: 409, APPROVAL_POLICY_APPEND_ONLY: 409, ACCESS_CODE_REQUIRED: 401, FORBIDDEN: 403, SEGREGATION_OF_DUTIES: 403, NOT_FOUND: 404,
  CONFLICT: 409, OVERLAP: 409, STALE_VERSION: 409, IDEMPOTENCY_CONFLICT: 409, ALREADY_REVERSED: 409,
  ACCOUNT_HAS_ACTIVITY: 409, REFERENCED: 409, POSTED_JOURNAL_IMMUTABLE: 409, JOURNAL_LINES_IMMUTABLE: 409,
  PERIOD_LOCKED: 423, PERIODS_NOT_LOCKED: 423, STATEMENT_STALE: 409, STATEMENT_HAS_BLOCKING_EXCEPTIONS: 422,
  STATEMENT_RUN_IMMUTABLE: 409, STATEMENT_CONTENT_IMMUTABLE: 409, STATEMENT_RUN_DELETE_FORBIDDEN: 409, NO_TEMPLATE: 422,
  REASON_REQUIRED: 422, INVALID_STATUS_TRANSITION: 409,
};

declare module 'fastify' {
  interface FastifyRequest { actor?: Actor; scope?: EntityScope }
}

export function buildApp(db: Db, opts: { allowDevLogin?: boolean; logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  // Accept an empty body sent with content-type: application/json (treated as no body).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body ?? '');
    if (text.trim() === '') return done(null, undefined);
    try { done(null, JSON.parse(text)); }
    catch { const e = new Error('Request body is not valid JSON') as Error & { statusCode: number }; e.statusCode = 400; done(e, undefined); }
  });
  // Secrets missing from the environment are read from the locked app_config table at startup.
  app.addHook('onReady', async () => { await loadConfigFromDb(db); });
  app.register(cors, {
    // Allow-list from CORS_ORIGIN (env or app_config), evaluated per request; unset = allow all.
    origin: (origin, cb) => {
      const list = getConfig('CORS_ORIGIN');
      if (!list || !origin) return cb(null, true);
      cb(null, list.split(',').map((o) => o.trim().replace(/\/$/, '')).includes(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-access-code'],
    maxAge: 600,
  });

  // Rate limiting (SECURITY.md blocker 4): generous globally, strict on sign-in and invitations.
  const STRICT = [/^\/api\/auth\//, /^\/api\/dev\//, /\/users\/invite$/];
  app.addHook('onRequest', createLimiter({
    globalPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
    strictPerMin: Number(process.env.RATE_LIMIT_AUTH_PER_MIN ?? 20),
    isStrict: (url) => STRICT.some((re) => re.test(url)),
  }));

  app.setErrorHandler((err, _req, reply) => {
    const e = translatePgError(err);
    if (e instanceof DomainError) {
      return reply.status(STATUS[e.code] ?? 422).send({ error: { code: e.code, message: e.message, details: e.details } });
    }
    const fe = err as { statusCode?: number; validation?: unknown; message: string };
    if (fe.validation || fe.statusCode === 400) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: fe.message } });
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Unexpected error' } }); // never leak internals
  });

  // ── Auth ──
  const authenticate = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    req.actor = await authenticateBearer(db, h?.startsWith('Bearer ') ? h.slice(7) : undefined, { allowDev: !!opts.allowDevLogin });
  };
  const scoped = async (req: FastifyRequest) => {
    await authenticate(req);
    assertMfa(req.actor!);
    req.scope = await loadScope(db, req.actor!.id, (req.params as { entityId: string }).entityId);
  };

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, service: 'pep-erp-api', version: API_VERSION };
  });

  // Staging gate: when STAGING_ACCESS_CODE is set, demo login and the user list require it.
  const checkAccessCode = (given: unknown) => {
    const code = getConfig('STAGING_ACCESS_CODE');
    if (!code) return;
    const a = Buffer.from(String(given ?? '')), b = Buffer.from(code);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new DomainError('ACCESS_CODE_REQUIRED', 'Enter the staging access code');
  };

  // DEVELOPMENT/STAGING ONLY: passwordless login for seeded demo users. Disabled in production.
  app.post('/api/auth/dev-login', async (req) => {
    if (!opts.allowDevLogin || process.env.NODE_ENV === 'production') throw new DomainError('NOT_FOUND', 'Not found');
    checkAccessCode((req.body as any)?.accessCode);
    const { email } = (req.body ?? {}) as { email?: string };
    const r = await db.query('SELECT id FROM users WHERE email = $1 AND is_active', [String(email ?? '').toLowerCase()]);
    if (!r.rowCount) throw new DomainError('UNAUTHENTICATED', 'Unknown user');
    return { token: issueToken(r.rows[0].id) };
  });

  app.get('/api/dev/users', async (req) => {
    if (!opts.allowDevLogin || process.env.NODE_ENV === 'production') throw new DomainError('NOT_FOUND', 'Not found');
    checkAccessCode(req.headers['x-access-code']);
    return (await db.query(
      `SELECT u.email, u.full_name, string_agg(DISTINCT uer.role_code, ', ') AS roles FROM users u
         LEFT JOIN user_entity_roles uer ON uer.user_id = u.id GROUP BY u.id ORDER BY u.full_name`)).rows;
  });

  app.get('/api/me', { preHandler: authenticate }, async (req) => {
    // First real sign-in after an invitation (the Auth user was linked when the invite was sent):
    // record acceptance once, in the audit trail of each entity that invited them.
    if (req.actor!.method === 'supabase') {
      await withTx(db, async (tx) => {
        const acc = await tx.query(
          `UPDATE user_invitations SET status = 'accepted', accepted_at = now()
            WHERE user_id = $1 AND status = 'sent' RETURNING entity_id`, [req.actor!.id]);
        for (const row of acc.rows) {
          await audit(tx, { entityId: row.entity_id, actorId: req.actor!.id, action: 'user.invitation_accepted', objectType: 'user', objectId: req.actor!.id });
        }
      });
    }
    const ents = await db.query(
      `SELECT e.id, e.code, e.legal_name, e.functional_currency, array_agg(DISTINCT uer.role_code) AS roles
         FROM user_entity_roles uer JOIN entities e ON e.id = uer.entity_id
        WHERE uer.user_id = $1 GROUP BY e.id ORDER BY e.legal_name`, [req.actor!.id]);
    return { user: req.actor, entities: ents.rows };
  });

  // ── Entity-scoped routes ──
  const E = '/api/entities/:entityId';
  type P = { entityId: string; id: string };
  const ctx = (req: FastifyRequest) => ({ scope: req.scope!, actor: req.actor! });

  app.get(E, { preHandler: scoped }, async (req) => S.getEntity(db, req.scope!));
  app.get(`${E}/periods`, { preHandler: scoped }, async (req) => S.listPeriods(db, req.scope!));
  app.post(`${E}/financial-years`, { preHandler: scoped }, async (req, reply) => {
    const { scope, actor } = ctx(req);
    reply.status(201);
    return S.createFinancialYear(db, scope, actor, req.body as any);
  });
  app.post(`${E}/periods/:id/lock`, { preHandler: scoped }, async (req) =>
    S.setPeriodStatus(db, req.scope!, req.actor!, (req.params as P).id, 'lock', (req.body as any)?.reason));
  app.post(`${E}/periods/:id/reopen`, { preHandler: scoped }, async (req) =>
    S.setPeriodStatus(db, req.scope!, req.actor!, (req.params as P).id, 'reopen', (req.body as any)?.reason));

  app.get(`${E}/accounts`, { preHandler: scoped }, async (req) => S.listAccounts(db, req.scope!));
  app.post(`${E}/accounts`, { preHandler: scoped }, async (req, reply) => {
    reply.status(201);
    return S.createAccount(db, req.scope!, req.actor!, req.body as any);
  });
  app.patch(`${E}/accounts/:id`, { preHandler: scoped }, async (req) =>
    S.updateAccount(db, req.scope!, req.actor!, (req.params as P).id, req.body as any));
  app.delete(`${E}/accounts/:id`, { preHandler: scoped }, async (req) =>
    S.deleteAccount(db, req.scope!, req.actor!, (req.params as P).id));

  app.get(`${E}/journals`, { preHandler: scoped }, async (req) => {
    if (!req.scope!.permissions.has('journal.read')) throw new DomainError('FORBIDDEN', 'Missing permission journal.read');
    return J.listJournals(db, req.scope!.entityId, req.query as any);
  });
  app.get(`${E}/journals/:id`, { preHandler: scoped }, async (req) => {
    if (!req.scope!.permissions.has('journal.read')) throw new DomainError('FORBIDDEN', 'Missing permission journal.read');
    return J.getJournal(db, req.scope!.entityId, (req.params as P).id);
  });
  app.post(`${E}/journals`, { preHandler: scoped }, async (req, reply) => {
    const out = await J.createDraft(db, req.scope!, req.actor!, {
      ...(req.body as any), idempotencyKey: (req.headers['idempotency-key'] as string) ?? (req.body as any)?.idempotencyKey });
    reply.status((out as any).idempotentReplay ? 200 : 201);
    return out;
  });
  app.put(`${E}/journals/:id`, { preHandler: scoped }, async (req) =>
    J.updateDraft(db, req.scope!, req.actor!, (req.params as P).id, req.body as any));
  app.delete(`${E}/journals/:id`, { preHandler: scoped }, async (req) =>
    J.deleteDraft(db, req.scope!, req.actor!, (req.params as P).id));
  for (const action of ['submit', 'return', 'approve', 'post', 'reject'] as const) {
    app.post(`${E}/journals/:id/${action}`, { preHandler: scoped }, async (req) =>
      J.transition(db, req.scope!, req.actor!, (req.params as P).id, action, { reason: (req.body as any)?.reason }));
  }
  app.post(`${E}/journals/:id/reverse`, { preHandler: scoped }, async (req, reply) => {
    reply.status(201);
    return J.createReversal(db, req.scope!, req.actor!, (req.params as P).id, req.body as any);
  });

  app.get(`${E}/ledger`, { preHandler: scoped }, async (req) => R.accountLedger(db, req.scope!, req.query as any));
  app.get(`${E}/trial-balance`, { preHandler: scoped }, async (req) => {
    const q = req.query as any;
    return R.trialBalance(db, req.scope!, { periodId: q.periodId, basis: q.basis, includeZero: q.includeZero === 'true' });
  });
  app.get(`${E}/dashboard`, { preHandler: scoped }, async (req) => dashboard(db, req.scope!, (req.query as any).periodId));
  app.get(`${E}/summary`, { preHandler: scoped }, async (req) => R.summary(db, req.scope!, (req.query as any).periodId));
  // ── Release 2: financial statements ──
  app.get(`${E}/statement-preview`, { preHandler: scoped }, async (req) => FS.previewPack(db, req.scope!, (req.query as any).periodId));
  app.get(`${E}/statement-runs`, { preHandler: scoped }, async (req) => FS.listRuns(db, req.scope!));
  app.post(`${E}/statement-runs`, { preHandler: scoped }, async (req, reply) => {
    const periodId = (req.body as any)?.periodId;
    if (!periodId) throw new DomainError('VALIDATION', 'periodId is required');
    reply.status(201);
    return FS.generateRun(db, req.scope!, req.actor!, periodId);
  });
  app.get(`${E}/statement-runs/:id`, { preHandler: scoped }, async (req) => FS.getRun(db, req.scope!, (req.params as P).id));
  for (const action of ['submit', 'approve', 'finalize', 'return', 'reject'] as const) {
    app.post(`${E}/statement-runs/:id/${action}`, { preHandler: scoped }, async (req) =>
      FS.transitionRun(db, req.scope!, req.actor!, (req.params as P).id, action, { reason: (req.body as any)?.reason }));
  }
  // ── Users, invitations, approval policies (Blueprint Phase 0 · M0) ──
  app.get('/api/roles', { preHandler: authenticate }, async () => U.listRoles(db));
  app.get(`${E}/system-health`, { preHandler: scoped }, async (req) => systemHealth(db, req.scope!));
  app.get(`${E}/users`, { preHandler: scoped }, async (req) => U.listUsers(db, req.scope!));
  app.post(`${E}/users/invite`, { preHandler: scoped }, async (req, reply) => {
    reply.status(201);
    return U.inviteUser(db, req.scope!, req.actor!, req.body as any);
  });
  app.get(`${E}/approval-policies`, { preHandler: scoped }, async (req) => U.listPolicies(db, req.scope!));
  app.post(`${E}/approval-policies`, { preHandler: scoped }, async (req, reply) => {
    reply.status(201);
    return U.createPolicy(db, req.scope!, req.actor!, req.body as any);
  });
  app.get(`${E}/approval-policies/required`, { preHandler: scoped }, async (req) => {
    const q = req.query as { documentType?: string; amount?: string; on?: string };
    return U.approvalsRequired(db, req.scope!, String(q.documentType), String(q.amount ?? '0'), String(q.on ?? new Date().toISOString().slice(0, 10)));
  });
  app.get(`${E}/audit`, { preHandler: scoped }, async (req) => S.listAudit(db, req.scope!, Number((req.query as any).limit ?? 200)));

  return app;
}
