import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import type { DB } from '@ethos/db';
import type { RequestHandler } from 'express';
import type { RateLimiter } from '../auth/rate-limit.ts';
import { extractUserId } from '../auth/resolvers.ts';
import { type Context, UNKNOWN_IP } from '../core/context.ts';
import { createSchema } from './build-schema.ts';
import { createLoaders } from './loaders.ts';
import { operationLimits } from './operation-limits.ts';

/** What the handler passes on to resolvers. */
interface GraphQLHandlerDeps {
  db: DB;
  limiter: RateLimiter;
}

/**
 * Builds and starts Apollo Server over `db`, as Express middleware for /graphql.
 *
 * @param deps - The database and the sign-in limiter every resolver is given.
 * @returns The middleware.
 */
export async function createGraphQLHandler({ db, limiter }: GraphQLHandlerDeps): Promise<RequestHandler> {
  const { schema } = createSchema(db);
  const apolloServer = new ApolloServer<Context>({
    schema,
    // Apollo would install its own SIGTERM handler and race the one in
    // http/shutdown.ts, which is the one that drains and closes the database.
    stopOnTerminationSignals: false,
    plugins: [operationLimits()],
  });
  await apolloServer.start();

  return expressMiddleware(apolloServer, {
    // Loaders are built per request: their batching is only ever valid within
    // one request, and their cache must not outlive it.
    context: async ({ req }) => ({
      db,
      limiter,
      userId: extractUserId(req),
      ip: req.ip ?? UNKNOWN_IP,
      loaders: createLoaders(db),
    }),
  });
}
