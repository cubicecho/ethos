import './core/preflight.ts';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, db } from '@ethos/db';
import { errorCode, RETRYABLE_CODES, waitForDatabase } from '@ethos/db/wait';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAuthHost } from './auth/auth-host.ts';
import {
  allowedOrigins,
  databaseUrl,
  dbConnectTimeoutMs,
  mcpEnabled,
  oidcRedirectUri,
  port,
  secureLocalNet,
  smtpConfigured,
  trustProxy,
} from './core/config.ts';
import { createApp } from './http/app.ts';
import { stopOnSignals } from './http/shutdown.ts';

export type { Context } from './core/context.ts';

/** Where Postgres listens when a connection string names no port. */
const DEFAULT_POSTGRES_PORT = 5432;
/** Every interface. The container's port mapping decides who can reach it. */
const LISTEN_HOST = '0.0.0.0';

const __dirname = dirname(fileURLToPath(import.meta.url));

// A container started beside its database usually wins the race, so wait for
// Postgres instead of exiting on the first refused connection.
try {
  await waitForDatabase(db, { connectTimeoutMs: dbConnectTimeoutMs() });
} catch (error) {
  // A misconfigured DATABASE_URL would otherwise surface as a driver stack
  // trace. Name the actual problem instead.
  const code = errorCode(error);
  if (code !== undefined && RETRYABLE_CODES.includes(code)) {
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

// Migrations run at boot so `docker compose up` on a fresh volume is the whole
// install. They are idempotent; a container restart is a no-op.
await migrate(db, { migrationsFolder: join(__dirname, '../../db/drizzle') });

// After migrate: the provider may be a pairing, which lives in the database.
const authHost = await createAuthHost(db);
const app = await createApp({
  db,
  authHost,
  allowedOrigins: allowedOrigins(),
  trustProxy: trustProxy(),
  mcp: mcpEnabled(),
  staticDir: join(__dirname, '../../app/dist'),
});

const server = app.listen(port(), LISTEN_HOST, () => {
  console.log(`[boot] Ethos ready at http://localhost:${port()}`);
  console.log(`[boot] GraphQL at http://localhost:${port()}/graphql`);
  const oidc = authHost.oidc();
  if (oidc !== null) {
    // The redirect URI is the one thing the operator has to copy into the provider, exactly.
    console.log(`[auth] sign-in with ${oidc.name} (${oidc.issuer}); redirect URI ${oidcRedirectUri()}`);
  }
  if (secureLocalNet()) {
    console.warn('[auth] SECURE_LOCAL_NET is on: any email address signs in without a link. Private networks only.');
  } else if (smtpConfigured() === false && oidc === null) {
    console.warn(
      '[auth] Nobody can sign in: set SMTP_URL to email sign-in links, set OIDC_ISSUER or pair a provider from the sign-in page, or SECURE_LOCAL_NET on a private network.',
    );
  }
});

stopOnSignals(server, { after: closeDatabase });
