import type { Period } from './periods';

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

export const PERIODS: readonly Period[] = ['day', 'week', 'month'];

export function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value);
}

/**
 * The most a period can be asked for: one day cannot be kept twice, a week has
 * seven days, and the shortest month has twenty-eight.
 */
export function maxTargetFor(period: Period): number {
  if (period === 'day') {
    return 1;
  }
  return period === 'week' ? 7 : 28;
}

/** "Every day", "3× a week" — the cadence as a line of text under the name. */
export function describeCadence(period: Period, targetCount: number): string {
  if (period === 'day') {
    return 'Every day';
  }
  if (targetCount === 1) {
    return `Once a ${period}`;
  }
  return `${targetCount}× a ${period}`;
}

/** What a period asks for, once its skips have come off it. */
export function describeProgress(done: number, effectiveTarget: number, period: Period): string {
  const when = period === 'day' ? 'today' : `this ${period}`;
  return `${done} of ${effectiveTarget} ${when}`;
}
