import './core/preflight.ts';

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@ethos/db';
import cors from 'cors';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import express from 'express';
import { isMagicLinkExposed, isMagicLinkRequired } from './core/config.ts';
import { createGraphQLRouter } from './graphql/handler.ts';
import { createStaticHandler } from './http/static.ts';

export type { Context } from './core/context.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3006);
const staticDir = join(__dirname, '../../app/dist');

// Migrations run at boot so `docker compose up` on a fresh volume is the whole
// install. They are idempotent; a container restart is a no-op.
try {
  await migrate(db, { migrationsFolder: join(__dirname, '../../db/drizzle') });
} catch (error) {
  // A misconfigured DATABASE_URL surfaces here as a driver stack trace about
  // `CREATE SCHEMA`. Name the actual problem instead.
  const cause = (error as { cause?: NodeJS.ErrnoException })?.cause;
  if (cause && (cause.code === 'ECONNREFUSED' || cause.code === 'ENOTFOUND' || cause.code === 'ETIMEDOUT')) {
    const { hostname, port } = new URL(process.env.DATABASE_URL ?? '');
    console.error(`[boot] Cannot reach Postgres at ${hostname}:${port || 5432} (${cause.code}).`);
    console.error('  Check DATABASE_URL in .env, and that the database is up and reachable from here.');
    console.error('  If your Docker daemon is remote (`docker context ls`), a container published on');
    console.error("  127.0.0.1 is bound to the daemon host's loopback. Set POSTGRES_BIND=0.0.0.0 and");
    console.error('  re-run `npm run db:up`.');
    process.exit(1);
  }
  throw error;
}

const app = express();
const httpServer = createServer(app);
const serveStatic = createStaticHandler(staticDir);

app.use(cors());
app.use('/graphql', await createGraphQLRouter(httpServer));
app.get('/healthz', (_request, response) => {
  response.json({ ok: true });
});
app.use((request, response) => serveStatic(request, response));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[boot] Ethos ready at http://localhost:${PORT}`);
  console.log(`[boot] GraphQL at http://localhost:${PORT}/graphql`);
  if (isMagicLinkRequired() === false) {
    console.warn('[auth] AUTH_MAGIC_LINK is off: any email address signs in without a link. Private networks only.');
  } else if (isMagicLinkExposed()) {
    console.warn('[auth] EXPOSE_MAGIC_LINK is on: sign-in links are returned in API responses. Private networks only.');
  }
});
