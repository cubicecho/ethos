import type { DB } from '@ethos/db';
import type { Request } from 'express';
import { NoSchemaIntrospectionCustomRule } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import type { RateLimiter } from '../auth/rate-limit.ts';
import { extractUserId } from '../auth/resolvers.ts';
import { isProduction } from '../core/config.ts';
import { type Context, UNKNOWN_IP } from '../core/context.ts';
import { createSchema } from './build-schema.ts';
import { createLoaders } from './loaders.ts';
import { graphqlLogger } from './logger.ts';
import { useOperationLimits } from './operation-limits.ts';

/** What the handler passes on to resolvers. */
interface GraphQLHandlerDeps {
  db: DB;
  limiter: RateLimiter;
}

/** What Express hands Yoga alongside the fetch request. */
interface ServerContext {
  req?: Request;
}

/**
 * Refuses introspection, so a production instance does not hand out its schema.
 *
 * @returns The plugin, for `createYoga({ plugins })`.
 */
function useNoIntrospection(): Plugin {
  return {
    onValidate: ({ addValidationRule }) => {
      addValidationRule(NoSchemaIntrospectionCustomRule);
    },
  };
}

/**
 * Builds the Yoga handler for /graphql over `db`.
 *
 * @param deps - The database and the sign-in limiter every resolver is given.
 * @returns The Yoga instance, callable as Express middleware.
 */
export function createGraphQLHandler({ db, limiter }: GraphQLHandlerDeps) {
  const { schema } = createSchema(db);
  return createYoga<ServerContext, Context>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: isProduction() === false,
    // Masked errors are logged here with their real cause.
    logging: graphqlLogger,
    plugins: [useOperationLimits(), ...(isProduction() ? [useNoIntrospection()] : [])],
    // Loaders are built per request: their batching is only ever valid within
    // one request, and their cache must not outlive it.
    context: ({ request, req }): Context => ({
      db,
      limiter,
      userId: extractUserId({ headers: { authorization: request.headers.get('authorization') ?? undefined } }),
      // Express's view of the caller, which honours TRUST_PROXY.
      ip: req?.ip ?? UNKNOWN_IP,
      loaders: createLoaders(db),
    }),
  });
}
