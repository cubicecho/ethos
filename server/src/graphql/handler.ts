import type { DB } from '@ethos/db';
import type { Request } from 'express';
import { type GraphQLSchema, NoSchemaIntrospectionCustomRule } from 'graphql';
import { createYoga, type Plugin } from 'graphql-yoga';
import type { AuthHost } from '../auth/auth-host.ts';
import { sessionUserId } from '../auth/better-auth.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import { isProduction } from '../core/config.ts';
import { type Context, UNKNOWN_IP } from '../core/context.ts';
import { createLoaders } from './loaders.ts';
import { graphqlLogger } from './logger.ts';
import { useOperationLimits } from './operation-limits.ts';

/** What every request's context is built from. */
export interface ContextDeps {
  db: DB;
  /** Hands out the current auth instance. Pairing a provider rebuilds it while the server runs. */
  authHost: AuthHost;
  limiter: RateLimiter;
}

/** Builds one request's context from its headers and the caller's address. */
export type ContextFactory = (headers: Headers, ip?: string) => Promise<Context>;

/**
 * Builds the context factory /graphql and /mcp share, so both read the caller the same way.
 *
 * Loaders are built per call: their batching is only ever valid within one
 * request, and their cache must not outlive it.
 *
 * @param deps - The database, the auth host and the sign-in limiter every resolver is given.
 * @returns The factory.
 */
export function createContextFactory({ db, authHost, limiter }: ContextDeps): ContextFactory {
  return async (headers, ip = UNKNOWN_IP) => {
    // Asked per request: pairing a provider swaps the instance while the server runs.
    const auth = authHost.current();
    return {
      db,
      auth,
      authHost,
      limiter,
      userId: await sessionUserId(auth, headers),
      headers,
      ip,
      loaders: createLoaders(db),
    };
  };
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
 * Builds the Yoga handler for /graphql.
 *
 * @param schema - The schema to serve.
 * @param contextFor - Builds a request's context.
 * @returns The Yoga instance, callable as Express middleware.
 */
export function createGraphQLHandler(schema: GraphQLSchema, contextFor: ContextFactory) {
  return createYoga<ServerContext, Context>({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: isProduction() === false,
    // Masked errors are logged here with their real cause.
    logging: graphqlLogger,
    plugins: [useOperationLimits(), ...(isProduction() ? [useNoIntrospection()] : [])],
    // Express's view of the caller, which honours TRUST_PROXY.
    context: ({ request, req }) => contextFor(request.headers, req?.ip),
  });
}
