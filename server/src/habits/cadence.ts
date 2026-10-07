import * as dbSchema from '@ethos/db/schema';
import { Period } from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import { badInput } from '../core/errors.ts';
import { periodLength } from './periods.ts';

// A period cannot ask for more days than it has.
//
// The database cannot say this itself: the ceiling depends on the month, and a
// habit over it drags every rate and streak to zero with nothing to show why.
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
 */
export function maxTargetFor(period: Period): number {
  return MAX_TARGET[period];
}

export function describeCadenceLimit(period: Period): string {
  if (period === Period.Day) {
    return 'A daily habit is kept once a day.';
  }
  return `A ${period} has at most ${maxTargetFor(period)} days, so it cannot ask for more.`;
}

/** Throws unless every habit of `userId`'s asks for something a period could give. */
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
