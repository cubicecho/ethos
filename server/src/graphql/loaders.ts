import * as dbSchema from '@ethos/db/schema';
import DataLoader from 'dataloader';
import { asc, inArray } from 'drizzle-orm';
import type { EntryLike, HabitLike } from '../habits/streaks.ts';

// Per-request batching. The grid is a list of habits each asking for its own
// streak, its longest, and a row of periods — three fields over the same rows.
// One query here rather than three per habit.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 table/column type compat
type AnyDb = any;

const NO_ENTRIES: EntryLike[] = [];

/**
 * Every entry a habit has, not a window of them.
 *
 * `longestStreak` is defined over the whole history, so a window would have to
 * be as wide as the history anyway, and a personal habit's history is a few
 * thousand rows at the outside — one per day per habit, for as long as it has
 * been kept. Counting them in memory is what lets streaks.ts stay a pure module
 * with tests that need no database at all.
 *
 * @param db - The database.
 * @param habitIds - The habits to load for.
 * @returns Entries by habit id, oldest first. A habit with none has no key.
 */
async function findEntries(db: AnyDb, habitIds: readonly string[]): Promise<Map<string, EntryLike[]>> {
  const byHabit = new Map<string, EntryLike[]>();
  if (habitIds.length === 0) {
    return byHabit;
  }
  const rows: Array<{ habitId: string; day: string; status: EntryLike['status'] }> = await db
    .select({
      habitId: dbSchema.habitEntries.habitId,
      day: dbSchema.habitEntries.day,
      status: dbSchema.habitEntries.status,
    })
    .from(dbSchema.habitEntries)
    .where(inArray(dbSchema.habitEntries.habitId, [...habitIds]))
    .orderBy(asc(dbSchema.habitEntries.day));
  for (const row of rows) {
    const existing = byHabit.get(row.habitId);
    if (existing) {
      existing.push({ day: row.day, status: row.status });
    } else {
      byHabit.set(row.habitId, [{ day: row.day, status: row.status }]);
    }
  }
  return byHabit;
}

/**
 * A habit's cadence, loaded rather than read off the parent row.
 *
 * The generated resolvers select the columns the client asked for, so a query
 * that wants `streak` and not `period` hands the field resolver a row with no
 * cadence on it — and `periodOf(undefined, day)` is not an error, it is a
 * monthly period. Every derived field reads the cadence from here instead, so
 * what the streak is counted over does not depend on what else the caller
 * happened to select.
 *
 * @param db - The database.
 * @param habitIds - The habits to load for.
 * @returns Cadence by habit id. A habit that does not exist has no key.
 */
async function findCadences(db: AnyDb, habitIds: readonly string[]): Promise<Map<string, HabitLike>> {
  const byHabit = new Map<string, HabitLike>();
  if (habitIds.length === 0) {
    return byHabit;
  }
  const rows: Array<{ id: string; period: HabitLike['period']; targetCount: number }> = await db
    .select({
      id: dbSchema.habits.id,
      period: dbSchema.habits.period,
      targetCount: dbSchema.habits.targetCount,
    })
    .from(dbSchema.habits)
    .where(inArray(dbSchema.habits.id, [...habitIds]));
  for (const row of rows) {
    byHabit.set(row.id, { period: row.period, targetCount: row.targetCount });
  }
  return byHabit;
}

export interface Loaders {
  entries: DataLoader<string, EntryLike[]>;
  cadence: DataLoader<string, HabitLike | null>;
}

/**
 * Built once per request: a loader's batching window and its cache are only ever
 * valid within one request, and must not outlive it. Inside one they still have
 * to be told: `markHabit` writes an entry and then returns the habit, whose
 * streak is read through this loader, so the mutation clears its habit's key
 * before selecting — otherwise a tick would report the streak from before it.
 *
 * @param db - The database.
 * @returns The request's loaders.
 */
export function createLoaders(db: AnyDb): Loaders {
  return {
    entries: new DataLoader<string, EntryLike[]>(async (ids) => {
      const byHabit = await findEntries(db, ids);
      return ids.map((id) => byHabit.get(id) ?? NO_ENTRIES);
    }),
    cadence: new DataLoader<string, HabitLike | null>(async (ids) => {
      const byHabit = await findCadences(db, ids);
      return ids.map((id) => byHabit.get(id) ?? null);
    }),
  };
}
