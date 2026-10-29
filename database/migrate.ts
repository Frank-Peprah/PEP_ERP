/**
 * Minimal forward-only migration runner.
 * Each file in supabase/migrations (Supabase CLI layout: <version>_<name>.sql) runs once inside a
 * transaction and is recorded with its SHA-256, so an edited, already-applied migration is detected.
 * Applied migrations are tracked by name without the version prefix, so databases migrated before
 * the move to the CLI layout (filenames like 001_core_ledger.sql) stay in sync.
 * Files whose first line contains "pep:hosted-only" are skipped here (Supabase-only extensions).
 *   tsx database/migrate.ts          apply pending
 *   tsx database/migrate.ts --reset  DROP and rebuild (refuses when NODE_ENV=production)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const key = (file: string) => file.replace(/^\d{14}_/, '');

export async function migrate(databaseUrl: string, opts: { reset?: boolean; quiet?: boolean } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (opts.reset) {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing --reset in production');
      await client.query('DROP SCHEMA IF EXISTS private CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map<string, string>(
      (await client.query('SELECT filename, sha256 FROM schema_migrations')).rows.map((r) => [r.filename, r.sha256]),
    );
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(dir, file), 'utf8');
      if (sql.split('\n', 1)[0].includes('pep:hosted-only')) continue;
      const sha = createHash('sha256').update(sql).digest('hex');
      const name = key(file);
      if (applied.has(name)) {
        if (applied.get(name) !== sha) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)', [name, sha]);
        await client.query('COMMIT');
        if (!opts.quiet) console.log(`applied ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? 'postgres://pep:pep@localhost:5432/pep_dev';
  migrate(url, { reset: process.argv.includes('--reset') })
    .then(() => console.log('migrations complete'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
