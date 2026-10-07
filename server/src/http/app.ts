import type { DB } from '@ethos/db';
import cors from 'cors';
import express, { type Express } from 'express';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import { HttpStatus } from '../core/wire.ts';
import { createGraphQLHandler } from '../graphql/handler.ts';
import { checkHealth } from './health.ts';
import { createStaticHandler } from './static.ts';

/** What the app talks to. Tests pass PGlite. */
export interface AppDeps {
  db: DB;
  /** Sign-in throttle. Tests pass a tighter one; the default is `createRateLimiter()`. */
  limiter?: RateLimiter;
  /** Origins a browser may call from, or `true` for any. The default is none but the app's own. */
  allowedOrigins?: string[] | true;
  /** The built web client's directory. Left out in tests that do not serve it. */
  staticDir?: string;
}

/**
 * Builds the Express app: /graphql, /healthz and the web client.
 *
 * It does not listen, migrate or read the environment, so a test can build the
 * app production runs. Async only because Apollo Server has to start.
 */
export async function createApp({
  db,
  limiter = createRateLimiter(),
  allowedOrigins = [],
  staticDir,
}: AppDeps): Promise<Express> {
  const app = express();

  app.use(cors({ origin: allowedOrigins }));
  app.use('/graphql', express.json(), await createGraphQLHandler({ db, limiter }));
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
