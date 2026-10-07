import type { BuildSchemaConfig, RowScope } from '@vantreeseba/drizzle-graphql';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../auth/resolvers.ts';
import type { Context } from '../core/context.ts';

// Multi-tenancy, expressed as drizzle-graphql configuration rather than as
// resolver wrappers. `scope` is ANDed into the SQL of every read, update and
// delete the library generates, after the client's own `where`, so a client
// filter can only narrow it. `contextValues` takes `userId` out of every create
// and update input and stamps it from the request; what a `scope` cannot reach —
// plain inserts and the rows a foreign key points at — is graphql/write-guards.ts.
//
// A new table needs an entry here, or its rows are visible across tenants;
// __tests__/graphql/tenancy.test.ts fails when one is missing.

/**
 * Every table but `users` carries its own `user_id`. An entry is owned through
 * its habit as well, but carrying the column directly costs one uuid a row and
 * lets every table share the same one-line scope — the same trade telos makes
 * for its junction tables.
 */
export const USER_OWNED_TABLES = ['habits', 'habitEntries'] as const;

/** Every table drizzle-graphql will generate fields for. */
export const ALL_TABLES = ['users', ...USER_OWNED_TABLES] as const;

/**
 * Limits a table to the rows whose `userId` is the caller's.
 *
 * @param context - The request context.
 * @param table - The table being read or written.
 * @returns The SQL condition.
 */
const scopeByUserId: RowScope<Context> = (context, table) => eq(table.userId, requireAuth(context));

/**
 * Limits `users` to the caller's own row.
 *
 * @param context - The request context.
 * @param table - The table being read or written.
 * @returns The SQL condition.
 */
const scopeByOwnId: RowScope<Context> = (context, table) => eq(table.id, requireAuth(context));

export const scope: NonNullable<BuildSchemaConfig['scope']> = {
  // A user row is only ever visible to its owner. There is no directory here.
  users: scopeByOwnId,
  ...Object.fromEntries(USER_OWNED_TABLES.map((name) => [name, scopeByUserId])),
};

/**
 * Columns the server owns: removed from every create and update input, stamped
 * from the request on insert. This is what makes `userId` unstatable rather than
 * merely overwritten.
 */
export const contextValues: NonNullable<BuildSchemaConfig['contextValues']> = Object.fromEntries(
  USER_OWNED_TABLES.map((name) => [name, { userId: (context: Context) => requireAuth(context) }]),
);

/**
 * Tables whose writes belong to a hand-written mutation instead of generated CRUD.
 *
 * `users` is the auth flow's (auth/resolvers.ts): an account exists because a
 * sign-in created it. `habitEntries` is `markHabit`'s — a generated insert would
 * let a client write a second row for a day that already has one, or a
 * fifty-first skip in a week, and every rate and streak in the app is counted
 * off those rows. One day, one row, one way in.
 */
const WRITES_RESERVED = new Set<string>(['users', 'habitEntries']);

/**
 * Whether drizzle-graphql generates mutations for a table.
 *
 * @param table - The table's key.
 * @returns false for the tables in `WRITES_RESERVED`.
 */
const allowsGeneratedWrites = (table: string) => WRITES_RESERVED.has(table) === false;

export const features: NonNullable<BuildSchemaConfig['features']> = {
  insert: allowsGeneratedWrites,
  update: allowsGeneratedWrites,
  updateMany: allowsGeneratedWrites,
  delete: allowsGeneratedWrites,
};
