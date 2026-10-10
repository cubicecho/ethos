import type { DB } from '@ethos/db';
import cors from 'cors';
import express, { type Express } from 'express';
import { type Auth, createAuth } from '../auth/better-auth.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import { HTTP_DEFAULTS, type HttpSettings } from '../core/defaults.ts';
import { HttpStatus } from '../core/wire.ts';
import { createGraphQLHandler } from '../graphql/handler.ts';
import { checkHealth } from './health.ts';
import { createStaticHandler } from './static.ts';

/** What the app talks to. Tests pass PGlite. */
export interface AppDeps {
  db: DB;
  /** The better-auth instance. Tests pass one that captures links; the default is `createAuth(db)`. */
  auth?: Auth;
  /** Sign-in throttle. Tests pass a tighter one; the default is `createRateLimiter()`. */
  limiter?: RateLimiter;
  /** Origins a browser may call from, or `true` for any. The default is none but the app's own. */
  allowedOrigins?: string[] | true;
  /** Express's `trust proxy`: whether, and how far, to believe `X-Forwarded-For`. */
  trustProxy?: HttpSettings['trustProxy'];
  /** The built web client's directory. Left out in tests that do not serve it. */
  staticDir?: string;
}

/**
 * Builds the Express app: /graphql, /healthz and the web client.
 *
 * It does not listen, migrate or read the environment, so a test can build the
 * app production runs.
 *
 * @param deps - The database, and what the environment would otherwise decide.
 * @returns The app.
 */
export async function createApp({
  db,
  auth = createAuth(db),
  limiter = createRateLimiter(),
  allowedOrigins = [],
  trustProxy = HTTP_DEFAULTS.trustProxy,
  staticDir,
}: AppDeps): Promise<Express> {
  const app = express();

  // Decides what `request.ip` is, and the sign-in throttle is keyed by it.
  app.set('trust proxy', trustProxy);
  app.use(cors({ origin: allowedOrigins }));
  const graphql = createGraphQLHandler({ db, auth, limiter });
  app.use(graphql.graphqlEndpoint, express.json({ limit: HTTP_DEFAULTS.bodyLimit }));
  // `all`, not `use`: a mounted `use` strips the path, and Yoga matches graphqlEndpoint itself.
  app.all(graphql.graphqlEndpoint, (request, response) => graphql(request, response));
  app.get('/healthz', async (_request, response) => {
    const health = await checkHealth(db);
    response.status(health.ok ? HttpStatus.Ok : HttpStatus.ServiceUnavailable).json(health);
  });
  if (staticDir !== undefined) {
    const serveStatic = createStaticHandler(staticDir);
    app.use((request, response) => serveStatic(request, response));
  }
  return app;
}
