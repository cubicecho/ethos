import * as dbSchema from '@ethos/db/schema';
import { ENTRY_DONE, ENTRY_SKIPPED, type EntryStatus } from '@ethos/db/schema';
import { and, eq } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { requireAuth } from '../auth/resolvers.ts';
import type { Context } from '../core/context.ts';
import { HABIT_DEFAULTS } from '../core/defaults.ts';
import { badInput, notFound } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { entryNote } from './input.ts';
import { assertDay, daysBetween, periodOf } from './periods.ts';
import { currentStreak, type EntryLike, type HabitLike, longestStreak, tallyPeriod, tallyRecent } from './streaks.ts';

// What generated CRUD cannot express: the derived fields the grid reads, and the
// one state transition that carries rules — recording a day, which the day key
// and the skip cap both constrain.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 table/column type compat
type AnyRow = any;

const HABITS_SDL = parse(`
  "One period of a habit's cadence, counted. Days are \`YYYY-MM-DD\`."
  type HabitPeriod {
    "First day of the period."
    start: String!
    "The day after the period's last — exclusive, so periods tile without overlapping."
    end: String!
    "Days kept."
    done: Int!
    "Days deliberately declined."
    skipped: Int!
    "What the habit asks of a period, before any skips."
    target: Int!
    "What this period actually asked for, once its skips came off."
    effectiveTarget: Int!
    "Whether the period was kept. A period skipped down to nothing owed was."
    met: Boolean!
    "done / effectiveTarget, clamped to 1."
    rate: Float!
  }

  extend type Habit {
    "Periods kept in an unbroken run up to now. The period in progress cannot break it."
    streak(today: String): Int!
    "The longest run of kept periods there has ever been."
    longestStreak(today: String): Int!
    "The last \`periods\` periods, oldest first — the order the grid is read in."
    history(periods: Int = 12, today: String): [HabitPeriod!]!
    "The period today falls in."
    current(today: String): HabitPeriod!
  }

  extend type Mutation {
    """
    Records one day of one habit. \`day\` is the keeper's own \`YYYY-MM-DD\`, and the
    day is the key: marking the same day twice rewrites the one row it has.
    """
    markHabit(habitId: ID!, day: String!, status: String = "done", note: String): Habit!
    "Removes a day's entry, leaving it untouched rather than missed."
    clearHabit(habitId: ID!, day: String!): Habit!
  }
`);

/**
 * The day the server is having, in UTC.
 *
 * Only ever a fallback. A day belongs to whoever kept it, so the client sends
 * its own `today` with anything that has to know which period is the current
 * one — a server in Berlin has no business telling someone in Auckland that
 * their Monday has not started.
 */
function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One answer for a habit that is missing and a habit that is someone else's. */
const habitNotFound = () => notFound('Habit not found');

/**
 * A habit the caller owns, or NOT_FOUND. The hand-written mutations sit outside
 * the generated resolvers, so they do not inherit the `scope` from tenancy.ts
 * and have to state ownership themselves.
 */
async function loadOwnedHabit(context: Context, id: string): Promise<AnyRow> {
  const userId = requireAuth(context);
  const rows = await context.db
    .select()
    .from(dbSchema.habits)
    .where(and(eq(dbSchema.habits.id, id), eq(dbSchema.habits.userId, userId)))
    .limit(1);
  if (rows.length === 0) {
    throw habitNotFound();
  }
  return rows[0];
}

function parseStatus(value: string | null | undefined): EntryStatus {
  if (value == null || value === ENTRY_DONE) {
    return ENTRY_DONE;
  }
  if (value === ENTRY_SKIPPED) {
    return ENTRY_SKIPPED;
  }
  throw badInput(`"${value}" is not a status. Expected "done" or "skipped".`);
}

/**
 * Rejects a day that has not happened anywhere yet.
 *
 * One day of slack, not none: the caller's `day` is their local one, and while
 * it is the 17th in UTC someone in Auckland is honestly on the 18th. Past that
 * there is no zone that explains it, and a habit marked kept for next month is a
 * streak nobody earned.
 */
function assertNotFuture(day: string): void {
  if (daysBetween(serverToday(), day) > 1) {
    throw badInput('That day has not happened yet.');
  }
}

/**
 * Refuses the skip that would take a period past the cap.
 *
 * Counted over the period's existing entries rather than incremented: rewriting
 * a day that is already a skip is not a new one, and a period at the cap must
 * still be able to change its mind about which days it declined.
 */
function assertSkipAllowed(habit: AnyRow, entries: readonly { day: string; status: EntryStatus }[], day: string): void {
  const range = periodOf(habit.period, day);
  const skips = entries.filter(
    (entry) => entry.status === ENTRY_SKIPPED && entry.day >= range.start && entry.day < range.end && entry.day !== day,
  );
  if (skips.length < HABIT_DEFAULTS.maxSkipsPerPeriod) {
    return;
  }
  throw badInput(
    `Already skipped ${skips.length} days of “${habit.name}” this ${habit.period}. The limit is ${HABIT_DEFAULTS.maxSkipsPerPeriod}.`,
  );
}

