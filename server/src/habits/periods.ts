import { Period } from '@ethos/db/schema';
import { badInput } from '../core/errors.ts';

// Where the period boundaries are drawn, as pure functions over `YYYY-MM-DD`.
//
// Nothing here constructs a local `Date`: a day is a label, not an instant, and
// `new Date('2026-09-17')` is UTC midnight — the sixteenth for most of the
// Americas. All arithmetic goes through `Date.UTC`, where the offset is zero.
// `app/src/lib/periods.ts` is the client's copy, kept identical so the grid
// draws the periods the streak is counted over.

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` as milliseconds at UTC midnight, or a thrown BAD_USER_INPUT. */
function toUtc(day: string): number {
  if (DAY_PATTERN.test(day) === false) {
    throw badInput(`"${day}" is not a date. Expected YYYY-MM-DD.`);
  }
  const [year, month, date] = day.split('-').map(Number);
  const milliseconds = Date.UTC(year, month - 1, date);
  // Round-tripped rather than range-checked: `2026-02-31` parses happily and
  // comes back as the third of March.
  if (Number.isNaN(milliseconds) || fromUtc(milliseconds) !== day) {
    throw badInput(`"${day}" is not a date. Expected YYYY-MM-DD.`);
  }
  return milliseconds;
}

function fromUtc(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

/** Rejects anything that is not a calendar day, and returns it unchanged. */
export function assertDay(day: string): string {
  toUtc(day);
  return day;
}

export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/**
 * The first day of the period `day` falls in.
 *
 * Weeks start on Monday (ISO 8601) rather than Sunday: it is what the rest of
 * the world writes, and a week that starts on Monday puts a weekend at one end
 * of the row instead of splitting it across two.
 */
export function periodStart(period: Period, day: string): string {
  if (period === Period.Day) {
    return day;
  }
  if (period === Period.Week) {
    const weekday = new Date(toUtc(day)).getUTCDay();
    return addDays(day, -((weekday + 6) % 7));
  }
  return `${day.slice(0, 7)}-01`;
}

/** The day after the period's last — exclusive, so ranges compare as `[start, end)`. */
export function periodEnd(period: Period, day: string): string {
  const start = periodStart(period, day);
  if (period === Period.Day) {
    return addDays(start, 1);
  }
  if (period === Period.Week) {
    return addDays(start, 7);
  }
  const [year, month] = start.split('-').map(Number);
  return fromUtc(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
}

/** How many days the period holds — the ceiling on what one of them can ask for. */
export function periodLength(period: Period, day: string): number {
  return daysBetween(periodStart(period, day), periodEnd(period, day));
}

export interface PeriodRange {
  /** First day of the period, inclusive. */
  start: string;
  /** Day after the period's last, exclusive. */
  end: string;
}

/** The period containing `day`. */
export function periodOf(period: Period, day: string): PeriodRange {
  return { start: periodStart(period, day), end: periodEnd(period, day) };
}

/** The period `count` periods before the one containing `day`. */
export function periodBefore(period: Period, day: string, count = 1): PeriodRange {
  const start = periodStart(period, day);
  if (count <= 0) {
    return { start, end: periodEnd(period, start) };
  }
  return periodBefore(period, addDays(start, -1), count - 1);
}

/**
 * The last `count` periods ending with the one containing `day`, oldest first —
 * which is the order a grid is read in.
 */
export function recentPeriods(period: Period, day: string, count: number): PeriodRange[] {
  return Array.from({ length: count }, (_, index) => periodBefore(period, day, count - 1 - index));
}
