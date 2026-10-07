import './core/preflight.ts';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@ethos/db';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { databaseUrl, isMagicLinkExposed, isMagicLinkRequired, port } from './core/config.ts';
import { createApp } from './http/app.ts';

export type { Context } from './core/context.ts';

/** Where Postgres listens when a connection string names no port. */
const DEFAULT_POSTGRES_PORT = 5432;
/** Every interface. The container's port mapping decides who can reach it. */
const LISTEN_HOST = '0.0.0.0';

/** What Node reports when nothing answers at the database's address. */
const UNREACHABLE_CODES: readonly string[] = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'];

/** The errno code of whatever caused `error`, when it has one. */
function errnoCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  if (typeof cause !== 'object' || cause === null || 'code' in cause === false) {
    return undefined;
  }
  return typeof cause.code === 'string' ? cause.code : undefined;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// Migrations run at boot so `docker compose up` on a fresh volume is the whole
// install. They are idempotent; a container restart is a no-op.
try {
  await migrate(db, { migrationsFolder: join(__dirname, '../../db/drizzle') });
} catch (error) {
  // A misconfigured DATABASE_URL surfaces here as a driver stack trace about
  // `CREATE SCHEMA`. Name the actual problem instead.
  const code = errnoCode(error);
  if (code !== undefined && UNREACHABLE_CODES.includes(code)) {
    const target = new URL(databaseUrl());
    console.error(
      `[boot] Cannot reach Postgres at ${target.hostname}:${target.port || DEFAULT_POSTGRES_PORT} (${code}).`,
    );
    console.error('  Check DATABASE_URL in .env, and that the database is up and reachable from here.');
    console.error('  If your Docker daemon is remote (`docker context ls`), a container published on');
    console.error("  127.0.0.1 is bound to the daemon host's loopback. Set POSTGRES_BIND=0.0.0.0 and");
    console.error('  re-run `npm run db:up`.');
    process.exit(1);
  }
  throw error;
}

const app = await createApp({ db, staticDir: join(__dirname, '../../app/dist') });

app.listen(port(), LISTEN_HOST, () => {
  console.log(`[boot] Ethos ready at http://localhost:${port()}`);
  console.log(`[boot] GraphQL at http://localhost:${port()}/graphql`);
  if (isMagicLinkRequired() === false) {
    console.warn('[auth] AUTH_MAGIC_LINK is off: any email address signs in without a link. Private networks only.');
  } else if (isMagicLinkExposed()) {
    console.warn('[auth] EXPOSE_MAGIC_LINK is on: sign-in links are returned in API responses. Private networks only.');
  }
});
