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
const DAYS_PER_WEEK = 7;
const DECEMBER = 12;
/** How much of a `YYYY-MM-DD` names the month. */
const MONTH_LENGTH = 'YYYY-MM'.length;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` as milliseconds at UTC midnight, or a thrown BAD_USER_INPUT.
 *
 * @param day - A `YYYY-MM-DD` day.
 * @returns Milliseconds since the epoch.
 */
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

/**
 * The `YYYY-MM-DD` of a UTC instant.
 *
 * @param milliseconds - Milliseconds since the epoch.
 * @returns The day.
 */
function fromUtc(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

/**
 * Rejects anything that is not a calendar day, and returns it unchanged.
 *
 * @param day - The value to check.
 * @returns The same string.
 */
export function assertDay(day: string): string {
  toUtc(day);
  return day;
}

/**
 * The day `count` days after `day`.
 *
 * @param day - A `YYYY-MM-DD` day.
 * @param count - Days to add; negative goes back.
 * @returns The day.
 */
export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * DAY_MS);
}

/**
 * Whole days from `from` to `to`. Negative when `to` is earlier.
 *
 * @param from - The day counted from.
 * @param to - The day counted to.
 * @returns The number of days.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/**
 * The first day of the period `day` falls in.
 *
 * Weeks start on Monday (ISO 8601) rather than Sunday: it is what the rest of
 * the world writes, and a week that starts on Monday puts a weekend at one end
 * of the row instead of splitting it across two.
 *
 * @param period - The kind of period.
 * @param day - Any day in the period.
 * @returns The first day.
 */
export function periodStart(period: Period, day: string): string {
  if (period === Period.Day) {
    return day;
  }
  if (period === Period.Week) {
    const weekday = new Date(toUtc(day)).getUTCDay();
    return addDays(day, -((weekday + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK));
  }
  return `${day.slice(0, MONTH_LENGTH)}-01`;
}

/**
 * The day after the period's last — exclusive, so ranges compare as `[start, end)`.
 *
 * @param period - The kind of period.
 * @param day - Any day in the period.
 * @returns The day after the last.
 */
export function periodEnd(period: Period, day: string): string {
  const start = periodStart(period, day);
  if (period === Period.Day) {
    return addDays(start, 1);
  }
  if (period === Period.Week) {
    return addDays(start, DAYS_PER_WEEK);
  }
  const [year, month] = start.split('-').map(Number);
  return fromUtc(Date.UTC(month === DECEMBER ? year + 1 : year, month === DECEMBER ? 0 : month, 1));
}

/**
 * How many days the period holds — the ceiling on what one of them can ask for.
 *
 * @param period - The kind of period.
 * @param day - Any day in the period.
 * @returns The length, in days.
 */
export function periodLength(period: Period, day: string): number {
  return daysBetween(periodStart(period, day), periodEnd(period, day));
}

export interface PeriodRange {
  /** First day of the period, inclusive. */
  start: string;
  /** Day after the period's last, exclusive. */
  end: string;
}

/**
 * The period containing `day`.
 *
 * @param period - The kind of period.
 * @param day - Any day in it.
 * @returns Its first day and its exclusive end.
 */
export function periodOf(period: Period, day: string): PeriodRange {
  return { start: periodStart(period, day), end: periodEnd(period, day) };
}

/**
 * The period `count` periods before the one containing `day`.
 *
 * @param period - The kind of period.
 * @param day - A day in the period counted back from.
 * @param [count] - How many periods to go back.
 * @returns That period's first day and its exclusive end.
 */
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
 *
 * @param period - The kind of period.
 * @param day - A day in the last period.
 * @param count - How many periods.
 * @returns The ranges.
 */
export function recentPeriods(period: Period, day: string, count: number): PeriodRange[] {
  return Array.from({ length: count }, (_, index) => periodBefore(period, day, count - 1 - index));
}
