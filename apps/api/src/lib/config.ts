/**
 * Runtime configuration lookup. Precedence: environment variable → app_config table → unset.
 * DB values are loaded once when the server becomes ready (cold start on serverless hosts).
 */
import type { Db } from './db.js';

export const CONFIG_KEYS = [
  'AUTH_SECRET', 'STAGING_ACCESS_CODE', 'CORS_ORIGIN',
  // Supabase Auth (Blueprint Phase 0): project URL (JWKS discovery), optional legacy HS256 secret,
  // and whether finance access requires a two-step-verified session (default: required).
  'SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'REQUIRE_MFA',
  // Where invitation e-mails send people (the web app URL; must be in Supabase Auth's redirect allow-list).
  'INVITE_REDIRECT_URL',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

let fromDb: Partial<Record<ConfigKey, string>> = {};

export function getConfig(key: ConfigKey): string | undefined {
  const env = process.env[key];
  return env !== undefined && env !== '' ? env : fromDb[key];
}

/** Load keys missing from the environment out of app_config. Tolerates the table not existing yet. */
export async function loadConfigFromDb(db: Db): Promise<ConfigKey[]> {
  const missing = CONFIG_KEYS.filter((k) => !process.env[k]);
  fromDb = {};
  if (!missing.length) return [];
  try {
    const r = await db.query('SELECT key, value FROM app_config WHERE key = ANY($1::text[])', [missing]);
    for (const row of r.rows) fromDb[row.key as ConfigKey] = row.value;
    return r.rows.map((x) => x.key);
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return []; // table not migrated yet
    throw e;
  }
}

/** Test helper. */
export function resetConfigCache() { fromDb = {}; }
