import { buildSchema, GraphQLDateTime } from '@vantreeseba/drizzle-graphql';
import { applyAuthExtension } from '../auth/resolvers.ts';
import { OPERATION_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { applyHabitsExtension } from '../habits/resolvers.ts';
import { contextValues, features, scope } from './tenancy.ts';
import { onWrite } from './write-guards.ts';

// The whole CRUD surface is generated from the Drizzle schema — there are no
// hand-written create/read/update/delete resolvers, and adding a column to a
// table is all it takes to expose it. What generated CRUD cannot express is
// layered on top by the two extensions below.
//
// Kept separate from schema.ts, which binds it to the real database, so a test
// can build the same schema against a throwaway one.

// biome-ignore lint/suspicious/noExplicitAny: db type varies by driver
type AnyDb = any;

/**
 * Timestamps get their *input* scalar declared rather than detected. The
 * library's own input remapper turns the null of a nullable timestamp into
 * 1970-01-01, and un-archiving a habit is exactly that write. Input only: the
 * same override on the output side would hand resolvers a `Date` where they
 * have always had a string. A rule rather than a per-column list, so the next
 * nullable timestamp is already covered.
 */
function timestampInput(column: { columnType: string }): { input: typeof GraphQLDateTime } | undefined {
  return column.columnType === 'PgTimestamp' ? { input: GraphQLDateTime } : undefined;
}

// The return type is inferred rather than written out: `GeneratedEntities` is
// keyed by the naming config, so spelling it here would mean restating
// `typeNameMapper` in a second place that could disagree with the first.
export function createSchema(db: AnyDb) {
  const { schema: drizzleSchema, entities } = buildSchema(db, {
    prefixes: {
      insert: 'create',
      update: 'update',
      delete: 'delete',
    },
    // Table keys are plural (`habits`); derive singular names for the type and
    // single-row fields (Habit, habit, createHabit).
    typeNameMapper: 'singularize',
    // Multi-tenancy lives in the generated SQL, not in resolver wrappers.
    scope,
    contextValues,
    features,
    mapColumnType: timestampInput,
    // Applies to root lists and to-many relations alike. A `limit` over the
    // maximum is refused, not trimmed: a trimmed page looks like the last one.
    limits: {
      defaultLimit: OPERATION_LIMIT_DEFAULTS.defaultPageSize,
      maxLimit: OPERATION_LIMIT_DEFAULTS.maxPageSize,
    },
    // Prices each list by its `limit`, for graphql/operation-limits.ts to add up.
    complexity: true,
    onWrite,
  });

  const schema = applyHabitsExtension(applyAuthExtension(drizzleSchema));

  return { schema, entities };
}
