import type { HabitEntryFieldsFragment, HabitFieldsFragment, HabitPeriodFieldsFragment } from '@/__generated__/graphql';

/**
 * What the screens pass around.
 *
 * The fragments are the contract — every document selects one of them — so
 * naming the generated fragment types here is what keeps a component's props
 * and the query that feeds it the same shape. A field dropped from a fragment
 * becomes a type error at the component reading it, rather than an `undefined`
 * at runtime.
 */
export type HabitSummary = HabitFieldsFragment;
export type HabitPeriodSummary = HabitPeriodFieldsFragment;
export type HabitEntrySummary = HabitEntryFieldsFragment;

export const ENTRY_DONE = 'done';
export const ENTRY_SKIPPED = 'skipped';
/** What an entry says. The server's vocabulary, copied. */
export type EntryStatus = typeof ENTRY_DONE | typeof ENTRY_SKIPPED;

/** What a day says, or nothing at all — the three states a square can be in. */
export type DayStatus = EntryStatus | null;

/**
 * The status of a day, narrowed from the `String` the schema serves.
 *
 * @param value - The status as served.
 * @returns The status, or null for anything unrecognized.
 */
export function asStatus(value: string | null | undefined): DayStatus {
  return value === ENTRY_DONE || value === ENTRY_SKIPPED ? value : null;
}

/**
 * What clicking a square does: nothing → kept → skipped → nothing.
 *
 * One control rather than three, because a square is too small for three, and
 * the cycle puts every state one or two clicks away with no hidden menu. Undo
 * is the third click, which is why "nothing" is in the cycle rather than behind
 * a separate clear.
 *
 * @param current - What the day is now.
 * @returns What it becomes.
 */
export function nextStatus(current: DayStatus): DayStatus {
  if (current === null) {
    return ENTRY_DONE;
  }
  return current === ENTRY_DONE ? ENTRY_SKIPPED : null;
}
