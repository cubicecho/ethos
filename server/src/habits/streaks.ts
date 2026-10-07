import { ENTRY_DONE, type EntryStatus, type Period } from '@ethos/db/schema';
import { type PeriodRange, periodBefore, periodOf, periodStart, recentPeriods } from './periods.ts';

// What a run of kept days is worth, in one place. Three rules:
//
//   - A skip is not a miss: it comes off what the period asked for, and never
//     counts as a day kept.
//   - A streak counts periods, not days: "3× a week" is kept or not by the week.
//   - The period containing today cannot break a streak: it joins once it is
//     met, and is otherwise passed over.

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
  /** `done / effectiveTarget`, clamped to 1. A period owing nothing reads as 1. */
  rate: number;
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
    rate: effectiveTarget === 0 ? 1 : Math.min(done / effectiveTarget, 1),
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

/**
 * Periods kept in an unbroken run up to now.
 *
 * Walks back from the period containing `today` until it finds one that fell
 * short. The current period is the exception rule 3 describes — it adds to the
 * streak when it is already met, and is stepped over rather than counted when it
 * is not, because it has not failed yet.
 *
 * Bounded by the entries themselves: a habit with no history has no streak, so
 * the walk stops at the oldest day there is rather than counting empty periods
 * back to the epoch.
 *
 * @param habit - The cadence to count against.
 * @param entries - The habit's entries.
 * @param today - The caller's day.
 * @returns The streak, in periods.
 */
export function currentStreak(habit: HabitLike, entries: readonly EntryLike[], today: string): number {
  if (entries.length === 0) {
    return 0;
  }
  const oldest = entries.reduce((min, entry) => (entry.day < min ? entry.day : min), entries[0].day);
  const floor = periodStart(habit.period, oldest);

  let streak = 0;
  let range = periodOf(habit.period, today);
  let isNewestPeriod = true;
  while (range.start >= floor) {
    const tally = tallyPeriod(habit, entries, range);
    if (tally.met) {
      streak += 1;
    } else if (isNewestPeriod === false) {
      break;
    }
    isNewestPeriod = false;
    range = periodBefore(habit.period, range.start);
  }
  return streak;
}

/**
 * The longest run of kept periods there has ever been.
 *
 * Counted over every period from the first entry to today — including the ones
 * with no entries at all, which is the point: a gap is a run of missed periods,
 * and a longest streak that skipped over them would be an achievement nobody
 * earned. The current period joins the run only when it is met, for the same
 * reason it does above.
 *
 * @param habit - The cadence to count against.
 * @param entries - The habit's entries.
 * @param today - The caller's day.
 * @returns The streak, in periods.
 */
export function longestStreak(habit: HabitLike, entries: readonly EntryLike[], today: string): number {
  if (entries.length === 0) {
    return 0;
  }
  const oldest = entries.reduce((min, entry) => (entry.day < min ? entry.day : min), entries[0].day);

  let best = 0;
  let run = 0;
  let range = periodOf(habit.period, periodStart(habit.period, oldest));
  const stop = periodStart(habit.period, today);
  while (range.start <= stop) {
    const isCurrentPeriod = range.start === stop;
    const tally = tallyPeriod(habit, entries, range);
    if (tally.met) {
      run += 1;
      best = Math.max(best, run);
    } else if (isCurrentPeriod === false) {
      run = 0;
    }
    range = periodOf(habit.period, range.end);
  }
  return best;
}
