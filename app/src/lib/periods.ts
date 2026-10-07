/**
 * Days and periods, as the client counts them.
 *
 * This is the client's copy of `server/src/habits/periods.ts`, and the copy is
 * deliberate: the grid draws the periods the server counts streaks over, so if
 * the two disagree the app shows a streak nobody can reproduce by counting
 * squares. They are separate packages — the app is bundled by Metro and must not
 * pull the server's Drizzle imports into a browser — so the rule is kept by the
 * files being identical rather than by an import. Change one, change both;
 * `__tests__/periods.test.ts` is the same suite on either side.
 *
 * Nothing here constructs a `Date` from a day string. A day is a label, not an
 * instant: `new Date('2026-09-17')` is UTC midnight, which is the sixteenth for
 * most of the Americas. Arithmetic goes through `Date.UTC`, where the offset is
 * zero by construction.
 *
 * `today()` is the exception, and the only place the local clock is read: which
 * day it *is* for the person holding the device is exactly what a habit tracker
 * needs to know, and it is what the client sends the server with everything that
 * depends on the current period.
 */

export type Period = 'day' | 'week' | 'month';

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The day it is here, in the device's own zone. */
export function today(at: Date = new Date()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function toUtc(day: string): number {
  if (!DAY_PATTERN.test(day)) return Number.NaN;
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDay(value: string): boolean {
  const ms = toUtc(value);
  return !Number.isNaN(ms) && fromUtc(ms) === value;
}

export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** The first day of the period `day` falls in. Weeks start on Monday (ISO 8601). */
export function periodStart(period: Period, day: string): string {
  if (period === 'day') return day;
  if (period === 'week') {
    const weekday = new Date(toUtc(day)).getUTCDay();
    return addDays(day, -((weekday + 6) % 7));
  }
  return `${day.slice(0, 7)}-01`;
}

/** The day after the period's last — exclusive, so periods tile without overlapping. */
export function periodEnd(period: Period, day: string): string {
  const start = periodStart(period, day);
  if (period === 'day') return addDays(start, 1);
  if (period === 'week') return addDays(start, 7);
  const [year, month] = start.split('-').map(Number);
  return fromUtc(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
}

export interface PeriodRange {
  start: string;
  end: string;
}

export function periodOf(period: Period, day: string): PeriodRange {
  return { start: periodStart(period, day), end: periodEnd(period, day) };
}

export function periodBefore(period: Period, day: string, count = 1): PeriodRange {
  const start = periodStart(period, day);
  if (count <= 0) return { start, end: periodEnd(period, start) };
  return periodBefore(period, addDays(start, -1), count - 1);
}

/** The last `count` periods ending with the one containing `day`, oldest first. */
export function recentPeriods(period: Period, day: string, count: number): PeriodRange[] {
  return Array.from({ length: count }, (_, index) => periodBefore(period, day, count - 1 - index));
}

/** Every day of a period, in order — the squares of one row of the grid. */
export function daysOf(range: PeriodRange): string[] {
  return Array.from({ length: daysBetween(range.start, range.end) }, (_, index) => addDays(range.start, index));
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });

/**
 * Every formatter above is pinned to UTC, for the same reason the arithmetic is:
 * a day string is rendered as the day it says, not as whatever instant it would
 * be if the reader's zone were applied to its midnight.
 */
export function formatDay(day: string): string {
  return SHORT.format(new Date(toUtc(day)));
}

export function formatDayLong(day: string): string {
  return FULL.format(new Date(toUtc(day)));
}

export function weekdayInitial(day: string): string {
  return WEEKDAY.format(new Date(toUtc(day)));
}

/**
 * A period as a person would name it: the near ones by relation, the rest by
 * date. "4 periods ago" is worse than the date itself — at that distance the
 * reader wants to know *when*, and counting is not the label's job.
 */
export function periodLabel(period: Period, start: string, from: string = today()): string {
  const current = periodStart(period, from);
  if (start === current) return period === 'day' ? 'Today' : `This ${period}`;
  const previous = periodBefore(period, from).start;
  if (start === previous) return period === 'day' ? 'Yesterday' : `Last ${period}`;
  if (period === 'month') return MONTH.format(new Date(toUtc(start)));
  return formatDay(start);
}
