import { HABIT_DEFAULTS } from './defaults';
import { formatCount } from './format';
import { Period } from './periods';

/**
 * How often a habit asks to be kept, in the two forms the app needs it: the
 * ceiling the form enforces, and the sentence the screens print.
 *
 * The ceiling is the client's copy of `server/src/habits/cadence.ts` — the server
 * refuses a target no period can hold, and the form refuses it first so the
 * refusal arrives while the number is still being typed rather than after the
 * dialog has been submitted. The server's copy is the one that decides; this one
 * exists to make it rare to hear from.
 */

const PERIODS: readonly string[] = Object.values(Period);

/**
 * Whether a string names a period.
 *
 * @param value - The string to test.
 * @returns true when it is one of `Period`'s values.
 */
export function isPeriod(value: string): value is Period {
  return PERIODS.includes(value);
}

/**
 * A period narrowed from the `String` the schema serves. The database allows no other value.
 *
 * @param value - The period as served.
 * @returns The period, or `Period.Day` for anything unrecognized.
 */
export function asPeriod(value: string): Period {
  return isPeriod(value) ? value : Period.Day;
}

const MAX_TARGET = {
  [Period.Day]: 1,
  [Period.Week]: 7,
  [Period.Month]: 28,
} satisfies Record<Period, number>;

const PROGRESS_WHEN = {
  [Period.Day]: 'today',
  [Period.Week]: 'this week',
  [Period.Month]: 'this month',
} satisfies Record<Period, string>;

/**
 * The most a period can be asked for: one day cannot be kept twice, a week has
 * seven days, and the shortest month has twenty-eight.
 *
 * @param period - The kind of period.
 * @returns The count, in days.
 */
export function maxTargetFor(period: Period): number {
  return MAX_TARGET[period];
}

/**
 * The most a habit may ask for in one day, and the most one day may record.
 *
 * @returns The ceiling. The server's copy in `server/src/habits/cadence.ts` is the one that decides.
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
  return `An amount is a whole number from 1 to ${formatCount(maxAmount())}.`;
}

/**
 * "Every day", "3× a week", "8× a day, 5 days a week" — the cadence as a line of text under the name.
 *
 * @param period - The kind of period.
 * @param targetCount - Days asked for in each period.
 * @param dailyAmount - How much of the habit each of those days asks for.
 * @returns The line.
 */
export function describeCadence(period: Period, targetCount: number, dailyAmount: number): string {
  if (dailyAmount === 1) {
    return describeDays(period, targetCount);
  }
  if (period === Period.Day) {
    return `${formatCount(dailyAmount)}× every day`;
  }
  const days = targetCount === 1 ? `once a ${period}` : `${targetCount} days a ${period}`;
  return `${formatCount(dailyAmount)}× a day, ${days}`;
}

/**
 * The days half of a cadence: "Every day", "Once a week", "3× a month".
 *
 * @param period - The kind of period.
 * @param targetCount - Days asked for in each period.
 * @returns The line.
 */
function describeDays(period: Period, targetCount: number): string {
  if (period === Period.Day) {
    return 'Every day';
  }
  if (targetCount === 1) {
    return `Once a ${period}`;
  }
  return `${targetCount}× a ${period}`;
}

/**
 * How much of one day's amount was done: "5 of 8".
 *
 * Capped at the goal: a day past it is recorded as it was and reads as the goal
 * met, so ten glasses on an eight-glass day says "8 of 8".
 *
 * @param amount - What the day recorded.
 * @param of - What the day asked for.
 * @returns The line.
 */
export function describeAmount(amount: number, of: number): string {
  return `${formatCount(Math.min(amount, of))} of ${formatCount(of)}`;
}

/**
 * What a period asks for, once its skips have come off it.
 *
 * @param done - Days kept.
 * @param effectiveTarget - Days asked for, less the skips.
 * @param period - The kind of period.
 * @returns The line.
 */
export function describeProgress(done: number, effectiveTarget: number, period: Period): string {
  return `${done} of ${effectiveTarget} ${PROGRESS_WHEN[period]}`;
}
