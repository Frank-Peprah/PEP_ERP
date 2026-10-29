import pg from 'pg';
import { DomainError } from '@pep/accounting-domain';

// NUMERIC → string (never JS float). DATE → 'YYYY-MM-DD' string (no TZ drift).
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => v); // bigint as string

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

/**
 * opts.role / PEP_DB_ROLE (e.g. 'pep_app'): every statement runs under that least-privilege role
 * (migration 005). The role is applied with SET LOCAL ROLE inside each transaction, so it is
 * correct behind a transaction-mode pooler (Supabase Edge Functions), where session-level
 * settings do not persist and would leak to other clients. Stand-alone queries are wrapped in a
 * short transaction for the same reason. A dedicated LOGIN role replaces this in production.
 */
export function createPool(connectionString: string, opts: { max?: number; role?: string } = {}): Db {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10, idleTimeoutMillis: 10_000 });
  const role = opts.role ?? process.env.PEP_DB_ROLE;
  if (!role) return pool;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid PEP_DB_ROLE');
  (pool as RolePool).pepRole = role;
  (pool as any).query = async (text: any, params?: any) => {
    if (typeof params === 'function') throw new Error('callback-style queries are not supported');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      const r = await client.query(text, params);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };
  return pool;
}
type RolePool = pg.Pool & { pepRole?: string };

/** Run fn in a SERIALIZABLE-safe transaction (READ COMMITTED + explicit row locks). */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const role = (db as RolePool).pepRole;
    if (role) await client.query(`SET LOCAL ROLE ${role}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw translatePgError(e);
  } finally {
    client.release();
  }
}

/** Map database-level control violations to domain errors with stable codes. */
export function translatePgError(e: unknown): unknown {
  if (e instanceof DomainError) return e;
  const err = e as { code?: string; message?: string; constraint?: string };
  if (err?.code === 'P0001' && err.message) {
    const [code, ...rest] = err.message.split(':');
    return new DomainError(code.trim(), rest.join(':').trim() || code.trim());
  }
  if (err?.code === '23505') return new DomainError('CONFLICT', `Duplicate value (${err.constraint ?? 'unique'})`);
  if (err?.code === '23P01') return new DomainError('OVERLAP', `Date range overlaps an existing record (${err.constraint})`);
  if (err?.code === '23503') return new DomainError('REFERENCED', `Record is referenced by other records (${err.constraint})`);
  if (err?.code === '23514') return new DomainError('CHECK_VIOLATION', `Constraint failed (${err.constraint})`);
  if (err?.code === '22P02') return new DomainError('INVALID_INPUT', 'Malformed identifier or value');
  return e;
}

export async function audit(
  tx: Tx,
  ev: { entityId?: string | null; actorId?: string | null; action: string; objectType: string; objectId?: string | null;
        before?: unknown; after?: unknown; reason?: string | null },
) {
  await tx.query(
    `INSERT INTO audit_events (entity_id, actor_id, action, object_type, object_id, before, after, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ev.entityId ?? null, ev.actorId ?? null, ev.action, ev.objectType, ev.objectId ?? null,
     ev.before === undefined ? null : JSON.stringify(ev.before),
     ev.after === undefined ? null : JSON.stringify(ev.after), ev.reason ?? null],
  );
}
