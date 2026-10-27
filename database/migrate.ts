/**
 * Minimal forward-only migration runner.
 * Each file in database/migrations runs once inside a transaction and is
 * recorded with its SHA-256 so an edited, already-applied migration is detected.
 *   tsx database/migrate.ts          apply pending
 *   tsx database/migrate.ts --reset  DROP and rebuild (refuses when NODE_ENV=production)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(databaseUrl: string, opts: { reset?: boolean; quiet?: boolean } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (opts.reset) {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing --reset in production');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map<string, string>(
      (await client.query('SELECT filename, sha256 FROM schema_migrations')).rows.map((r) => [r.filename, r.sha256]),
    );
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const sha = createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== sha) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)', [file, sha]);
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
