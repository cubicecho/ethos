import * as dbSchema from '@ethos/db/schema';
import type { BuildSchemaConfig, WriteHookPayload } from '@vantreeseba/drizzle-graphql';
import { and, eq, inArray } from 'drizzle-orm';
import { GraphQLError } from 'graphql';
import { assertTargetsFitPeriods } from '../cadence.ts';
import type { Context } from '../context.ts';
import { requireAuth } from './auth.ts';

// A row scope confines reads, updates and deletes, but it cannot reach a plain
// insert, and it says nothing about the rows a foreign key *points at*. These
// hooks close the two holes that leaves:
//
//   1. Ownership on insert — every id a caller can state must be theirs.
//   2. Cadence on write — a habit that asks for more days than its period holds
//      is refused however the write arrives, so the generated `updateHabit`
//      cannot route around the rule that `createHabit` obeys.
//
// They run inside the mutation's own transaction, so a throw rolls the write
// back and there is no window between the check and the write.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 table/column type compat
type AnyTable = any;
type Row = Record<string, unknown>;

/** A foreign key and the parent table that says whether the caller owns its target. */
interface ForeignKey {
  /** Column property name on the referencing table. */
  key: string;
  /** Name used in the "not found" a caller sees — never leak another user's row. */
  entity: string;
  parent: AnyTable;
}

const habit: ForeignKey = { key: 'habitId', entity: 'Habit', parent: dbSchema.habits };

/**
 * Every user-facing foreign key, by the table that carries it.
 *
 * `habitEntries` is here although its generated writes are off (see
 * tenancy.ts): `markHabit` performs the same check itself, and the day someone
 * turns those writes back on is the day this entry is the only thing standing
 * between a caller and someone else's habit. A new table with a foreign key a
 * caller can state belongs in this map.
 */
const FOREIGN_KEYS: Record<string, ForeignKey[]> = {
  habitEntries: [habit],
};

/**
 * The rows a mutation is about to write: `values` on a create (one row or a
 * list), `set` on an update, one `set` per entry on a batch update. A delete
 * writes nothing and so has nothing to check.
 */
export function writtenRows(args: { values?: Row | Row[]; set?: Row; updates?: Array<{ set?: Row }> }): Row[] {
  if (args.values) return Array.isArray(args.values) ? args.values : [args.values];
  if (args.updates) return args.updates.flatMap((entry) => (entry.set ? [entry.set] : []));
  return args.set ? [args.set] : [];
}

export async function assertForeignKeysOwned(
  tx: AnyTable,
  userId: string,
  rows: Row[],
  foreignKeys: ForeignKey[],
): Promise<void> {
  for (const fk of foreignKeys) {
    const referenced = [
      ...new Set(rows.map((row) => row[fk.key]).filter((id): id is string => typeof id === 'string')),
    ];
    if (referenced.length === 0) continue;
    const owned: Array<{ id: string }> = await tx
      .select({ id: fk.parent.id })
      .from(fk.parent)
      .where(and(inArray(fk.parent.id, referenced), eq(fk.parent.userId, userId)));
    const ownedIds = new Set(owned.map((row) => row.id));
    if (referenced.some((id) => !ownedIds.has(id))) {
      // NOT_FOUND, not FORBIDDEN: "you may not touch this" would confirm the row
      // exists, which is itself something the caller is not entitled to know.
      throw new GraphQLError(`${fk.entity} not found`, { extensions: { code: 'NOT_FOUND' } });
    }
  }
}

/**
 * Whether a day ever counted is `markHabit`'s to decide. A generated write onto
 * `habit_entries` would be a second row for a day that already has one, or a
 * skip past the cap — and every rate in the app is counted off those rows.
 */
function assertEntriesUntouched(args: Parameters<typeof writtenRows>[0]): void {
  if (writtenRows(args).length === 0) return;
  throw new GraphQLError('Use markHabit and clearHabit to record a day.', {
    extensions: { code: 'BAD_USER_INPUT' },
  });
}

export const onWrite: NonNullable<BuildSchemaConfig['onWrite']> = {
  habitEntries: {
    before: async ({ args, context, tx }: WriteHookPayload) => {
      assertEntriesUntouched(args);
      await assertForeignKeysOwned(tx, requireAuth(context as Context), writtenRows(args), FOREIGN_KEYS.habitEntries);
    },
  },
  habits: {
    // After the statement rather than before it: an update may name the rows it
    // affects by anything at all, and a write that moves a habit from monthly to
    // weekly without restating its target is exactly the one a check reading the
    // arguments would wave through. The throw rolls the transaction back,
    // statement included.
    after: async ({ context, operation, tx }: WriteHookPayload) => {
      if (operation === 'delete' || operation === 'restore') return;
      await assertTargetsFitPeriods(tx, requireAuth(context as Context));
    },
  },
};
