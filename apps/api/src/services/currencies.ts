/**
 * Blueprint Phase 1 (decision D5) — currencies and exchange rates. An entity posts in its functional
 * currency plus any currency it enables. Rates are functional units per one foreign unit, recorded per date
 * and source (Bank of Ghana reference by default; bank or manual rates need a reason), and never edited.
 */
import { Decimal, DomainError } from '@pep/accounting-domain';
import { audit, withTx, type Db, type Tx } from '../lib/db.js';
import { requirePerm, type Actor, type EntityScope } from '../lib/auth.js';

const CODE = /^[A-Z]{3}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = new Set(['bog_reference', 'bank', 'manual']);

export async function listCurrencies(db: Db, scope: EntityScope) {
  requirePerm(scope, 'entity.read');
  const e = (await db.query('SELECT functional_currency, enabled_currencies FROM entities WHERE id = $1', [scope.entityId])).rows[0];
  const latest = await db.query(
    `SELECT DISTINCT ON (currency) currency, rate_date, rate, source, reason, created_at
       FROM exchange_rates WHERE entity_id = $1 ORDER BY currency, rate_date DESC, id DESC`, [scope.entityId]);
  const by = new Map(latest.rows.map((r) => [r.currency.trim(), r]));
  return {
    functional: e.functional_currency,
    enabled: (e.enabled_currencies as string[]).map((c) => ({ code: c, latestRate: by.get(c) ?? null })),
  };
}

export async function enableCurrency(db: Db, scope: EntityScope, actor: Actor, code: string) {
  requirePerm(scope, 'currencies.manage');
  const c = String(code ?? '').trim().toUpperCase();
  if (!CODE.test(c)) throw new DomainError('INVALID_CURRENCY', 'Use a three-letter ISO currency code, for example USD');
  return withTx(db, async (tx) => {
    const e = (await tx.query('SELECT functional_currency, enabled_currencies FROM entities WHERE id = $1 FOR UPDATE', [scope.entityId])).rows[0];
    if (c === e.functional_currency) throw new DomainError('INVALID_CURRENCY', `${c} is the functional currency`);
    if ((e.enabled_currencies as string[]).includes(c)) return { code: c, enabled: true };
    await tx.query('UPDATE entities SET enabled_currencies = array_append(enabled_currencies, $2::char(3)) WHERE id = $1', [scope.entityId, c]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'currency.enable', objectType: 'entity', objectId: scope.entityId,
      after: { currency: c } });
    return { code: c, enabled: true };
  });
}

export async function listRates(db: Db, scope: EntityScope, currency?: string) {
  requirePerm(scope, 'entity.read');
  const r = await db.query(
    `SELECT x.id, x.currency, x.rate_date, x.rate, x.source, x.reason, x.created_at, u.full_name AS created_by_name
       FROM exchange_rates x JOIN users u ON u.id = x.created_by
      WHERE x.entity_id = $1 AND ($2::text IS NULL OR x.currency = $2)
      ORDER BY x.rate_date DESC, x.id DESC LIMIT 500`, [scope.entityId, currency ? currency.toUpperCase() : null]);
  return r.rows.map((x) => ({ ...x, currency: x.currency.trim() }));
}

export async function recordRate(db: Db, scope: EntityScope, actor: Actor,
                                 input: { currency: string; rateDate: string; rate: string | number; source?: string; reason?: string }) {
  requirePerm(scope, 'currencies.manage');
  const c = String(input.currency ?? '').toUpperCase();
  const source = input.source ?? 'bog_reference';
  if (!ISO.test(input.rateDate ?? '')) throw new DomainError('INVALID_DATE', 'Rate date must be YYYY-MM-DD');
  if (!SOURCES.has(source)) throw new DomainError('INVALID_SOURCE', 'Source must be bog_reference, bank or manual');
  let rate: Decimal;
  try { rate = new Decimal(String(input.rate)); } catch { throw new DomainError('INVALID_FX_RATE', 'Rate must be a number'); }
  if (!rate.isFinite() || rate.lte(0)) throw new DomainError('INVALID_FX_RATE', 'Rate must be greater than zero');
  if (source !== 'bog_reference' && !input.reason?.trim()) {
    throw new DomainError('REASON_REQUIRED', 'Say why a bank or manual rate is used instead of the Bank of Ghana reference rate');
  }
  return withTx(db, async (tx) => {
    const e = (await tx.query('SELECT functional_currency, enabled_currencies FROM entities WHERE id = $1', [scope.entityId])).rows[0];
    if (!(e.enabled_currencies as string[]).includes(c)) throw new DomainError('CURRENCY_NOT_ENABLED', `${c} is not enabled for this entity`);
    const r = await tx.query(
      `INSERT INTO exchange_rates (entity_id, currency, rate_date, rate, source, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, currency, rate_date, rate, source, reason, created_at`,
      [scope.entityId, c, input.rateDate, rate.toFixed(8), source, input.reason?.trim() || null, actor.id]);
    await audit(tx, { entityId: scope.entityId, actorId: actor.id, action: 'fx_rate.record', objectType: 'exchange_rate', objectId: String(r.rows[0].id),
      after: { currency: c, date: input.rateDate, rate: rate.toFixed(8), source }, reason: input.reason?.trim() || null });
    return { ...r.rows[0], currency: c };
  });
}

/** Rate in force for a currency and date, or null. */
export async function rateOn(db: Db | Tx, entityId: string, currency: string, date: string): Promise<string | null> {
  const r = await db.query('SELECT fx_rate_on($1, $2, $3) AS rate', [entityId, currency, date]);
  return r.rows[0].rate ?? null;
}

export async function lookupRate(db: Db, scope: EntityScope, currency: string, date: string) {
  requirePerm(scope, 'entity.read');
  if (!ISO.test(date ?? '')) throw new DomainError('INVALID_DATE', 'date must be YYYY-MM-DD');
  const c = String(currency ?? '').toUpperCase();
  return { currency: c, date, rate: await rateOn(db, scope.entityId, c, date) };
}
