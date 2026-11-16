import * as dbSchema from '@ethos/db/schema';
import { Period } from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import { HABIT_DEFAULTS } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';
import { periodLength } from './periods.ts';

// A period cannot ask for more days than it has.
//
// The database cannot say this itself: the ceiling depends on the month, and a
// habit over it can never be met, with nothing to show why.
// Checked after the write, because a write that changes only `period` would
// pass a check that reads the arguments.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 table/column type compat
type AnyDb = any;

const MAX_TARGET = {
  [Period.Day]: 1,
  [Period.Week]: 7,
  // 2026-02-01 is a February, and February is the shortest month there is.
  [Period.Month]: periodLength(Period.Month, '2026-02-01'),
} satisfies Record<Period, number>;

/**
 * The most days a period can offer.
 *
 * Measured against the shortest instance of the period rather than the one we
 * happen to be in: a cadence that is satisfiable in August and impossible in
 * February is a habit that fails once a year for reasons nobody wrote down.
 *
 * @param period - The kind of period.
 * @returns The count, in days.
 */
export function maxTargetFor(period: Period): number {
  return MAX_TARGET[period];
}

/**
 * Why a target over the limit is refused, as a sentence for the user.
 *
 * @param period - The kind of period.
 * @returns The sentence.
 */
export function describeCadenceLimit(period: Period): string {
  if (period === Period.Day) {
    return 'A daily habit is kept once a day.';
  }
  return `A ${period} has at most ${maxTargetFor(period)} days, so it cannot ask for more.`;
}

/**
 * The most a habit may ask for in one day, and the most one day may record.
 *
 * A separate axis from the target: the target counts days in a period, and
 * this counts what one of those days holds. It depends on no other column, so
 * it is checked before the write rather than after.
 *
 * @returns The ceiling, from `HABIT_DEFAULTS.maxAmount`.
 */
export function maxAmount(): number {
  return HABIT_DEFAULTS.maxAmount;
}

/**
 * Why an amount over the limit is refused, as a sentence for the user.
 *
 * @returns The sentence.
 */
export function describeAmountLimit(): string {
  return `An amount is a whole number from 1 to ${maxAmount().toLocaleString('en-US')}.`;
}

/**
 * Throws unless every habit of `userId`'s asks for something a period could give.
 *
 * @param db - The database or transaction.
 * @param userId - Whose habits to check.
 */
export async function assertTargetsFitPeriods(db: AnyDb, userId: string): Promise<void> {
  const rows: Array<{ name: string; period: Period; targetCount: number }> = await db
    .select({
      name: dbSchema.habits.name,
      period: dbSchema.habits.period,
      targetCount: dbSchema.habits.targetCount,
    })
    .from(dbSchema.habits)
    .where(eq(dbSchema.habits.userId, userId));

  const impossible = rows.find((row) => row.targetCount > maxTargetFor(row.period));
  if (!impossible) {
    return;
  }
  throw badInput(
    `“${impossible.name}” asks for ${impossible.targetCount} days a ${impossible.period}. ${describeCadenceLimit(impossible.period)}`,
  );
}
