import type { Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { relations } from '@ethos/db/relations';
import * as dbSchema from '@ethos/db/schema';
import { pushSchema } from 'drizzle-kit/api-postgres';
import { drizzle } from 'drizzle-orm/pglite';
import { type ExecutionResult, graphql } from 'graphql';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import type { Context } from '../core/context.ts';
import { createSchema } from '../graphql/build-schema.ts';
import { createLoaders } from '../graphql/loaders.ts';

// A throwaway in-memory Postgres per suite. `@ethos/db` is deliberately never
// imported here — it opens a real connection at import time — so the schema is
// pulled from `@ethos/db/schema`, which is inert.

// biome-ignore lint/suspicious/noExplicitAny: db type varies by driver
export type TestDb = any;

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite('memory://');
  const db = drizzle({ client, relations });
  const { apply } = await pushSchema(dbSchema, db);
  await apply();
  return db;
}

/** A user row created straight through Drizzle — signup is not what is under test. */
export async function createUser(db: TestDb, email: string): Promise<string> {
  const [user] = await db.insert(dbSchema.users).values({ email }).returning();
  return user.id as string;
}

export interface TestClient {
  /** Runs an operation as `userId`, or unauthenticated when it is null. */
  run: (query: string, variables?: Record<string, unknown>) => Promise<ExecutionResult>;
  /** Runs an operation and throws unless it succeeded, returning `data`. */
  // biome-ignore lint/suspicious/noExplicitAny: caller shapes the response
  expectOk: (query: string, variables?: Record<string, unknown>) => Promise<any>;
  /** Runs an operation, expects exactly one error, and returns it. */
  expectError: (
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<{ message: string; code: unknown; extensions?: Record<string, unknown> }>;
}

/** Collaborators a test shares between clients, or swaps for its own. */
export interface ClientDeps {
  /** Pass a small one to reach the budget. The default is `createRateLimiter()`. */
  limiter?: RateLimiter;
  /** The address the request is taken to come from. The default is `TEST_IP`. */
  ip?: string;
}

/** Where a test client's requests come from unless it says otherwise. */
export const TEST_IP = '127.0.0.1';

export function createClient(db: TestDb, userId: string | null, deps: ClientDeps = {}): TestClient {
  const { limiter = createRateLimiter(), ip = TEST_IP } = deps;
  const { schema } = createSchema(db);

  const run = async (query: string, variables?: Record<string, unknown>) => {
    const contextValue: Context = { db, userId, ip, limiter, loaders: createLoaders(db) };
    return graphql({ schema, source: query, contextValue, variableValues: variables });
  };

  return {
    run,
    expectOk: async (query, variables) => {
      const result = await run(query, variables);
      // graphql masks a thrown non-GraphQLError as "Internal server error";
      // surface the original so a broken test reads as the bug it is.
      if (result.errors?.length) {
        const [first] = result.errors;
        throw first.originalError ?? new Error(result.errors.map((error) => error.message).join('; '));
      }
      return result.data;
    },
    expectError: async (query, variables) => {
      const result = await run(query, variables);
      const error = result.errors?.[0];
      if (!error) {
        throw new Error('expected an error, got a successful result');
      }
      return { message: error.message, code: error.extensions?.code, extensions: error.extensions };
    },
  };
}

/** The port the OS gave a server that listened on port 0. */
export function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The test server is not listening on a TCP port.');
  }
  return address.port;
}
