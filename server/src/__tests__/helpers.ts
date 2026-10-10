import type { Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { relations } from '@ethos/db/relations';
import * as dbSchema from '@ethos/db/schema';
import { getTableName, is, sql, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { type ExecutionResult, type GraphQLSchema, graphql } from 'graphql';
import { inject } from 'vitest';
import { type Auth, createAuth, type MagicLink } from '../auth/better-auth.ts';
import { createRateLimiter, type RateLimiter } from '../auth/rate-limit.ts';
import type { Context } from '../core/context.ts';
import { createSchema } from '../graphql/build-schema.ts';
import { createLoaders } from '../graphql/loaders.ts';

// A throwaway in-memory Postgres per suite. `@ethos/db` is deliberately never
// imported here — it opens a real connection at import time — so the schema is
// pulled from `@ethos/db/schema`, which is inert.

// biome-ignore lint/suspicious/noExplicitAny: db type varies by driver
export type TestDb = any;

declare module 'vitest' {
  interface ProvidedContext {
    /** The DDL for the current models, worked out once per run by `global-setup.ts`. */
    schemaSql: string[];
  }
}

/** Every table in the schema, quoted for a statement that names them all. */
const TABLE_LIST = Object.values(dbSchema)
  .flatMap((value) => (is(value, Table) ? [`"${getTableName(value)}"`] : []))
  .join(', ');

/** One schema per database: building it is most of what a client costs, and only `db` shapes it. */
const schemas = new WeakMap<object, GraphQLSchema>();

/** One auth instance per database, for the clients that do not bring their own. */
const auths = new WeakMap<object, Auth>();

/** Long enough for better-auth, and never a real secret. */
export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789';

/**
 * Builds an auth instance that captures sign-in links where production would email them.
 *
 * @param db - A database from `createTestDb`.
 * @returns The auth instance, and the links it was asked to deliver, oldest first.
 */
export function createTestAuth(db: TestDb): { auth: Auth; links: MagicLink[] } {
  const links: MagicLink[] = [];
  const auth = createAuth(db, {
    secret: TEST_SECRET,
    sendMagicLink: async (link) => {
      links.push(link);
    },
  });
  return { auth, links };
}

/**
 * Builds an auth instance with no way to deliver a link, as an instance without SMTP has.
 *
 * @param db - A database from `createTestDb`.
 * @returns The auth instance.
 */
export function createLinklessAuth(db: TestDb): Auth {
  return createAuth(db, { secret: TEST_SECRET });
}

/**
 * Signs a user in without a link, the way SECURE_LOCAL_NET does.
 *
 * @param auth - The auth instance the session is made on.
 * @param userId - The user to sign in.
 * @returns The session token, to send as `Authorization: Bearer`.
 */
export async function createSessionToken(auth: Auth, userId: string): Promise<string> {
  const { internalAdapter } = await auth.$context;
  const session = await internalAdapter.createSession(userId);
  return session.token;
}

/**
 * Builds a fresh in-memory Postgres with the models' schema in it. Booting one is the
 * expensive part of a suite, so a file makes it in `beforeAll`, empties it with
 * `resetTestDb` between tests, and hands it to `closeTestDb` when it is done.
 *
 * @returns The database.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite('memory://');
  for (const statement of inject('schemaSql')) {
    await client.exec(statement);
  }
  return drizzle({ client, relations });
}

/**
 * Empties every table, so the next test starts from the database `createTestDb` returned.
 *
 * @param db - A database from `createTestDb`.
 */
export async function resetTestDb(db: TestDb): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLE_LIST} RESTART IDENTITY CASCADE`));
}

/**
 * Shuts a test database down. An instance left open holds its whole Postgres in memory until the worker exits.
 *
 * @param db - A database from `createTestDb`.
 */
export async function closeTestDb(db: TestDb): Promise<void> {
  await db.$client.close();
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
  /** The auth instance. The default is one per database that captures its links and shows them to nobody. */
  auth?: Auth;
  /** The request's headers, for a resolver that reads the session itself. The default is none. */
  headers?: Headers;
  /** Pass a small one to reach the budget. The default is `createRateLimiter()`. */
  limiter?: RateLimiter;
  /** The address the request is taken to come from. The default is `TEST_IP`. */
  ip?: string;
}

/** Where a test client's requests come from unless it says otherwise. */
export const TEST_IP = '127.0.0.1';

export function createClient(db: TestDb, userId: string | null, deps: ClientDeps = {}): TestClient {
  const { limiter = createRateLimiter(), ip = TEST_IP, headers = new Headers() } = deps;
  const schema = schemas.get(db) ?? createSchema(db).schema;
  schemas.set(db, schema);
  const auth = deps.auth ?? auths.get(db) ?? createTestAuth(db).auth;
  if (deps.auth === undefined) {
    auths.set(db, auth);
  }

  const run = async (query: string, variables?: Record<string, unknown>) => {
    const contextValue: Context = { db, auth, userId, headers, ip, limiter, loaders: createLoaders(db) };
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
