import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load the repo-root .env regardless of the working directory the server is started from.
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { createPool } from './lib/db.js';

const db = createPool(process.env.DATABASE_URL ?? 'postgres://pep:pep@localhost:5432/pep_dev');
const app = buildApp(db, { allowDevLogin: process.env.ALLOW_DEV_LOGIN !== 'false', logger: true });

// Serve the built web app when present (single-process local demo).
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }) : reply.sendFile('index.html'));
}

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: '0.0.0.0' }).catch((e) => { app.log.error(e); process.exit(1); });
