import { ENTRY_DONE, type EntryStatus, type Period } from '@ethos/db/schema';
import { type PeriodRange, recentPeriods } from './periods.ts';

// What one period came to, in one place. A skip is not a miss: it comes off
// what the period asked for, and never counts as a day kept.

export interface EntryLike {
  day: string;
  status: EntryStatus;
}

export interface HabitLike {
  period: Period;
  targetCount: number;
}

export interface PeriodTally extends PeriodRange {
  /** Days kept inside the period. */
  done: number;
  /** Days deliberately declined. */
  skipped: number;
  /** What the habit asks of a period, before any skips. */
  target: number;
  /** What this period actually asked for, once its skips came off. */
  effectiveTarget: number;
  /** Whether the period was kept. A period skipped down to nothing owed is. */
  met: boolean;
}

/**
 * Whether an entry's day falls inside a period.
 *
 * @param entry - The entry.
 * @param range - The period, end exclusive.
 * @returns true when it does.
 */
const isInRange = (entry: EntryLike, range: PeriodRange) => entry.day >= range.start && entry.day < range.end;

/**
 * One period, counted.
 *
 * @param habit - The cadence to count against.
 * @param entries - The habit's entries.
 * @param range - The period to count.
 * @returns The tally.
 */
export function tallyPeriod(habit: HabitLike, entries: readonly EntryLike[], range: PeriodRange): PeriodTally {
  let done = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (isInRange(entry, range) === false) {
      continue;
    }
    if (entry.status === ENTRY_DONE) {
      done += 1;
    } else {
      skipped += 1;
    }
  }
  const target = habit.targetCount;
  const effectiveTarget = Math.max(target - skipped, 0);
  return {
    ...range,
    done,
    skipped,
    target,
    effectiveTarget,
    met: done >= effectiveTarget,
  };
}

/**
 * The last `count` periods, oldest first — the order the grid is read in.
 *
 * @param habit - The cadence to count against.
 * @param entries - The habit's entries.
 * @param today - The caller's day.
 * @param count - How many periods.
 * @returns One tally per period.
 */
export function tallyRecent(
  habit: HabitLike,
  entries: readonly EntryLike[],
  today: string,
  count: number,
): PeriodTally[] {
  return recentPeriods(habit.period, today, count).map((range) => tallyPeriod(habit, entries, range));
}
