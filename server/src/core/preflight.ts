// Environment checks that must run before anything opens a connection or signs a
// token. Imported for its side effects as the very first import of index.ts, so
// a misconfigured instance fails with a sentence rather than a stack trace.

import { configuredJwtSecret, databaseUrl, describeWeakSecret, isProduction } from './config.ts';

/**
 * Reports a configuration fault and exits with status 1.
 *
 * @param message - What is wrong, as a sentence.
 */
function fatal(message: string): never {
  console.error(`[preflight] ${message}`);
  process.exit(1);
}

if (databaseUrl() === '') {
  fatal('DATABASE_URL is required. Copy .env.example to .env, then run `npm run db:up` for a local Postgres.');
}

if (isProduction()) {
  const weakness = describeWeakSecret(configuredJwtSecret());
  if (weakness !== undefined) {
    fatal(`JWT_SECRET ${weakness}. Set a strong random value: generate one with \`openssl rand -hex 32\`.`);
  }
}
