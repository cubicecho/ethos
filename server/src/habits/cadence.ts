import type { Period } from '@ethos/db/schema';
import * as dbSchema from '@ethos/db/schema';
import { eq } from 'drizzle-orm';
import { GraphQLError } from 'graphql';
import { periodLength } from './periods.ts';

// A period cannot ask for more days than it has.
//
// The database cannot say this itself: the ceiling depends on the month, and a
// habit over it drags every rate and streak to zero with nothing to show why.
// Checked after the write, because a write that changes only `period` would
// pass a check that reads the arguments.

// biome-ignore lint/suspicious/noExplicitAny: drizzle-orm 1.0 table/column type compat
type AnyDb = any;

/**
 * The most days a period can offer.
 *
 * Measured against the shortest instance of the period rather than the one we
 * happen to be in: a cadence that is satisfiable in August and impossible in
 * February is a habit that fails once a year for reasons nobody wrote down.
 */
export function maxTargetFor(period: Period): number {
  if (period === 'day') {
    return 1;
  }
  if (period === 'week') {
    return 7;
  }
  // 2026-02-01 is a February, and February is the shortest month there is.
  return periodLength('month', '2026-02-01');
}

export function describeCadenceLimit(period: Period): string {
  if (period === 'day') {
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
  throw new GraphQLError(
    `“${impossible.name}” asks for ${impossible.targetCount} days a ${impossible.period}. ${describeCadenceLimit(impossible.period)}`,
    { extensions: { code: 'BAD_USER_INPUT' } },
  );
}
