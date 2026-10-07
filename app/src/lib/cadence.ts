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

export function isPeriod(value: string): value is Period {
  return PERIODS.includes(value);
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
 */
export function maxTargetFor(period: Period): number {
  return MAX_TARGET[period];
}

/** "Every day", "3× a week" — the cadence as a line of text under the name. */
export function describeCadence(period: Period, targetCount: number): string {
  if (period === Period.Day) {
    return 'Every day';
  }
  if (targetCount === 1) {
    return `Once a ${period}`;
  }
  return `${targetCount}× a ${period}`;
}

/** What a period asks for, once its skips have come off it. */
export function describeProgress(done: number, effectiveTarget: number, period: Period): string {
  return `${done} of ${effectiveTarget} ${PROGRESS_WHEN[period]}`;
}
