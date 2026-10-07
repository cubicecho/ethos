/**
 * Days and periods, as the client counts them.
 *
 * The client's copy of `server/src/habits/periods.ts`, kept identical by hand
 * because Metro must not bundle the server's imports: the grid draws the
 * periods the server counts streaks over. Nothing here constructs a `Date` from
 * a day string, since `new Date('2026-09-17')` is UTC midnight — the sixteenth
 * for most of the Americas. `today()` is the one read of the local clock: which
 * day it is for the person holding the device is what the server needs told.
 */

/** How often a habit is meant to happen. The server's vocabulary, copied. */
export const Period = { Day: 'day', Week: 'week', Month: 'month' } as const;
export type Period = (typeof Period)[keyof typeof Period];

/** The period `from` falls in, by name. */
export const THIS_PERIOD = {
  [Period.Day]: 'Today',
  [Period.Week]: 'This week',
  [Period.Month]: 'This month',
} satisfies Record<Period, string>;

const LAST_PERIOD = {
  [Period.Day]: 'Yesterday',
  [Period.Week]: 'Last week',
  [Period.Month]: 'Last month',
} satisfies Record<Period, string>;

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const DECEMBER = 12;
/** How much of a `YYYY-MM-DD` names the month. */
const MONTH_LENGTH = 'YYYY-MM'.length;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A month or a date as two digits.
 *
 * @param value - The number.
 * @returns The number, zero-padded.
 */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The day it is here, in the device's own zone.
 *
 * @param [at] - The instant to read the day from.
 * @returns The day, as `YYYY-MM-DD`.
 */
export function today(at: Date = new Date()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * A `YYYY-MM-DD` as milliseconds at UTC midnight.
 *
 * @param day - The day string.
 * @returns Milliseconds since the epoch, or NaN when the string is not that shape.
 */
function toUtc(day: string): number {
  if (DAY_PATTERN.test(day) === false) {
    return Number.NaN;
  }
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
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
 * The first day of the period `day` falls in. Weeks start on Monday (ISO 8601).
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
 * The day after the period's last — exclusive, so periods tile without overlapping.
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

/** A period as a range of days. */
export interface PeriodRange {
  /** The first day. */
  start: string;
  /** The day after the last: exclusive. */
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
 * The last `count` periods ending with the one containing `day`, oldest first.
 *
 * @param period - The kind of period.
 * @param day - A day in the last period.
 * @param count - How many periods.
 * @returns The ranges.
 */
export function recentPeriods(period: Period, day: string, count: number): PeriodRange[] {
  return Array.from({ length: count }, (_, index) => periodBefore(period, day, count - 1 - index));
}

/**
 * Every day of a period, in order — the squares of one row of the grid.
 *
 * @param range - The period.
 * @returns The days.
 */
export function daysOf(range: PeriodRange): string[] {
  return Array.from({ length: daysBetween(range.start, range.end) }, (_, index) => addDays(range.start, index));
}

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const LONG_DAY_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' });
const WEEKDAY_INITIAL_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });

/**
 * A day in its short form. Every formatter above is pinned to UTC, as the arithmetic
 * is: a day string is rendered as the day it says, not as whatever instant it would
 * be if the reader's zone were applied to its midnight.
 *
 * @param day - A `YYYY-MM-DD` day.
 * @returns The day in its short form.
 */
export function formatDay(day: string): string {
  return SHORT_DAY_FORMAT.format(new Date(toUtc(day)));
}

/**
 * A day in its long form, pinned to UTC like `formatDay`.
 *
 * @param day - A `YYYY-MM-DD` day.
 * @returns The formatted day.
 */
export function formatDayLong(day: string): string {
  return LONG_DAY_FORMAT.format(new Date(toUtc(day)));
}

/**
 * The first letter of a day's weekday.
 *
 * @param day - A `YYYY-MM-DD` day.
 * @returns The letter.
 */
export function weekdayInitial(day: string): string {
  return WEEKDAY_INITIAL_FORMAT.format(new Date(toUtc(day)));
}

/**
 * A period as a person would name it: the near ones by relation, the rest by
 * date. "4 periods ago" is worse than the date itself — at that distance the
 * reader wants to know *when*, and counting is not the label's job.
 *
 * @param period - The kind of period.
 * @param start - The period's first day.
 * @param [from] - The day it is being read on.
 * @returns The label.
 */
export function periodLabel(period: Period, start: string, from: string = today()): string {
  const current = periodStart(period, from);
  if (start === current) {
    return THIS_PERIOD[period];
  }
  const previous = periodBefore(period, from).start;
  if (start === previous) {
    return LAST_PERIOD[period];
  }
  if (period === Period.Month) {
    return MONTH_FORMAT.format(new Date(toUtc(start)));
  }
  return formatDay(start);
}