/** The periods field resolvers share: the habit's entries, as streaks.ts reads them. */
function entriesOf(parent: AnyRow, context: Context): Promise<EntryLike[]> {
  return context.loaders.entries.load(String(parent.id));
}

/**
 * The cadence the derived fields are counted over.
 *
 * Loaded rather than read off `parent`: the generated resolvers select the
 * columns the client asked for, so `{ streak }` with no `period` alongside it
 * arrives here as a row with no cadence — and `periodOf(undefined, day)` does
 * not fail, it silently answers with a month. What a streak means must not
 * depend on what else the caller happened to select.
 */
async function cadenceOf(parent: AnyRow, context: Context): Promise<HabitLike> {
  const cadence = await context.loaders.cadence.load(String(parent.id));
  if (!cadence) {
    throw habitNotFound();
  }
  return cadence;
}

/** Both halves at once — every derived field wants the cadence and the entries. */
async function readingOf(parent: AnyRow, context: Context): Promise<[HabitLike, readonly EntryLike[]]> {
  return Promise.all([cadenceOf(parent, context), entriesOf(parent, context)]);
}

export function applyHabitsExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, HABITS_SDL);

  const habitFields = assertObjectType(extendedSchema.getType('Habit')).getFields();

  habitFields.streak.resolve = async (parent: AnyRow, args: { today: string | null }, context: Context) => {
    const [habit, entries] = await readingOf(parent, context);
    return currentStreak(habit, entries, assertDay(args.today ?? serverToday()));
  };

  habitFields.longestStreak.resolve = async (parent: AnyRow, args: { today: string | null }, context: Context) => {
    const [habit, entries] = await readingOf(parent, context);
    return longestStreak(habit, entries, assertDay(args.today ?? serverToday()));
  };

  habitFields.history.resolve = async (
    parent: AnyRow,
    args: { periods: number | null; today: string | null },
    context: Context,
  ) => {
    // Clamped rather than validated: a grid asking for a thousand periods is a
    // client bug, and answering with the most allowed is more useful than an error.
    const asked = args.periods ?? HABIT_DEFAULTS.historyPeriods;
    const periods = Math.min(Math.max(asked, 1), HABIT_DEFAULTS.maxHistoryPeriods);
    const [habit, entries] = await readingOf(parent, context);
    return tallyRecent(habit, entries, assertDay(args.today ?? serverToday()), periods);
  };

  habitFields.current.resolve = async (parent: AnyRow, args: { today: string | null }, context: Context) => {
    const [habit, entries] = await readingOf(parent, context);
    const today = assertDay(args.today ?? serverToday());
    return tallyPeriod(habit, entries, periodOf(habit.period, today));
  };

  const mutations = assertObjectType(extendedSchema.getType('Mutation')).getFields();

  mutations.markHabit.resolve = async (
    _parent: unknown,
    args: { habitId: string; day: string; status: string | null; note: string | null },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    const habit = await loadOwnedHabit(context, args.habitId);
    const day = assertDay(args.day);
    assertNotFuture(day);
    const status = parseStatus(args.status);
    parseOrThrow(entryNote, args.note);

    if (habit.archivedAt != null) {
      // An archived habit is a record, not a practice. Silently accepting the
      // day would make the archive a place where history keeps changing.
      throw badInput(`“${habit.name}” is archived. Restore it before recording a day.`);
    }
    if (status === ENTRY_SKIPPED) {
      assertSkipAllowed(habit, await entriesOf(habit, context), day);
    }

    // Upsert onto the day key: two tabs, a double-click and a retried request
    // are the same tick, and the unique index makes that true with no transaction.
    await context.db
      .insert(dbSchema.habitEntries)
      .values({ userId, habitId: habit.id, day, status, note: args.note ?? null })
      .onConflictDoUpdate({
        target: [dbSchema.habitEntries.habitId, dbSchema.habitEntries.day],
        set: { status, note: args.note ?? null, updatedAt: new Date() },
      });

    // The loader's answer predates this write, and the request is not over: the
    // habit returned here is about to be asked for its streak.
    context.loaders.entries.clear(habit.id);
    return habit;
  };

  mutations.clearHabit.resolve = async (_parent: unknown, args: { habitId: string; day: string }, context: Context) => {
    const userId = requireAuth(context);
    const habit = await loadOwnedHabit(context, args.habitId);
    await context.db
      .delete(dbSchema.habitEntries)
      .where(
        and(
          eq(dbSchema.habitEntries.userId, userId),
          eq(dbSchema.habitEntries.habitId, habit.id),
          eq(dbSchema.habitEntries.day, assertDay(args.day)),
        ),
      );
    context.loaders.entries.clear(habit.id);
    return habit;
  };

  return extendedSchema;
}
